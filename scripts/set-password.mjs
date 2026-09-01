#!/usr/bin/env node
/**
 * Define (ou redefine) a senha do seu usuario de login.
 *
 * A senha e digitada aqui no terminal, com a digitacao oculta, nao passa por
 * arquivo, nem por argumento de linha de comando (que ficaria no histórico do
 * shell), nem por lugar nenhum que fique gravado.
 *
 *   npm run senha
 */
import fs from 'node:fs'
import readline from 'node:readline'
import { createClient } from '@supabase/supabase-js'

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

if (!url || !serviceKey || !anonKey || !allowed.length) {
  console.error('\nConfiguracao incompleta no .env.local. Rode `npm run check`.\n')
  process.exit(1)
}

/** Le do terminal escondendo o que e digitado. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const onData = (char) => {
      // Redesenha a linha sem mostrar os caracteres.
      if (!['\n', '\r', ''].includes(char.toString())) {
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(question)
      }
    }

    process.stdin.on('data', onData)
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const email = process.argv[2]?.trim().toLowerCase() ?? allowed[0]

if (!allowed.includes(email)) {
  console.error(`\n"${email}" nao esta em ALLOWED_EMAILS, nao adianta definir senha para ele.\n`)
  process.exit(1)
}

console.log(`\nDefinindo a senha de: ${email}`)
console.log('(a digitacao fica oculta)\n')

const password = await askHidden('Nova senha: ')
const confirm = await askHidden('Repita a senha: ')

if (password !== confirm) {
  console.error('\nAs senhas nao conferem. Nada foi alterado.\n')
  process.exit(1)
}

if (password.length < 8) {
  console.error('\nUse ao menos 8 caracteres (o Supabase recusa senhas curtas).\n')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 })
if (listError) {
  console.error(`\nFalha ao consultar usuarios: ${listError.message}\n`)
  process.exit(1)
}

const user = list.users.find((u) => (u.email ?? '').toLowerCase() === email)

if (!user) {
  console.error(`\nUsuario ${email} nao existe no Auth. Crie-o no painel primeiro.\n`)
  process.exit(1)
}

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
})

if (updateError) {
  console.error(`\nFalha ao definir a senha: ${updateError.message}\n`)
  process.exit(1)
}

console.log('  ok    senha definida')

// Confirma de verdade fazendo login com a anon key, como o app faz.
const check = createClient(url, anonKey, { auth: { persistSession: false } })
const { error: signInError } = await check.auth.signInWithPassword({ email, password })

if (signInError) {
  console.error(`\n  FALHA na verificacao: ${signInError.message}`)
  console.error('  A senha foi gravada, mas o login de teste nao passou.\n')
  process.exit(1)
}

// Descarta a sessao criada so para verificar, senao fica um refresh token
// valido pendurado no servidor, sem ninguem usando.
await check.auth.signOut()

console.log('  ok    login verificado com a nova senha')
console.log('\nPronto. Entre em http://localhost:3000\n')
