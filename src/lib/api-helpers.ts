import { NextResponse } from 'next/server'
import { apiSession, type SessionPayload } from './session'
import { systemDbReady } from './db'
import { vaultReady } from './crypto'
import { authReady } from './auth/client'
import { ManagementApiError } from './gateway/management'
import { ProjectApiError } from './gateway/project'

/**
 * Guarda padrão dos route handlers: exige sessão e configuração valida.
 * Retorna a sessão ou uma NextResponse de erro pronta para devolver.
 */
export async function guard(): Promise<
  { ok: true; session: SessionPayload } | { ok: false; response: NextResponse }
> {
  if (!systemDbReady() || !vaultReady() || !authReady()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sistema não configurado. Veja o MANUAL.md.' },
        { status: 503 },
      ),
    }
  }

  const session = await apiSession()
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }),
    }
  }

  return { ok: true, session }
}

/** Traduz erros das camadas de gateway para respostas HTTP coerentes. */
export function errorResponse(err: unknown, fallback = 'Erro inesperado.'): NextResponse {
  if (err instanceof ManagementApiError) {
    const status = err.status === 0 ? 502 : err.status
    return NextResponse.json({ error: err.message }, { status })
  }

  if (err instanceof ProjectApiError) {
    const status = err.status === 0 ? 502 : err.status
    return NextResponse.json({ error: err.message, hint: err.hint }, { status })
  }

  if (err instanceof Error) {
    console.error('[api]', err)
    return NextResponse.json({ error: err.message || fallback }, { status: 500 })
  }

  console.error('[api] erro desconhecido:', err)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function parseBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}
