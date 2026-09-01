#!/usr/bin/env node
/**
 * Testa o No Sleep contra um projeto real: instala, confere que a tabela,
 * a linha e o agendamento existem, valida a idempotência, e DESINSTALA
 * tudo ao final, inclusive se algo falhar no meio.
 *
 *   node scripts/test-no-sleep.mjs [baseUrl] [nomeDoProjeto]
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
const TARGET = process.argv[3] ?? 'SuperBase'
const EMAIL = 'sbm-smoke-test@superbase-manager.test'
const PASSWORD = 'No-sleep-test-4242'

const admin = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

let userId = null
let installed = false
let projectId = null
let cookie = ''
let failed = 0

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed++
}

const status = async () =>
  (await fetch(`${BASE}/api/projects/${projectId}/no-sleep`, { headers: { cookie } })).json()

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
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

  const { data: projects } = await admin
    .from('projects')
    .select('id, name')
    .is('archived_at', null)
  const project = projects?.find((p) => p.name === TARGET) ?? projects?.[0]

  if (!project) {
    console.error('\nNenhum projeto conectado.\n')
    process.exit(1)
  }
  projectId = project.id

  console.log(`\nProjeto de teste: ${project.name}\n`)

  /* ── Estado inicial ───────────────────────────────────────────────── */
  console.log('Antes de instalar')
  const before = await status()
  check('reporta como NAO instalado', before.installed === false, `tabela=${before.tableExists}`)

  if (before.installed) {
    console.log('\n  Ja estava instalado neste projeto, abortando para nao mexer.\n')
    process.exit(0)
  }

  /* ── Instalação ───────────────────────────────────────────────────── */
  console.log('\nInstalando')
  const install = await fetch(`${BASE}/api/projects/${projectId}/no-sleep`, {
    method: 'POST',
    headers: { cookie },
  })
  const installData = await install.json()
  check('instalacao responde ok', install.ok, install.ok ? installData.steps?.join(', ') : installData.error)
  if (install.ok) installed = true

  /* ── Estado depois ────────────────────────────────────────────────── */
  console.log('\nDepois de instalar')
  const after = await status()

  check('reporta como instalado', after.installed === true)
  check('tabela no_sleep existe', after.tableExists === true)
  check('extensao pg_cron instalada', after.cronInstalled === true)
  check('agendamento existe', Boolean(after.job), after.job?.schedule)
  check('agendamento esta ativo', after.job?.active === true)
  check('agendamento e diario a meia-noite', after.job?.schedule === '0 0 * * *')
  check('linha inicial existe', Boolean(after.row))
  check(
    'primeira execucao ja rodou (valor mudou de 1)',
    after.row != null && Number(after.row.numero) !== 1,
    `numero=${after.row?.numero}`,
  )
  check('atualizado_em foi preenchido', Boolean(after.row?.atualizado_em))

  /* ── Idempotência ─────────────────────────────────────────────────── */
  console.log('\nInstalando de novo (deve ser seguro)')
  const again = await fetch(`${BASE}/api/projects/${projectId}/no-sleep`, {
    method: 'POST',
    headers: { cookie },
  })
  check('segunda instalacao nao quebra', again.ok)

  const afterAgain = await status()
  check('continua com uma unica linha e um agendamento', afterAgain.installed === true)

  /* ── Auditoria ────────────────────────────────────────────────────── */
  const { data: logs } = await admin
    .from('audit_logs')
    .select('action')
    .eq('action', 'cron.no_sleep_installed')
    .limit(1)
  check('instalacao registrada na auditoria', (logs ?? []).length > 0)
} finally {
  console.log('\nLimpeza')

  if (installed && projectId) {
    const res = await fetch(`${BASE}/api/projects/${projectId}/no-sleep?dropTable=1`, {
      method: 'DELETE',
      headers: { cookie },
    })
    console.log(`  ${res.ok ? 'ok   ' : 'FALHA'} No Sleep desinstalado (agendamento e tabela)`)

    const final = await status().catch(() => null)
    if (final) {
      console.log(
        `  ${!final.installed && !final.tableExists ? 'ok   ' : 'FALHA'} projeto voltou ao estado original`,
      )
    }
  }

  if (userId) {
    await admin.auth.admin.deleteUser(userId)
    await admin.from('audit_logs').delete().eq('actor', EMAIL)
    console.log('  ok    usuario e auditoria do teste removidos')
  }
}

console.log(`\n${failed === 0 ? 'Tudo funcionando.' : `${failed} problema(s).`}\n`)
process.exit(failed > 0 ? 1 : 0)
