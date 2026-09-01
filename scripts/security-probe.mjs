#!/usr/bin/env node
/**
 * Sonda de seguranca: tenta invadir o proprio sistema, como um estranho faria.
 *
 * Usa apenas o que e publico (URL + anon key) e verifica se a allowlist do
 * servidor realmente segura, independente de o cadastro estar aberto no painel.
 * Limpa qualquer usuario que tenha conseguido criar.
 *
 *   npm run probe [baseUrl]
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

const BASE = process.argv[2] ?? 'http://localhost:3000'
const { SYSTEM_SUPABASE_URL: url, SYSTEM_SUPABASE_ANON_KEY: anonKey, SYSTEM_SUPABASE_SERVICE_KEY: serviceKey } = process.env

const attacker = createClient(url, anonKey, { auth: { persistSession: false } })
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const INTRUDER_EMAIL = `intruso-${crypto.randomBytes(4).toString('hex')}@teste-invasao.test`
const INTRUDER_PASSWORD = `Inv-${crypto.randomBytes(18).toString('base64url')}`

let signupOpen = false
let intruderId = null
let issues = 0

function report(name, safe, detail) {
  console.log(`  ${safe ? 'SEGURO ' : 'ATENCAO'} ${name}${detail ? `\n          ${detail}` : ''}`)
  if (!safe) issues++
}

try {
  // -------------------------------------------------------------------------
  console.log('\n1. O cadastro publico esta aberto?')

  const { data: signup, error: signupError } = await attacker.auth.signUp({
    email: INTRUDER_EMAIL,
    password: INTRUDER_PASSWORD,
  })

  if (signupError) {
    signupOpen = false
    console.log(`  Nao. O Supabase recusou: "${signupError.message}"`)
    console.log('  => Cadastro publico esta FECHADO.')
  } else {
    signupOpen = true
    intruderId = signup.user?.id ?? null
    console.log('  SIM, qualquer pessoa com a URL e a anon key consegue criar conta.')
    console.log(`  Conta criada: ${INTRUDER_EMAIL}`)
  }

  // -------------------------------------------------------------------------
  console.log('\n2. Com uma conta valida, o intruso entra no sistema?')

  if (!signupOpen) {
    console.log('  (pulado, nem deu para criar conta)')
  } else {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: INTRUDER_EMAIL, password: INTRUDER_PASSWORD }),
    })
    const body = await login.json().catch(() => ({}))

    report(
      'login do intruso e recusado pela allowlist',
      login.status === 401,
      `status ${login.status}, "${body.error ?? ''}"`,
    )

    const cookies = login.headers.getSetCookie?.() ?? []
    report('nenhum cookie de sessao foi entregue ao intruso', cookies.length === 0)

    // Mesmo com um token legitimo do Supabase, o app deve barrar.
    const { data: direct } = await attacker.auth.signInWithPassword({
      email: INTRUDER_EMAIL,
      password: INTRUDER_PASSWORD,
    })

    if (direct?.session) {
      console.log('  (o intruso conseguiu um token direto do Supabase, como esperado)')
      const withToken = await fetch(`${BASE}/api/clients`, {
        headers: { Authorization: `Bearer ${direct.session.access_token}` },
      })
      report(
        'token valido do Supabase nao abre a API do app',
        withToken.status === 401,
        `status ${withToken.status}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n3. A anon key sozinha le algum dado do sistema?')

  const tables = ['projects', 'accounts', 'clients', 'audit_logs', 'snapshots', 'query_history']
  let leaked = []

  for (const table of tables) {
    const { data, error } = await attacker.from(table).select('*').limit(1)
    if (!error && data && data.length > 0) leaked.push(table)
  }

  report(
    'RLS bloqueia leitura das tabelas com a anon key',
    leaked.length === 0,
    leaked.length ? `VAZOU: ${leaked.join(', ')}` : undefined,
  )

  // -------------------------------------------------------------------------
  console.log('\n4. A anon key consegue escrever?')

  const { error: writeError } = await attacker
    .from('clients')
    .insert({ name: 'invasao-teste' })

  report('RLS bloqueia escrita com a anon key', Boolean(writeError), writeError ? undefined : 'INSERIU!')

  if (!writeError) {
    await admin.from('clients').delete().eq('name', 'invasao-teste')
  }

  // -------------------------------------------------------------------------
  console.log('\n5. O endpoint do cron aceita disparo sem o segredo?')

  const cron = await fetch(`${BASE}/api/cron/snapshot`, { method: 'POST' })
  report('cron exige o CRON_SECRET', cron.status === 401, `status ${cron.status}`)
} finally {
  console.log('\nLimpeza')
  if (intruderId) {
    await admin.auth.admin.deleteUser(intruderId)
    console.log('  ok    conta de teste do intruso removida')
  }
  await admin.from('audit_logs').delete().like('actor', '%teste-invasao.test')
  console.log('  ok    auditoria do teste limpa')
}

console.log('\n' + '='.repeat(64))
console.log(`Cadastro publico: ${signupOpen ? 'ABERTO' : 'fechado'}`)
console.log(`Problemas encontrados: ${issues}`)

if (signupOpen && issues === 0) {
  console.log('\nO cadastro esta aberto, mas ninguem entra: a allowlist do servidor')
  console.log('barra qualquer e-mail fora da lista. Fechar o cadastro no painel')
  console.log('continua sendo recomendado, e a primeira tranca das duas.')
}

console.log('')
process.exit(issues > 0 ? 1 : 0)
