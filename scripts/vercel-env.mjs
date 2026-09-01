#!/usr/bin/env node
/**
 * Imprime as variáveis de ambiente que a Vercel precisa, prontas para colar.
 *
 * Roda no SEU terminal e lê do .env.local, os valores não saem daqui.
 *
 *   npm run vercel:env
 */
import fs from 'node:fs'

if (!fs.existsSync('.env.local')) {
  console.error('\n.env.local não encontrado. Rode `npm run check` primeiro.\n')
  process.exit(1)
}

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2]
}

const REQUIRED = [
  ['SYSTEM_SUPABASE_URL', 'URL do projeto Supabase do sistema'],
  ['SYSTEM_SUPABASE_SERVICE_KEY', 'service_role key (secreta)'],
  ['SYSTEM_SUPABASE_ANON_KEY', 'anon key (pública)'],
  ['ALLOWED_EMAILS', 'quem pode entrar'],
  ['APP_ENCRYPTION_KEY', 'chave do cofre, TEM que ser idêntica à local'],
  ['CRON_SECRET', 'autoriza o agendamento da Vercel'],
  ['SNAPSHOT_RETENTION_DAYS', 'opcional (padrão 30)'],
]

console.log(`
Variáveis para colar na Vercel
(Project Settings → Environment Variables → aplicar a Production, Preview e Development)
${'─'.repeat(78)}`)

let missing = 0

for (const [key, note] of REQUIRED) {
  const value = env[key]
  if (!value) {
    console.log(`\n  ${key}\n    FALTANDO, ${note}`)
    missing++
    continue
  }
  console.log(`\n  ${key}\n  ${value}\n    ↳ ${note}`)
}

console.log(`\n${'─'.repeat(78)}`)

if (missing) {
  console.log(`\n${missing} variável(is) faltando no .env.local.\n`)
  process.exit(1)
}

console.log(`
Depois do primeiro deploy, faltam dois passos:

  1. Supabase → Authentication → URL Configuration
     Adicione a URL da Vercel em "Site URL" e "Redirect URLs".
     Sem isso, o "esqueci minha senha" aponta para localhost.

  2. Acesse a URL, faça login e abra "Saúde geral".
     Se as métricas aparecerem, está tudo ligado.

Atenção à APP_ENCRYPTION_KEY: se ela for diferente da local, o cofre não abre
e os projetos já conectados ficam ilegíveis. Tem que ser exatamente a mesma.
`)
