#!/usr/bin/env node
/**
 * Simula o caso real: "apagaram itens que não podiam".
 *
 * Cria linhas numa tabela de teste, gera backup, APAGA as linhas, e usa a
 * restauração seletiva para trazê-las de volta. Confere que voltaram
 * idênticas e que os dois modos (só ausentes / substituir) fazem o que dizem.
 *
 * Roda contra o projeto do sistema, numa tabela criada e apagada aqui.
 *
 *   node scripts/test-row-restore.mjs
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const BASE = 'http://localhost:3000'
const COOKIE = process.env.TEST_COOKIE ?? ''
const TABLE = `teste_restauracao_${crypto.randomBytes(3).toString('hex')}`

const KEY = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64')
const decrypt = (env) => {
  const [v, i, t, c] = env.split('.')
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(i, 'base64url'))
  d.setAuthTag(Buffer.from(t, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(c, 'base64url')), d.final()]).toString()
}

const db = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

let pat = null
let ref = null
let projectId = null
let tableCreated = false
let backupId = null
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
  if (!res.ok) throw new Error(text.slice(0, 300))
  return text ? JSON.parse(text) : []
}

try {
  const { data: project } = await db
    .from('projects')
    .select('id, name, ref, account_id')
    .eq('name', 'SuperBase')
    .maybeSingle()

  const { data: account } = await db
    .from('accounts')
    .select('pat_encrypted')
    .eq('id', project.account_id)
    .maybeSingle()

  pat = decrypt(account.pat_encrypted)
  ref = project.ref
  projectId = project.id

  console.log(`\nRestauração seletiva de linhas, tabela ${TABLE}\n`)

  /* ── 1. Cria a tabela com dados conhecidos ───────────────────────── */
  await sql(
    `create table public."${TABLE}" (
       id int primary key,
       nome text not null,
       valor numeric(10,2),
       dados jsonb,
       criado_em timestamptz default now()
     )`,
    false,
  )
  tableCreated = true

  await sql(
    `insert into public."${TABLE}" (id, nome, valor, dados) values
     (1, 'Primeiro item', 10.50, '{"cor":"azul"}'),
     (2, 'Item com acentuação e ç', 20.75, '{"tags":["a","b"]}'),
     (3, 'Item com ''aspas'' simples', 30.00, null),
     (4, 'Quarto', 40.25, '{"n":42}'),
     (5, 'Quinto', 50.00, '{}')`,
    false,
  )

  const [{ n: antes }] = await sql(`select count(*)::int as n from public."${TABLE}"`, true)
  check('tabela de teste criada com dados', antes === 5, `${antes} linhas`)

  /* ── 2. Backup ───────────────────────────────────────────────────── */
  const backupRes = await fetch(`${BASE}/api/projects/${projectId}/backup`, {
    method: 'POST',
    headers: { cookie: COOKIE },
  })
  const backupData = await backupRes.json()
  check('backup gerado', backupRes.ok, backupRes.ok ? undefined : backupData.error)

  const { data: recent } = await db
    .from('backups')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'ok')
    .order('started_at', { ascending: false })
    .limit(1)
  backupId = recent?.[0]?.id

  /* ── 3. O backup enxerga a tabela? ───────────────────────────────── */
  const inspect = await (
    await fetch(`${BASE}/api/projects/${projectId}/backup/inspect?backupId=${backupId}`, {
      headers: { cookie: COOKIE },
    })
  ).json()

  const found = (inspect.tables ?? []).find((t) => t.table === TABLE)
  check('tabela aparece no visualizador', Boolean(found), `${found?.rows ?? 0} linhas`)

  const rowsView = await (
    await fetch(
      `${BASE}/api/projects/${projectId}/backup/inspect?backupId=${backupId}&table=${TABLE}`,
      { headers: { cookie: COOKIE } },
    )
  ).json()

  check('linhas legíveis no visualizador', rowsView.rows?.length === 5, `${rowsView.rows?.length}`)
  check(
    'acentuação preservada na leitura',
    rowsView.rows?.some((r) => r.nome === 'Item com acentuação e ç'),
  )
  check(
    'aspas simples preservadas',
    rowsView.rows?.some((r) => r.nome === "Item com 'aspas' simples"),
  )

  /* ── 4. APAGA linhas, como se alguém tivesse errado ──────────────── */
  await sql(`delete from public."${TABLE}" where id in (2, 3)`, false)
  const [{ n: depois }] = await sql(`select count(*)::int as n from public."${TABLE}"`, true)
  check('linhas apagadas de propósito', depois === 3, `sobraram ${depois}`)

  /* ── 5. Restaura só as ausentes ──────────────────────────────────── */
  const idx2 = rowsView.rows.findIndex((r) => r.id === 2)
  const idx3 = rowsView.rows.findIndex((r) => r.id === 3)

  const restore = await (
    await fetch(`${BASE}/api/projects/${projectId}/backup/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: COOKIE },
      body: JSON.stringify({ backupId, table: TABLE, rowIndexes: [idx2, idx3], mode: 'missing' }),
    })
  ).json()

  check('restauração respondeu', Boolean(restore.ok), restore.error)
  check('inseriu exatamente as 2 apagadas', restore.inserted === 2, `inseriu ${restore.inserted}`)

  const restored = await sql(
    `select id, nome, valor, dados from public."${TABLE}" where id in (2,3) order by id`,
    true,
  )
  check('as duas voltaram', restored.length === 2)
  check(
    'conteúdo idêntico ao original',
    restored[0]?.nome === 'Item com acentuação e ç' &&
      restored[1]?.nome === "Item com 'aspas' simples" &&
      Number(restored[0]?.valor) === 20.75,
    restored.map((r) => r.nome).join(' | '),
  )
  check(
    'jsonb preservado',
    JSON.stringify(restored[0]?.dados) === JSON.stringify({ tags: ['a', 'b'] }),
    JSON.stringify(restored[0]?.dados),
  )

  /* ── 6. Modo "só ausentes" não mexe no que existe ────────────────── */
  await sql(`update public."${TABLE}" set nome = 'ALTERADO DEPOIS' where id = 1`, false)

  const idx1 = rowsView.rows.findIndex((r) => r.id === 1)
  const again = await (
    await fetch(`${BASE}/api/projects/${projectId}/backup/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: COOKIE },
      body: JSON.stringify({ backupId, table: TABLE, rowIndexes: [idx1], mode: 'missing' }),
    })
  ).json()

  const [row1] = await sql(`select nome from public."${TABLE}" where id = 1`, true)
  check('modo "só ausentes" não sobrescreve', row1?.nome === 'ALTERADO DEPOIS', row1?.nome)
  check('e reporta 0 inseridas', again.inserted === 0, `inseriu ${again.inserted}`)

  /* ── 7. Modo "substituir" desfaz a alteração ─────────────────────── */
  const over = await (
    await fetch(`${BASE}/api/projects/${projectId}/backup/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: COOKIE },
      body: JSON.stringify({ backupId, table: TABLE, rowIndexes: [idx1], mode: 'overwrite' }),
    })
  ).json()

  const [row1b] = await sql(`select nome from public."${TABLE}" where id = 1`, true)
  check('modo "substituir" devolve o valor do backup', row1b?.nome === 'Primeiro item', row1b?.nome)

  /* ── 8. Auditoria ────────────────────────────────────────────────── */
  const { data: logs } = await db
    .from('audit_logs')
    .select('action, detail')
    .eq('action', 'backup.rows_restored')
    .order('created_at', { ascending: false })
    .limit(1)

  check('restauração registrada na auditoria', (logs ?? []).length > 0, logs?.[0]?.detail?.slice(0, 60))
} catch (err) {
  console.error(`\nErro: ${err.message}\n`)
  failed++
} finally {
  console.log('\nLimpeza')

  if (tableCreated) {
    try {
      await sql(`drop table if exists public."${TABLE}"`, false)
      console.log('  ok    tabela de teste removida')
    } catch {
      console.log(`  ATENCAO: remova a mao a tabela ${TABLE}`)
    }
  }

  if (backupId) {
    const { data: b } = await db
      .from('backups')
      .select('storage_path')
      .eq('id', backupId)
      .maybeSingle()
    if (b) await db.storage.from('backups').remove([b.storage_path])
    await db.from('backups').delete().eq('id', backupId)
    console.log('  ok    backup de teste removido')
  }

  await db.from('audit_logs').delete().like('detail', `%${TABLE}%`)
}

console.log(`\n${failed === 0 ? 'Restauração seletiva funciona.' : `${failed} problema(s).`}\n`)
process.exit(failed > 0 ? 1 : 0)
