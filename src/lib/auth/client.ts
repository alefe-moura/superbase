import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * O @supabase/ssr escreve o cookie de sessão SEM httpOnly, porque assume que
 * um cliente no navegador vai precisar ler o token. Aqui isso nunca acontece:
 * o login passa pela nossa route handler e so o servidor toca na sessão.
 *
 * Forcamos httpOnly para que um script injetado na pagina não consiga roubar
 * a sessão.
 */
export function hardenedCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: options.sameSite ?? 'lax',
    path: options.path ?? '/',
  }
}

/**
 * Cliente de AUTENTICACAO, usa a anon key do projeto do sistema e guarda a
 * sessão em cookies httpOnly gerenciados pelo @supabase/ssr.
 *
 * Não confundir com `systemDb()` (src/lib/db.ts), que usa a service_role key
 * para ler e escrever os dados do app. Aqui e so login/logout/quem-sou-eu.
 */
export async function authClient() {
  const url = process.env.SYSTEM_SUPABASE_URL
  const anonKey = process.env.SYSTEM_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Auth não configurado. Defina SYSTEM_SUPABASE_URL e SYSTEM_SUPABASE_ANON_KEY (veja MANUAL.md).',
    )
  }

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, hardenedCookieOptions(options))
          }
        } catch {
          // Server Components não podem escrever cookies; o middleware cuida
          // da renovacao da sessão. Ignorar aqui e o comportamento esperado.
        }
      },
    },
  })
}

export function authReady(): boolean {
  return Boolean(process.env.SYSTEM_SUPABASE_URL && process.env.SYSTEM_SUPABASE_ANON_KEY)
}
