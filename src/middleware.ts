import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { hardenedCookieOptions } from '@/lib/auth/client'

/**
 * Mantem a sessão do Supabase Auth renovada.
 *
 * Server Components não conseguem escrever cookies, entao o refresh do token
 * precisa acontecer aqui, senao a sessão "morre" ao expirar o access token,
 * mesmo com refresh token valido.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.SYSTEM_SUPABASE_URL
  const anonKey = process.env.SYSTEM_SUPABASE_ANON_KEY

  // Sem configuração, as proprias paginas mostram o aviso de setup.
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, hardenedCookieOptions(options))
        }
      },
    },
  })

  // Dispara o refresh quando necessário.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto assets estaticos e o endpoint do cron
     * (que autentica por CRON_SECRET, não por sessão).
     */
    '/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
