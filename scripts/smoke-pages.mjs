#!/usr/bin/env node
/**
 * Percorre todas as telas do app autenticado e verifica que carregam sem erro.
 *
 * Usa um usuario temporario (criado e apagado aqui) para nao depender da sua
 * senha nem da sua sessao.
 *
 *   npm run smoke [baseUrl]
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
// Fixo, para poder constar na ALLOWED_EMAILS do servidor durante o teste.
const EMAIL = process.env.SMOKE_EMAIL ?? 'sbm-smoke-test@superbase-manager.test'
const PASSWORD = `Smk-${crypto.randomBytes(18).toString('base64url')}`

const admin = createClient(
  process.env.SYSTEM_SUPABASE_URL,
  process.env.SYSTEM_SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } },
)

let userId = null
let failed = 0

/**
 * Sinais de erro real. Nao inclui "This page could not be found": em modo dev
 * o Next injeta o template do 404 em toda pagina, o que daria falso positivo.
 */
function looksBroken(html) {
  return (
    html.includes('Application error') ||
    html.includes('Internal Server Error') ||
    html.includes('MODULE_NOT_FOUND') ||
    html.includes('Cannot find module') ||
    html.includes('Unhandled Runtime Error')
  )
}

try {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error) {
    console.error(`\nFalha ao criar usuario temporario: ${error.message}\n`)
    process.exit(1)
  }
  userId = created.user.id

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })

  if (login.status !== 200) {
    console.error(
      `\nO usuario de teste nao entrou (status ${login.status}).` +
        `\nRode com ALLOWED_EMAILS incluindo ${EMAIL}, ou use npm run smoke apos ajustar.\n`,
    )
    process.exit(1)
  }

  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

  // Cada tela traz um marcador que so aparece se ela renderizou de verdade.
  const PAGES = [
    ['Carteira', '/', 'Carteira'],
    ['Saúde geral', '/saude', 'Saúde geral'],
    ['Clientes', '/clientes', 'Clientes'],
    ['Conexoes', '/conexoes', 'Conectar uma conta'],
    ['Auditoria', '/auditoria', 'Auditoria'],
  ]

  console.log('\nTelas')
  for (const [name, path, marker] of PAGES) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
    const html = await res.text()

    const rendered = html.includes(marker) || html.includes(marker.replace(/&#x[0-9A-F]+;/g, ''))
    const ok = res.status === 200 && !looksBroken(html) && rendered

    console.log(
      `  ${ok ? 'ok   ' : 'FALHA'} ${name.padEnd(14)} ${path}  (${res.status})` +
        (ok ? '' : rendered ? '  [erro no html]' : '  [conteudo esperado ausente]'),
    )
    if (!ok) failed++
  }

  // A marca precisa estar servida corretamente
  console.log('\nMarca')
  for (const [label, path] of [
    ['logograma', '/brand/logograma.png'],
    ['logo horizontal', '/brand/logo-horizontal.png'],
    ['favicon', '/icon.png'],
  ]) {
    const res = await fetch(`${BASE}${path}`)
    const type = res.headers.get('content-type') ?? ''
    const ok = res.status === 200 && type.includes('image')
    console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${label.padEnd(16)} ${path}  (${res.status})`)
    if (!ok) failed++
  }

  const APIS = [
    ['clientes', '/api/clients'],
    ['contas', '/api/accounts'],
  ]

  console.log('\nAPIs')
  for (const [name, path] of APIS) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
    const ok = res.status === 200
    console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${name.padEnd(14)} ${path}  (${res.status})`)
    if (!ok) failed++
  }

  console.log('\nAssets')
  const notFound = await fetch(`${BASE}/rota-que-nao-existe`, { headers: { cookie } })
  console.log(
    `  ${notFound.status === 404 ? 'ok   ' : 'FALHA'} pagina 404 responde corretamente  (${notFound.status})`,
  )
  if (notFound.status !== 404) failed++
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId)
    await admin.from('audit_logs').delete().eq('actor', EMAIL)
    console.log('\n  ok    usuario temporario removido')
  }
}

console.log(`\n${failed === 0 ? 'Tudo funcionando.' : `${failed} problema(s) encontrado(s).`}\n`)
process.exit(failed > 0 ? 1 : 0)
