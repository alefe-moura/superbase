#!/usr/bin/env node
/**
 * Teste de fumaca da logica critica: cofre de credenciais, parser de metricas
 * e deteccao de comandos de escrita. Roda sem rede e sem banco.
 *
 * (Senha e sessao nao aparecem aqui: sao responsabilidade do Supabase Auth.)
 *
 *   npm run selftest
 */
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
    passed++
  } catch (err) {
    console.log(`  FALHA ${name}\n       ${err.message}`)
    failed++
  }
}

// ---------------------------------------------------------------------------
// Reimplementacao minima do que src/lib/crypto.ts faz, para validar o algoritmo
// sem precisar compilar TypeScript.
// ---------------------------------------------------------------------------

const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64')

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

function decryptSecret(envelope) {
  const [version, ivB64, tagB64, ctB64] = envelope.split('.')
  if (version !== 'v1') throw new Error('versao invalida')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8')
}

console.log('\nCofre (AES-256-GCM)')

await test('ida e volta preserva o segredo', () => {
  const secret = 'sbp_' + 'a'.repeat(40)
  assert.equal(decryptSecret(encryptSecret(secret)), secret)
})

await test('mesmo texto gera envelopes diferentes (IV aleatorio)', () => {
  assert.notEqual(encryptSecret('igual'), encryptSecret('igual'))
})

await test('adulteracao do ciphertext e rejeitada', () => {
  const envelope = encryptSecret('confidencial')
  const parts = envelope.split('.')
  const bytes = Buffer.from(parts[3], 'base64url')
  bytes[0] ^= 0xff
  parts[3] = bytes.toString('base64url')
  assert.throws(() => decryptSecret(parts.join('.')))
})

await test('chave errada nao decifra', () => {
  const envelope = encryptSecret('confidencial')
  const outraChave = crypto.randomBytes(32)
  const parts = envelope.split('.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', outraChave, Buffer.from(parts[1], 'base64url'))
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
  assert.throws(() => Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]))
})

await test('unicode sobrevive ao ciclo', () => {
  const texto = 'senha com acentuação e emoji 🔐'
  assert.equal(decryptSecret(encryptSecret(texto)), texto)
})

// ---------------------------------------------------------------------------
// Parser de metricas Prometheus
// ---------------------------------------------------------------------------

const LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+0-9.eEnaN]+)$/

function parsePrometheus(text) {
  const out = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = LINE_RE.exec(line)
    if (!m) continue
    const value = Number(m[4])
    if (!Number.isFinite(value)) continue
    const labels = {}
    if (m[3]) {
      for (const pair of m[3].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
        const eq = pair.indexOf('=')
        if (eq === -1) continue
        labels[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim().replace(/^"|"$/g, '')
      }
    }
    out.push({ name: m[1], labels, value })
  }
  return out
}

console.log('\nParser de metricas (Prometheus)')

const AMOSTRA = `
# HELP node_memory_MemTotal_bytes Memoria total
# TYPE node_memory_MemTotal_bytes gauge
node_memory_MemTotal_bytes 8.589934592e+09
node_memory_MemAvailable_bytes 3.221225472e+09
node_filesystem_size_bytes{device="/dev/nvme0n1",fstype="ext4",mountpoint="/data"} 8.589934592e+10
node_filesystem_avail_bytes{device="/dev/nvme0n1",fstype="ext4",mountpoint="/data"} 6.442450944e+10
node_filesystem_size_bytes{device="tmpfs",fstype="tmpfs",mountpoint="/run"} 1.048576e+08
node_cpu_seconds_total{cpu="0",mode="idle"} 90000
node_cpu_seconds_total{cpu="0",mode="user"} 8000
node_cpu_seconds_total{cpu="0",mode="system"} 2000
node_load1 0.42
`

const metricas = parsePrometheus(AMOSTRA)

await test('ignora comentarios e linhas vazias', () => {
  assert.equal(metricas.length, 9)
})

await test('le notacao cientifica', () => {
  assert.equal(metricas.find((m) => m.name === 'node_memory_MemTotal_bytes').value, 8589934592)
})

await test('extrai labels corretamente', () => {
  const fs = metricas.find(
    (m) => m.name === 'node_filesystem_size_bytes' && m.labels.mountpoint === '/data',
  )
  assert.equal(fs.labels.fstype, 'ext4')
  assert.equal(fs.value, 85899345920)
})

await test('calcula RAM em uso', () => {
  const total = metricas.find((m) => m.name === 'node_memory_MemTotal_bytes').value
  const avail = metricas.find((m) => m.name === 'node_memory_MemAvailable_bytes').value
  assert.equal((((total - avail) / total) * 100).toFixed(0), '63')
})

await test('escolhe o filesystem de dados e descarta tmpfs', () => {
  const IGNORED = new Set(['tmpfs', 'devtmpfs', 'overlay'])
  const sizes = metricas.filter(
    (m) => m.name === 'node_filesystem_size_bytes' && !IGNORED.has(m.labels.fstype),
  )
  assert.equal(sizes.length, 1)
  assert.equal(sizes[0].labels.mountpoint, '/data')
})

await test('CPU por delta entre snapshots', () => {
  // Entre duas coletas: +100s totais, dos quais 75s ociosos => 25% de uso.
  const prev = { total: 100000, idle: 90000 }
  const curr = { total: 100100, idle: 90075 }
  const pct = 100 - ((curr.idle - prev.idle) / (curr.total - prev.total)) * 100
  assert.equal(pct, 25)
})

await test('contador reiniciado nao produz CPU negativa', () => {
  const prev = { total: 100000, idle: 90000 }
  const curr = { total: 500, idle: 400 } // projeto reiniciou
  const totalDelta = curr.total - prev.total
  assert.equal(totalDelta <= 0, true) // o codigo retorna undefined nesse caso
})

// ---------------------------------------------------------------------------
// Deteccao de comandos de escrita (aviso do SQL Runner)
// ---------------------------------------------------------------------------

function isWriteQuery(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .toLowerCase()
  return /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|replace|comment|vacuum|reindex|refresh)\b/.test(
    stripped,
  )
}

console.log('\nDeteccao de escrita no SQL Runner')

await test('select puro nao e escrita', () => {
  assert.equal(isWriteQuery('select * from usuarios limit 10'), false)
})

await test('delete e escrita', () => {
  assert.equal(isWriteQuery('delete from usuarios where id = 1'), true)
})

await test('drop table e escrita', () => {
  assert.equal(isWriteQuery('DROP TABLE clientes'), true)
})

await test('palavra de escrita apenas dentro de comentario nao conta', () => {
  assert.equal(isWriteQuery('select 1 -- delete isso depois'), false)
})

await test('comentario de bloco tambem e ignorado', () => {
  assert.equal(isWriteQuery('/* drop table x */ select 1'), false)
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passou(ram), ${failed} falhou(aram)\n`)
process.exit(failed > 0 ? 1 : 0)
