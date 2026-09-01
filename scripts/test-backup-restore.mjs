#!/usr/bin/env node
/**
 * O teste que decide se o backup vale alguma coisa: RESTAURAR de verdade.
 *
 * Gera um backup de um projeto real, cria um schema descartável no mesmo
 * banco, reescreve o dump para apontar para ele, executa, e compara tabela a
 * tabela e linha a linha com o original. Apaga o schema no final, sempre.
 *
 * Sem este teste, "backup" é só um arquivo grande com esperança dentro.
 *
 *   node scripts/test-backup-restore.mjs [nomeDoProjeto]
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const TARGET = process.argv[2] ?? 'Loja Norte'
const SCRATCH = `restore_test_${crypto.randomBytes(4).toString('hex')}`

const KEY = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64')
const decrypt = (env) => {
  const [v, i, t, c] = env.split('.')
  if (v !== 'v1') return null
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(i, 'base64url'))
  d.setAuthTag(Buffer.from(t, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(c, 'base64url')), d.final()]).toString()
}

const db = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

let pat = null
let ref = null
let scratchCreated = false
let failed = 0

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed++
}

async function sql(query, readOnly = false) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: readOnly }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(text.slice(0, 400))
  return text ? JSON.parse(text) : []
}

try {
  const { data: project } = await db
    .from('projects')
    .select('id, name, ref, account_id')
    .eq('name', TARGET)
    .is('archived_at', null)
    .maybeSingle()

  if (!project?.account_id) {
    console.error(`\nProjeto "${TARGET}" não encontrado ou sem token de conta.\n`)
    process.exit(1)
  }

  const { data: account } = await db
    .from('accounts')
    .select('pat_encrypted')
    .eq('id', project.account_id)
    .maybeSingle()

  pat = decrypt(account.pat_encrypted)
  ref = project.ref

  console.log(`\nTeste de restauração, ${project.name}\n`)

  /* ── 1. Fotografa o estado original ──────────────────────────────── */
  console.log('Estado original')

  const originalTables = await sql(
    `select c.relname as tbl,
            (select count(*) from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`,
    true,
  )

  const originalCounts = {}
  for (const t of originalTables) {
    const r = await sql(`select count(*)::int as n from public."${t.tbl}"`, true)
    originalCounts[t.tbl] = r[0].n
  }

  const totalOriginal = Object.values(originalCounts).reduce((a, b) => a + b, 0)
  console.log(`  ${originalTables.length} tabelas, ${totalOriginal} linhas no total`)

  /* ── 2. Gera o backup pelo motor do sistema ──────────────────────── */
  console.log('\nGerando backup')

  const { runBackup } = await import('../src/lib/gateway/backup.ts').catch(() => ({}))
  // O motor é TypeScript; chamamos pela API do app, que é o caminho real.
  const backupRes = await fetch(`http://localhost:3000/api/projects/${project.id}/backup`, {
    method: 'POST',
    headers: { cookie: process.env.TEST_COOKIE ?? '' },
  })

  let storagePath
  if (backupRes.ok) {
    const data = await backupRes.json()
    storagePath = data.path
    check('backup gerado pela API', true, `${data.counts.tables} tabelas, ${data.counts.rows} linhas`)
    if (data.warnings?.length) {
      for (const w of data.warnings) console.log(`         aviso: ${w}`)
    }
  } else {
    // Sem sessão: gera direto, sem passar pela API
    check('backup pela API', false, 'sem sessão, rode com o servidor no ar')
    process.exit(1)
  }

  /* ── 3. Baixa e descomprime ──────────────────────────────────────── */
  const { data: file, error: dlError } = await db.storage.from('backups').download(storagePath)
  if (dlError) {
    check('baixa o arquivo do Storage', false, dlError.message)
    process.exit(1)
  }

  const dump = gunzipSync(Buffer.from(await file.arrayBuffer())).toString('utf8')
  check('arquivo baixado e descomprimido', dump.length > 0, `${(dump.length / 1024).toFixed(0)} KB de SQL`)

  const createCount = (dump.match(/create table if not exists/gi) ?? []).length
  check(
    'contém CREATE TABLE para cada tabela',
    createCount === originalTables.length,
    `${createCount} de ${originalTables.length}`,
  )

  /* ── 4. Restaura num schema descartável ──────────────────────────── */
  console.log('\nRestaurando em schema descartável')

  await sql(`create schema ${SCRATCH}`, false)
  scratchCreated = true
  check('schema de teste criado', true, SCRATCH)

  // Aponta o dump para o schema de teste. As referências são sempre
  // public."nome", então a troca é segura e completa.
  const restoreSql = dump
    .replace(/public\.("(?:[^"]|"")+")/g, `${SCRATCH}.$1`)
    .replace(/\bON public\./gi, `ON ${SCRATCH}.`)
    .replace(/'public\.([^']+)'/g, `'${SCRATCH}.$1'`)
    // defaults de coluna serial referenciam a sequence sem aspas
    .replace(/nextval\('public\.([^']+)'/g, `nextval('${SCRATCH}.$1'`)

  const remaining = (restoreSql.match(/public\."/g) ?? []).length
  check('todas as referências reescritas', remaining === 0, `${remaining} sobraram`)

  // Executa comando a comando, dividindo pelo marcador, que é exatamente o
  // que alguem faria ao restaurar um arquivo grande.
  const statements = restoreSql
    .split(/^-- @@$/m)
    .map((c) => c.trim())
    .filter((c) => c && !/^(--[^\n]*\n?)+$/.test(c))

  check('dump se divide em comandos', statements.length > 0, `${statements.length} comandos`)

  let executed = 0
  let firstError = null

  for (const statement of statements) {
    try {
      await sql(statement, false)
      executed++
    } catch (err) {
      if (!firstError) firstError = `no comando ${executed + 1}: ${String(err.message).slice(0, 180)}`
    }
  }

  check(
    'todos os comandos executaram',
    executed === statements.length,
    executed === statements.length
      ? `${executed} comandos`
      : `${executed} de ${statements.length} · ${firstError}`,
  )

  /* ── 5. Compara o restaurado com o original ──────────────────────── */
  console.log('\nConferindo o resultado')

  const restoredTables = await sql(
    `select c.relname as tbl
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = '${SCRATCH}' and c.relkind = 'r'
     order by c.relname`,
    true,
  )

  check(
    'mesma quantidade de tabelas',
    restoredTables.length === originalTables.length,
    `${restoredTables.length} restauradas de ${originalTables.length}`,
  )

  const missing = originalTables
    .map((t) => t.tbl)
    .filter((name) => !restoredTables.some((r) => r.tbl === name))
  check('nenhuma tabela faltando', missing.length === 0, missing.join(', ') || undefined)

  let rowsMatch = 0
  let rowsDiffer = []

  for (const t of restoredTables) {
    const r = await sql(`select count(*)::int as n from ${SCRATCH}."${t.tbl}"`, true)
    const restored = r[0].n
    const original = originalCounts[t.tbl] ?? 0

    if (restored === original) rowsMatch++
    else rowsDiffer.push(`${t.tbl}: ${restored} vs ${original}`)
  }

  check(
    'contagem de linhas bate em todas as tabelas',
    rowsDiffer.length === 0,
    rowsDiffer.length ? rowsDiffer.slice(0, 3).join(' · ') : `${rowsMatch} tabelas conferidas`,
  )

  /* ── 6. Compara o CONTEÚDO, não só a contagem ────────────────────── */
  // Compara o conteudo de TODAS as tabelas com dados, nao so de uma amostra.
  // O hash e sobre a linha inteira, entao pega qualquer valor que tenha sido
  // convertido errado, data, jsonb, numerico, acento.
  const withData = originalTables.filter((t) => (originalCounts[t.tbl] ?? 0) > 0)
  const mismatched = []

  for (const t of withData) {
    const [orig] = await sql(
      `select md5(string_agg(x, '|')) as h from (select t::text as x from public."${t.tbl}" t order by 1) s`,
      true,
    )
    const [rest] = await sql(
      `select md5(string_agg(x, '|')) as h from (select t::text as x from ${SCRATCH}."${t.tbl}" t order by 1) s`,
      true,
    )
    if (orig.h !== rest.h) mismatched.push(t.tbl)
  }

  check(
    'conteudo identico em todas as tabelas (hash linha a linha)',
    mismatched.length === 0,
    mismatched.length ? `divergiu em: ${mismatched.join(', ')}` : `${withData.length} tabelas conferidas`,
  )

  const idx = await sql(
    `select count(*)::int as n from pg_indexes where schemaname = '${SCRATCH}'`,
    true,
  )
  const origIdx = await sql(
    `select count(*)::int as n from pg_indexes where schemaname = 'public'`,
    true,
  )
  check(
    'índices restaurados',
    idx[0].n >= origIdx[0].n * 0.9,
    `${idx[0].n} de ${origIdx[0].n}`,
  )
} catch (err) {
  console.error(`\nErro: ${err.message}\n`)
  failed++
} finally {
  console.log('\nLimpeza')
  if (scratchCreated) {
    try {
      await sql(`drop schema ${SCRATCH} cascade`, false)
      console.log(`  ok    schema ${SCRATCH} removido`)
    } catch (err) {
      console.log(`  ATENCAO: nao consegui remover o schema ${SCRATCH}, remova a mao`)
    }
  }
}

console.log(
  `\n${failed === 0 ? 'O backup restaura corretamente.' : `${failed} problema(s): o backup NAO e confiavel ainda.`}\n`,
)
process.exit(failed > 0 ? 1 : 0)
