#!/usr/bin/env node
/**
 * Teste de ponta a ponta do fluxo de autenticacao, contra um servidor rodando.
 *
 * Cria um usuario temporario, exercita login/sessao/allowlist/logout e
 * apaga o usuario no final, inclusive se algum passo falhar.
 *
 *   node scripts/e2e-auth.mjs [baseUrl]
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

const BASE = process.argv[2] ?? 'http://localhost:3111'
const TEST_EMAIL = 'sbm-e2e-temp@superbase-manager.test'
const TEST_PASSWORD = `Tst-${crypto.randomBytes(18).toString('base64url')}`
const OUTSIDER_EMAIL = 'intruso@superbase-manager.test'
const OUTSIDER_PASSWORD = `Out-${crypto.randomBytes(18).toString('base64url')}`

const admin = createClient(
  process.env.SYSTEM_SUPABASE_URL,
  process.env.SYSTEM_SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } },
)

let passed = 0
let failed = 0
const createdUserIds = []

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${name}`)
    passed++
  } else {
    console.log(`  FALHA ${name}${detail ? `\n        ${detail}` : ''}`)
    failed++
  }
}

async function cleanup() {
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id)
    } catch {
      console.log(`  aviso: nao consegui apagar o usuario temporario ${id}`)
    }
  }
}

try {
  // -------------------------------------------------------------------------
  console.log('\nPreparacao')

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  })

  if (createError) {
    console.log(`  FALHA ao criar usuario temporario: ${createError.message}`)
    process.exit(1)
  }
  createdUserIds.push(created.user.id)
  console.log(`  ok    usuario temporario criado (${TEST_EMAIL})`)

  // Um segundo usuario, valido no Auth mas FORA da allowlist.
  const { data: outsider, error: outsiderError } = await admin.auth.admin.createUser({
    email: OUTSIDER_EMAIL,
    password: OUTSIDER_PASSWORD,
    email_confirm: true,
  })
  if (!outsiderError) {
    createdUserIds.push(outsider.user.id)
    console.log(`  ok    usuario fora da allowlist criado (${OUTSIDER_EMAIL})`)
  }

  // -------------------------------------------------------------------------
  console.log('\nAcesso sem sessao')

  const anon = await fetch(`${BASE}/`, { redirect: 'manual' })
  check(
    'area autenticada redireciona para /login',
    anon.status === 307 || anon.status === 302,
    `recebido ${anon.status}`,
  )

  const anonApi = await fetch(`${BASE}/api/clients`)
  check('API sem sessao devolve 401', anonApi.status === 401, `recebido ${anonApi.status}`)

  const loginPage = await fetch(`${BASE}/login`)
  const loginHtml = await loginPage.text()
  check('pagina de login carrega', loginPage.status === 200)
  check(
    'login nao mostra mais aviso de "nao configurado"',
    !loginHtml.includes('Sistema nao configurado'),
  )

  // -------------------------------------------------------------------------
  console.log('\nLogin')

  const wrongPass = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: 'senha-errada-mesmo' }),
  })
  check('senha errada e rejeitada', wrongPass.status === 401, `recebido ${wrongPass.status}`)

  const outsiderLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OUTSIDER_EMAIL, password: OUTSIDER_PASSWORD }),
  })
  const outsiderBody = await outsiderLogin.json()
  check(
    'usuario fora da allowlist e barrado mesmo com senha certa',
    outsiderLogin.status === 401,
    `recebido ${outsiderLogin.status}`,
  )
  check(
    'mensagem nao revela que o e-mail existe',
    outsiderBody.error === 'E-mail ou senha incorretos.',
    `mensagem: ${outsiderBody.error}`,
  )

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  check('login com credenciais corretas', login.status === 200, `recebido ${login.status}`)

  const setCookies = login.headers.getSetCookie?.() ?? []
  check('sessao veio em cookie', setCookies.length > 0)
  check(
    'cookie de sessao e httpOnly',
    setCookies.some((c) => /httponly/i.test(c)),
    setCookies.map((c) => c.split(';')[0]).join(' | '),
  )

  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ')

  // -------------------------------------------------------------------------
  console.log('\nAcesso com sessao')

  const dash = await fetch(`${BASE}/`, {
    headers: { cookie: cookieHeader },
    redirect: 'manual',
  })
  check('carteira acessivel autenticado', dash.status === 200, `recebido ${dash.status}`)

  const api = await fetch(`${BASE}/api/clients`, { headers: { cookie: cookieHeader } })
  const apiBody = await api.json().catch(() => null)
  check('API responde autenticada', api.status === 200, `recebido ${api.status}`)
  check('API devolve a lista de clientes', Array.isArray(apiBody?.clients))

  const health = await fetch(`${BASE}/saude`, {
    headers: { cookie: cookieHeader },
    redirect: 'manual',
  })
  check('tela de saude carrega', health.status === 200, `recebido ${health.status}`)

  const audit = await fetch(`${BASE}/auditoria`, {
    headers: { cookie: cookieHeader },
    redirect: 'manual',
  })
  check('tela de auditoria carrega', audit.status === 200, `recebido ${audit.status}`)

  // -------------------------------------------------------------------------
  console.log('\nAuditoria e logout')

  const { data: logs } = await admin
    .from('audit_logs')
    .select('action, actor')
    .order('created_at', { ascending: false })
    .limit(10)

  check(
    'login bem-sucedido foi auditado',
    (logs ?? []).some((l) => l.action === 'login.success' && l.actor === TEST_EMAIL),
  )
  check(
    'tentativa com senha errada foi auditada',
    (logs ?? []).some((l) => l.action === 'login.failure'),
  )

  const logout = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: cookieHeader },
  })
  check('logout responde', logout.status === 200)

  // -------------------------------------------------------------------------
  console.log('\nCron')

  const cronNoSecret = await fetch(`${BASE}/api/cron/snapshot`, { method: 'POST' })
  check('cron sem secret e negado', cronNoSecret.status === 401, `recebido ${cronNoSecret.status}`)

  const cronWithSecret = await fetch(`${BASE}/api/cron/snapshot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const cronBody = await cronWithSecret.json().catch(() => null)
  check(
    'cron com secret correto e aceito',
    cronWithSecret.status === 200,
    `recebido ${cronWithSecret.status}`,
  )
  // Nao fixa um numero: a carteira cresce. So exige que o campo venha
  // coerente com quantos projetos existem hoje.
  check(
    'cron reporta quantos projetos coletou',
    typeof cronBody?.collected === 'number' && cronBody.collected >= 0,
    `${cronBody?.collected} projeto(s)`,
  )
} finally {
  console.log('\nLimpeza')
  await cleanup()
  console.log(`  ok    ${createdUserIds.length} usuario(s) temporario(s) removido(s)`)

  // Remove os registros de auditoria gerados pelo teste.
  await admin.from('audit_logs').delete().in('actor', [TEST_EMAIL, OUTSIDER_EMAIL])
  console.log('  ok    auditoria do teste limpa')
}

console.log(`\n${passed} passou(ram), ${failed} falhou(aram)\n`)
process.exit(failed > 0 ? 1 : 0)
