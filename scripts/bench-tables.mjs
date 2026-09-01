#!/usr/bin/env node
/**
 * Mede onde o tempo é gasto ao abrir a aba Tabelas.
 *
 * Compara as estratégias de contagem do PostgREST, que é a suspeita
 * principal: `count=exact` faz varredura completa da tabela a cada página.
 *
 *   node scripts/bench-tables.mjs
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

const KEY = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64')

function decrypt(envelope) {
  if (!envelope) return null
  const [v, iv, tag, ct] = envelope.split('.')
  if (v !== 'v1') return null
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

const db = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

async function timed(label, fn) {
  const t0 = performance.now()
  let extra = ''
  try {
    extra = (await fn()) ?? ''
  } catch (err) {
    extra = `erro: ${err.message}`
  }
  const ms = Math.round(performance.now() - t0)
  const bar = '█'.repeat(Math.min(40, Math.round(ms / 40)))
  console.log(`    ${String(ms).padStart(6)} ms  ${bar} ${label}${extra ? `  (${extra})` : ''}`)
  return ms
}

const { data: projects } = await db
  .from('projects')
  .select('id, name, url, service_key_enc')
  .is('archived_at', null)
  .order('name')

console.log('\nMedindo o carregamento da aba Tabelas contra os bancos reais.\n')

const totals = { spec: [], exact: [], planned: [], nocount: [] }

for (const project of projects ?? []) {
  const serviceKey = decrypt(project.service_key_enc)
  if (!serviceKey) {
    console.log(`\n  ${project.name}: sem service_role key, pulando`)
    continue
  }

  const base = project.url.replace(/\/+$/, '')
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  console.log(`\n  ${project.name}`)

  // 1. Descoberta do schema (roda uma vez ao abrir a aba)
  let tables = []
  const specMs = await timed('spec OpenAPI (lista de tabelas)', async () => {
    const res = await fetch(`${base}/rest/v1/`, { headers, cache: 'no-store' })
    const spec = await res.json()
    tables = Object.keys(spec?.definitions ?? {})
    const bytes = JSON.stringify(spec).length
    return `${tables.length} tabelas, ${(bytes / 1024).toFixed(0)} KB`
  })
  totals.spec.push(specMs)

  if (!tables.length) {
    console.log('    (sem tabelas expostas)')
    continue
  }

  // Usa a primeira tabela como amostra
  const table = tables[0]
  const url = `${base}/rest/v1/${encodeURIComponent(table)}?select=*`

  console.log(`   , amostra: tabela "${table}"`)

  const exactMs = await timed('50 linhas COM count=exact  (como está hoje)', async () => {
    const res = await fetch(url, {
      headers: { ...headers, Range: '0-49', Prefer: 'count=exact' },
      cache: 'no-store',
    })
    const total = res.headers.get('content-range')?.split('/')[1]
    return `total=${total}`
  })
  totals.exact.push(exactMs)

  const plannedMs = await timed('50 linhas com count=planned (estimado)', async () => {
    const res = await fetch(url, {
      headers: { ...headers, Range: '0-49', Prefer: 'count=planned' },
      cache: 'no-store',
    })
    const total = res.headers.get('content-range')?.split('/')[1]
    return `total≈${total}`
  })
  totals.planned.push(plannedMs)

  const noCountMs = await timed('50 linhas SEM contagem', async () => {
    const res = await fetch(url, { headers: { ...headers, Range: '0-49' }, cache: 'no-store' })
    const rows = await res.json()
    return `${Array.isArray(rows) ? rows.length : 0} linhas`
  })
  totals.nocount.push(noCountMs)
}

const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0)

console.log('\n' + '═'.repeat(70))
console.log('Médias')
console.log(`  spec OpenAPI (1x ao abrir a aba)        ${String(avg(totals.spec)).padStart(6)} ms`)
console.log(`  linhas com count=exact  (hoje)          ${String(avg(totals.exact)).padStart(6)} ms`)
console.log(`  linhas com count=planned                ${String(avg(totals.planned)).padStart(6)} ms`)
console.log(`  linhas sem contagem                     ${String(avg(totals.nocount)).padStart(6)} ms`)

const overhead = avg(totals.exact) - avg(totals.nocount)
console.log(`\n  Custo da contagem exata: ${overhead} ms por página`)
console.log('')
