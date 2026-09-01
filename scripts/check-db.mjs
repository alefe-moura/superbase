#!/usr/bin/env node
/**
 * Verifica se o sistema esta pronto para uso: configuracao, banco, migration
 * e usuario de login.
 *
 *   npm run check
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Carrega o .env.local sem depender de pacote externo.
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

const url = process.env.SYSTEM_SUPABASE_URL
const serviceKey = process.env.SYSTEM_SUPABASE_SERVICE_KEY
const anonKey = process.env.SYSTEM_SUPABASE_ANON_KEY
const allowed = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

let problems = 0
const fail = (msg) => {
  console.log(`  FALTA ${msg}`)
  problems++
}

console.log('\nConfiguracao')

for (const [name, value] of [
  ['SYSTEM_SUPABASE_URL', url],
  ['SYSTEM_SUPABASE_SERVICE_KEY', serviceKey],
  ['SYSTEM_SUPABASE_ANON_KEY', anonKey],
  ['APP_ENCRYPTION_KEY', process.env.APP_ENCRYPTION_KEY],
  ['CRON_SECRET', process.env.CRON_SECRET],
]) {
  if (value) console.log(`  ok    ${name}`)
  else fail(name)
}

if (allowed.length) console.log(`  ok    ALLOWED_EMAILS (${allowed.join(', ')})`)
else fail('ALLOWED_EMAILS, sem ela ninguem entra (falha fechada, de proposito)')

if (problems) {
  console.log('\nPreencha o .env.local e rode de novo.\n')
  process.exit(1)
}

// Tamanho da chave do cofre, erro comum e colar truncada.
const keyBytes = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64').length
if (keyBytes !== 32) {
  console.log(`\n  ERRO: APP_ENCRYPTION_KEY tem ${keyBytes} bytes, esperado 32.\n`)
  process.exit(1)
}

// Confere que cada chave tem o papel certo, trocar as duas e erro classico.
function roleOf(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()).role
  } catch {
    return null
  }
}

for (const [name, jwt, expected] of [
  ['SYSTEM_SUPABASE_SERVICE_KEY', serviceKey, 'service_role'],
  ['SYSTEM_SUPABASE_ANON_KEY', anonKey, 'anon'],
]) {
  const role = roleOf(jwt)
  if (role && role !== expected) {
    console.log(`\n  ERRO: ${name} tem role "${role}", esperado "${expected}". As chaves estao trocadas?\n`)
    process.exit(1)
  }
  if (role) console.log(`  ok    ${name} e mesmo ${expected}`)
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } })

console.log('\nTabelas do sistema')

const TABLES = ['clients', 'accounts', 'projects', 'snapshots', 'audit_logs', 'query_history']

let migrationOk = true
for (const table of TABLES) {
  const { error, count } = await db.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    console.log(`  FALTA ${table}  (${error.message})`)
    migrationOk = false
  } else {
    console.log(`  ok    ${table}  (${count ?? 0} registro(s))`)
  }
}

// Sobra da versao com login proprio, deve ter sido removida pela 0002.
const { error: legacyError } = await db.from('app_users').select('*', { head: true, count: 'exact' })
if (!legacyError) {
  console.log('\n  aviso: a tabela app_users ainda existe (sobra do login antigo).')
  console.log('  Rode supabase/migrations/0002_drop_app_users.sql para remove-la.')
}

if (!migrationOk) {
  console.log('\nA migration nao foi aplicada (ou foi parcialmente).')
  console.log('Rode supabase/migrations/0001_init.sql no SQL Editor do projeto.\n')
  process.exit(1)
}

const { error: rpcError } = await db.rpc('prune_snapshots', { days: 30 })
console.log(rpcError ? `  aviso: prune_snapshots indisponivel (${rpcError.message})` : '  ok    funcao prune_snapshots')

// ---------------------------------------------------------------------------
// Usuario de login (Supabase Auth)
// ---------------------------------------------------------------------------

console.log('\nLogin (Supabase Auth)')

const { data: authData, error: authError } = await db.auth.admin.listUsers({ perPage: 100 })

if (authError) {
  console.log(`  ERRO ao listar usuarios: ${authError.message}`)
  process.exit(1)
}

const users = authData?.users ?? []

if (!users.length) {
  console.log('  Nenhum usuario cadastrado ainda.')
  console.log('\n  Crie o seu no painel do Supabase:')
  console.log('    Authentication > Users > Add user > Create new user')
  console.log(`    E-mail: ${allowed[0]}`)
  console.log('    Marque "Auto Confirm User".\n')
  process.exit(1)
}

let matched = false
for (const user of users) {
  const email = (user.email ?? '').toLowerCase()
  const ok = allowed.includes(email)
  if (ok) matched = true
  console.log(
    `  ${ok ? 'ok   ' : 'aviso'} ${user.email}${ok ? '' : ', NAO esta em ALLOWED_EMAILS, nao consegue entrar'}` +
      `${user.email_confirmed_at ? '' : '  [e-mail nao confirmado]'}`,
  )
}

console.log('\nResultado')
if (!matched) {
  console.log('  Existem usuarios, mas nenhum bate com ALLOWED_EMAILS.')
  console.log('  Ajuste ALLOWED_EMAILS no .env.local ou crie o usuario correto.\n')
  process.exit(1)
}

console.log('  Tudo pronto. Rode `npm run dev` e faca login.\n')
