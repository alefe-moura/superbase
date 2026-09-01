import { systemDb } from './db'
import { decryptMaybe } from './crypto'
import type { Account } from './types'

/** Conta com o PAT ja aberto, SO no servidor. */
export interface AccountWithPat {
  account: Account
  pat: string
}

/**
 * Carrega uma conta e abre o PAT dela.
 *
 * Devolve null em vez de lancar quando a conta nao existe, esta desabilitada
 * ou o envelope nao abre com a chave atual do cofre: para quem chama, os tres
 * casos significam a mesma coisa: nao da para falar com a Supabase por esta
 * conta agora.
 */
export async function getAccountPat(accountId: string): Promise<AccountWithPat | null> {
  const { data: account } = await systemDb()
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle<Account>()

  if (!account || account.status === 'disabled') return null

  const pat = decryptMaybe(account.pat_encrypted)
  if (!pat) return null

  return { account, pat }
}
