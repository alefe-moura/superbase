#!/usr/bin/env node
/**
 * Verifica, contra um banco real, dois pontos:
 *   1. o cache de schema realmente elimina a ida ao servidor;
 *   2. a edição de célula grava e volta o valor certo.
 *
 * Escreve numa linha real e DEVOLVE o valor original ao final, inclusive
 * se algo falhar no meio.
 *
 *   node scripts/test-cell-edit.mjs
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const BASE = process.argv[2] ?? 'http://localhost:3000'
const EMAIL = 'sbm-smoke-test@superbase-manager.test'
const PASSWORD = 'Cell-edit-test-98765'

const admin = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

let userId = null
let restore = null
let failed = 0

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed++
}

try {
  const { data: created } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  })
  userId = created?.user?.id

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })

  if (login.status !== 200) {
    console.error(`\nLogin de teste falhou (${login.status}).\n`)
    process.exit(1)
  }

  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

  // Usa o proprio projeto do sistema, que tem a tabela clients
  const { data: projects } = await admin
    .from('projects')
    .select('id, name')
    .is('archived_at', null)
    .order('name')

  const project = projects?.find((p) => p.name === 'SuperBase') ?? projects?.[0]
  if (!project) {
    console.error('\nNenhum projeto conectado para testar.\n')
    process.exit(1)
  }

  console.log(`\nProjeto de teste: ${project.name}\n`)

  /* ── 1. Cache de schema ────────────────────────────────────────────── */
  console.log('Cache de schema')

  const t1 = performance.now()
  const r1 = await fetch(`${BASE}/api/projects/${project.id}/tables?refresh=1`, {
    headers: { cookie },
  })
  const d1 = await r1.json()
  const ms1 = Math.round(performance.now() - t1)

  const t2 = performance.now()
  const r2 = await fetch(`${BASE}/api/projects/${project.id}/tables`, { headers: { cookie } })
  const d2 = await r2.json()
  const ms2 = Math.round(performance.now() - t2)

  check('primeira leitura busca no banco', d1.cached === false, `${ms1} ms`)
  check('segunda leitura vem do cache', d2.cached === true, `${ms2} ms`)
  check('cache devolve as mesmas tabelas', d1.tables.length === d2.tables.length)
  check(
    'cache e mais rapido',
    ms2 < ms1,
    `${ms1} ms -> ${ms2} ms  (${Math.round(((ms1 - ms2) / ms1) * 100)}% mais rapido)`,
  )

  /* ── 2. Edição de célula ───────────────────────────────────────────── */
  console.log('\nEdicao de celula')

  // Cria uma linha propria para nao mexer em dado existente
  const marker = `teste-edicao-celula-${Date.now()}`
  const insert = await fetch(`${BASE}/api/projects/${project.id}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ table: 'clients', values: { name: marker } }),
  })
  const inserted = await insert.json()

  if (!insert.ok) {
    check('cria linha de teste', false, inserted.error)
  } else {
    const id = inserted.row?.id
    restore = { projectId: project.id, cookie, id }
    check('cria linha de teste', Boolean(id))

    // Edita UMA celula, como o duplo clique faz
    const novoValor = 'valor escrito pelo editor de celula ✓'
    const patch = await fetch(`${BASE}/api/projects/${project.id}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ table: 'clients', pk: { id }, values: { notes: novoValor } }),
    })
    const patched = await patch.json()

    check('salva o valor da celula', patch.ok, patch.ok ? undefined : patched.error)
    check('resposta traz a linha atualizada', patched.row?.notes === novoValor)

    // Confere direto no banco, sem passar pela API
    const { data: fromDb } = await admin.from('clients').select('notes').eq('id', id).maybeSingle()
    check('valor persistiu no banco', fromDb?.notes === novoValor)

    // Define como null
    const toNull = await fetch(`${BASE}/api/projects/${project.id}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ table: 'clients', pk: { id }, values: { notes: null } }),
    })
    check('define a celula como null', toNull.ok)

    const { data: afterNull } = await admin.from('clients').select('notes').eq('id', id).maybeSingle()
    check('null persistiu no banco', afterNull?.notes === null)

    // A edicao aparece na auditoria
    const { data: logs } = await admin
      .from('audit_logs')
      .select('action, detail')
      .eq('action', 'data.row_updated')
      .order('created_at', { ascending: false })
      .limit(3)

    check(
      'edicao registrada na auditoria',
      (logs ?? []).some((l) => l.detail?.includes('clients')),
    )
  }
} finally {
  console.log('\nLimpeza')

  if (restore?.id) {
    await admin.from('clients').delete().eq('id', restore.id)
    console.log('  ok    linha de teste removida')
  }

  if (userId) {
    await admin.auth.admin.deleteUser(userId)
    await admin.from('audit_logs').delete().eq('actor', EMAIL)
    console.log('  ok    usuario e auditoria do teste removidos')
  }
}

console.log(`\n${failed === 0 ? 'Tudo funcionando.' : `${failed} problema(s).`}\n`)
process.exit(failed > 0 ? 1 : 0)
