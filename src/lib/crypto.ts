import crypto from 'node:crypto'

/**
 * Cofre de credenciais.
 *
 * Decisao de arquitetura (ver README > Seguranca):
 * a chave mestra de criptografia vive na env `APP_ENCRYPTION_KEY` (32 bytes,
 * base64), NAO e derivada da senha de login. Motivo: a Vercel e serverless e
 * stateless, derivar a chave da senha exigiria manter o material de chave no
 * cookie de sessão a cada requisição, ampliando a superficie de exposicao.
 *
 * Consequencia pratica: um dump do banco do sistema, sozinho, e inutil, os
 * segredos so abrem com a env, que fica apenas no painel da Vercel.
 */

const ENVELOPE_VERSION = 'v1'
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

let cachedKey: Buffer | null = null

function masterKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'APP_ENCRYPTION_KEY não configurada. Gere uma com `npm run genkey` e coloque no .env.local (ou nas env vars da Vercel).',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY inválida: esperado 32 bytes em base64, recebido ${key.length}. Gere uma nova com \`npm run genkey\`.`,
    )
  }

  cachedKey = key
  return key
}

/** Confere se o cofre esta configurado, sem lancar excecao. */
export function vaultReady(): boolean {
  try {
    masterKey()
    return true
  } catch {
    return false
  }
}

/**
 * Criptografa um segredo. Formato do envelope:
 *   v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.')
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Envelope de criptografia inválido ou de versão desconhecida.')
  }

  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const ct = Buffer.from(parts[3], 'base64url')

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Envelope de criptografia corrompido.')
  }

  const decipher = crypto.createDecipheriv(ALGO, masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Versoes tolerantes: retornam null em vez de lancar. */
export function encryptMaybe(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null
  return encryptSecret(plaintext)
}

export function decryptMaybe(envelope: string | null | undefined): string | null {
  if (!envelope) return null
  try {
    return decryptSecret(envelope)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

/** Mostra so o fim do segredo: "sk_live_...a91f" */
export function maskSecret(secret: string | null | undefined, visible = 4): string {
  if (!secret) return '·'
  if (secret.length <= visible) return '•'.repeat(8)
  return '•'.repeat(12) + secret.slice(-visible)
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
