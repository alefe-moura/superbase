#!/usr/bin/env node
/**
 * Verifica a separação entre credencial pública e secreta no MCP.
 *
 * A anon key é pública por design, vai em código de frontend e respeita RLS.
 * A service_role key não: quem a tem fala direto com o banco e contorna todas
 * as barreiras deste servidor. Por isso ela exige permissão explícita.
 *
 *   node scripts/test-mcp-secrets.mjs [baseUrl]
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

const MCP = `${process.argv[2] ?? 'http://localhost:3000'}/api/mcp`

const db = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const criados = []
let falhas = 0

const check = (nome, ok, detalhe = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  if (!ok) falhas++
}

let seq = 0
async function call(tool, args, token) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++seq,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  })
  const body = await res.json()
  const texto = body?.result?.content?.[0]?.text ?? ''
  try {
    return JSON.parse(texto)
  } catch {
    return { _texto: texto }
  }
}

async function criarToken(nome, canReadSecrets) {
  const token = `sbm_${crypto.randomBytes(32).toString('base64url')}`
  const { data } = await db
    .from('mcp_tokens')
    .insert({
      name: nome,
      token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      token_prefix: token.slice(0, 12),
      can_read_secrets: canReadSecrets,
    })
    .select('id')
    .single()
  criados.push(data.id)
  return token
}

try {
  const { data: projeto } = await db
    .from('projects')
    .select('name')
    .is('archived_at', null)
    .limit(1)
    .single()

  console.log(`\nCredenciais via MCP, projeto ${projeto.name}\n`)

  /* ── Token comum ─────────────────────────────────────────────────── */
  console.log('Token SEM permissao de ler credenciais')
  const comum = await criarToken('teste-sem-segredo', false)

  const publico = await call('obter_credenciais', { projeto: projeto.name }, comum)
  check('recebe a URL do projeto', typeof publico.url === 'string', publico.url)
  check('recebe a anon key', typeof publico.anon_key === 'string' && publico.anon_key.length > 20)
  check('NAO recebe a service_role key', publico.service_role_key === undefined)
  check('NAO recebe a connection string', publico.connection_string === undefined)

  const tentativa = await call(
    'obter_credenciais',
    { projeto: projeto.name, incluir_secretas: true },
    comum,
  )
  check('pedir a secreta e negado', typeof tentativa.secretas_negadas === 'string')
  check('mesmo pedindo, nao vem a service_role', tentativa.service_role_key === undefined)
  check(
    'a negativa explica como habilitar',
    /Agentes/.test(tentativa.secretas_negadas ?? ''),
    (tentativa.secretas_negadas ?? '').slice(0, 60),
  )

  /* ── Token autorizado ────────────────────────────────────────────── */
  console.log('\nToken COM permissao')
  const autorizado = await criarToken('teste-com-segredo', true)

  const semPedir = await call('obter_credenciais', { projeto: projeto.name }, autorizado)
  check(
    'sem pedir explicitamente, a secreta NAO vem',
    semPedir.service_role_key === undefined,
    'precisa de incluir_secretas: true',
  )

  const comSegredo = await call(
    'obter_credenciais',
    { projeto: projeto.name, incluir_secretas: true },
    autorizado,
  )
  check(
    'pedindo, recebe a service_role key',
    typeof comSegredo.service_role_key === 'string' && comSegredo.service_role_key.length > 20,
  )
  check('vem com aviso sobre o risco', /RLS|acesso total/i.test(comSegredo.aviso ?? ''))

  /* ── Auditoria ───────────────────────────────────────────────────── */
  console.log('\nRastro')
  const { data: logs } = await db
    .from('audit_logs')
    .select('action, detail, actor')
    .eq('action', 'project.keys_revealed')
    .order('created_at', { ascending: false })
    .limit(5)

  const registro = (logs ?? []).find((l) => l.actor === 'agente:teste-com-segredo')
  check('entrega da credencial foi auditada', Boolean(registro))
  check(
    'a auditoria identifica o agente',
    registro?.actor?.startsWith('agente:') === true,
    registro?.actor,
  )
  check(
    'nenhuma auditoria para o token que so leu a parte publica',
    !(logs ?? []).some((l) => l.actor === 'agente:teste-sem-segredo'),
  )
} catch (err) {
  console.error(`\nErro: ${err.message}\n`)
  falhas++
} finally {
  console.log('\nLimpeza')
  if (criados.length) {
    await db.from('mcp_calls').delete().in('token_id', criados)
    await db.from('mcp_tokens').delete().in('id', criados)
    await db.from('audit_logs').delete().like('actor', 'agente:teste-%')
    console.log(`  ok    ${criados.length} token(s) de teste removido(s)`)
  }
}

console.log(`\n${falhas === 0 ? 'A separacao publica/secreta funciona.' : `${falhas} problema(s).`}\n`)
process.exit(falhas ? 1 : 0)
