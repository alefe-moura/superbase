import { NextResponse } from 'next/server'
import { errorResponse, guard } from '@/lib/api-helpers'
import { getAccountPat } from '@/lib/accounts'
import { listOrganizations } from '@/lib/gateway/management'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Organizacoes da conta, lidas ao vivo. Nao guardamos no banco de proposito:
 * organizacao muda de plano e de nome fora daqui, e a lista so serve no
 * momento de criar um projeto, dado fresco vale mais que dado sincronizado.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const found = await getAccountPat(id)
    if (!found) {
      return NextResponse.json(
        { error: 'Conta não encontrada ou sem token utilizável.' },
        { status: 404 },
      )
    }

    const organizations = await listOrganizations(found.pat)

    return NextResponse.json({
      organizations: organizations.map((o) => ({ slug: o.slug, name: o.name })),
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar as organizações da conta.')
  }
}
