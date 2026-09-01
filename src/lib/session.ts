import { redirect } from 'next/navigation'
import { authClient, authReady } from './auth/client'

/**
 * Sessão do app, delegada ao Supabase Auth do projeto do sistema.
 *
 * Por que não um login próprio: rate limit contra forca bruta precisa ser
 * centralizado (na Vercel, um contador em memória nasce zerado a cada
 * instancia serverless), e MFA/reset de senha exigem fluxos completos.
 * O GoTrue ja resolve os tres.
 *
 * A API deste modulo e a mesma de antes: o resto do app não muda.
 */

export interface SessionPayload {
  uid: string
  email: string
}

/**
 * Allowlist: mesmo que alguem consiga criar uma conta no projeto do sistema,
 * so os e-mails listados entram. Segunda tranca, além de desabilitar o
 * cadastro público no painel do Supabase.
 */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false

  const allowed = allowedEmails()
  // Sem allowlist configurada, não liberamos ninguem: falha fechada.
  if (!allowed.length) return false

  return allowed.includes(email.trim().toLowerCase())
}

/** Retorna a sessão atual ou null. Não redireciona. */
export async function getSession(): Promise<SessionPayload | null> {
  if (!authReady()) return null

  try {
    const supabase = await authClient()
    // getUser() valida o token no servidor do Supabase, não confia no cookie.
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user?.email) return null
    if (!isAllowed(user.email)) return null

    return { uid: user.id, email: user.email }
  } catch {
    return null
  }
}

/** Para paginas de servidor: exige sessão, senao manda pro login. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}

/** Para route handlers: retorna null se não autenticado (o handler decide o 401). */
export async function apiSession(): Promise<SessionPayload | null> {
  return getSession()
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await authClient()
    await supabase.auth.signOut()
  } catch {
    // Sessão ja inválida: nada a fazer.
  }
}
