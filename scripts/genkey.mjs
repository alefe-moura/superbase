#!/usr/bin/env node
/**
 * Gera os segredos do sistema.
 *   npm run genkey
 */
import crypto from 'node:crypto'

const encryptionKey = crypto.randomBytes(32).toString('base64')
const cronSecret = crypto.randomBytes(24).toString('base64url')

console.log(`
Cole estas linhas no seu .env.local (e depois nas env vars da Vercel):

APP_ENCRYPTION_KEY=${encryptionKey}
CRON_SECRET=${cronSecret}

ATENCAO: guarde a APP_ENCRYPTION_KEY em local seguro.
Perde-la significa perder o acesso a TODAS as credenciais salvas no cofre:
nao existe recuperacao, por design.

A senha de login NAO fica aqui: ela e gerenciada pelo Supabase Auth do
projeto do sistema (Authentication > Users no painel).
`)
