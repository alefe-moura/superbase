import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ClientBody {
  name?: string
  contact?: string | null
  notes?: string | null
  color?: string | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<ClientBody>(request)
  if (!body) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })

  try {
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name.trim()
    if (body.contact !== undefined) patch.contact = body.contact?.trim() || null
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null
    if (body.color !== undefined) patch.color = body.color?.trim() || null

    const { error } = await systemDb().from('clients').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    await audit({ action: 'client.updated', detail: body.name, actor: g.session.email })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao atualizar o cliente.')
  }
}

/**
 * Remove o cliente. Os projetos vinculados não somem, apenas ficam sem cliente
 * (ON DELETE SET NULL no schema).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const db = systemDb()

    const { data: client } = await db
      .from('clients')
      .select('name')
      .eq('id', id)
      .maybeSingle<{ name: string }>()

    if (!client) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 })

    const { error } = await db.from('clients').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await audit({ action: 'client.deleted', detail: client.name, actor: g.session.email })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao remover o cliente.')
  }
}
