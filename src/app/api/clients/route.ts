import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await guard()
  if (!g.ok) return g.response

  try {
    const { data, error } = await systemDb().from('clients').select('*').order('name')
    if (error) throw new Error(error.message)
    return NextResponse.json({ clients: data ?? [] })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar clientes.')
  }
}

interface ClientBody {
  name: string
  contact?: string
  notes?: string
  color?: string
}

export async function POST(request: Request) {
  const g = await guard()
  if (!g.ok) return g.response

  const body = await parseBody<ClientBody>(request)
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'O nome do cliente e obrigatorio.' }, { status: 400 })
  }

  try {
    const { data, error } = await systemDb()
      .from('clients')
      .insert({
        name: body.name.trim(),
        contact: body.contact?.trim() || null,
        notes: body.notes?.trim() || null,
        color: body.color?.trim() || null,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !data) throw new Error(error?.message ?? 'Falha ao criar o cliente.')

    await audit({ action: 'client.created', detail: body.name.trim(), actor: g.session.email })

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return errorResponse(err, 'Falha ao criar o cliente.')
  }
}
