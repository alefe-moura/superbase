import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente do BANCO DO SISTEMA (o projeto Supabase dedicado ao SuperBase Manager).
 * Usa a service_role key e so pode ser importado em código de servidor.
 */

let cached: SupabaseClient | null = null

export function systemDb(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SYSTEM_SUPABASE_URL
  const key = process.env.SYSTEM_SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error(
      'Banco do sistema não configurado. Defina SYSTEM_SUPABASE_URL e SYSTEM_SUPABASE_SERVICE_KEY (veja MANUAL.md).',
    )
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'superbase-manager' } },
  })

  return cached
}

export function systemDbReady(): boolean {
  return Boolean(process.env.SYSTEM_SUPABASE_URL && process.env.SYSTEM_SUPABASE_SERVICE_KEY)
}
