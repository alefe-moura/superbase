import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import type { Account } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Remove a conta. Os projetos importados por ela NAO são apagados:
 * eles perdem o vinculo (e o PAT), mas continuam operando pela service key.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const db = systemDb()

    const { data: account } = await db
      .from('accounts')
      .select('login_email')
      .eq('id', id)
      .maybeSingle<Pick<Account, 'login_email'>>()

    if (!account) {
      return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
    }

    // O ON DELETE SET NULL do schema cuida do desvinculo dos projetos.
    const { error } = await db.from('accounts').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await audit({
      action: 'account.deleted',
      detail: account.login_email,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao remover a conta.')
  }
}
