import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { encryptMaybe } from '@/lib/crypto'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { normalizeProjectUrl } from '@/lib/projects'
import { testConnection } from '@/lib/gateway/project'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface UpdateBody {
  name?: string
  url?: string
  account_email?: string | null
  client_id?: string | null
  notes?: string | null
  service_key?: string
  anon_key?: string
  publishable_key?: string
  db_url?: string
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<UpdateBody>(request)
  if (!body) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })

  try {
    const db = systemDb()
    const patch: Record<string, unknown> = {}

    if (body.name !== undefined) patch.name = body.name.trim()
    if (body.account_email !== undefined) {
      patch.account_email = body.account_email?.trim().toLowerCase() || null
    }
    if (body.client_id !== undefined) patch.client_id = body.client_id || null
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null
    if (body.url !== undefined) patch.url = normalizeProjectUrl(body.url)

    // Rotacao de credenciais: valida a nova chave antes de substituir.
    if (body.service_key?.trim()) {
      const url = (patch.url as string) ?? (await currentUrl(id))
      if (url) {
        const test = await testConnection(url, body.service_key.trim())
        if (!test.ok) {
          return NextResponse.json(
            { error: `Nova service_role key recusada: ${test.error}` },
            { status: 422 },
          )
        }
      }
      patch.service_key_enc = encryptMaybe(body.service_key.trim())
    }

    if (body.anon_key?.trim()) patch.anon_key_enc = encryptMaybe(body.anon_key.trim())
    if (body.publishable_key?.trim()) {
      patch.publishable_key_enc = encryptMaybe(body.publishable_key.trim())
    }
    if (body.db_url?.trim()) patch.db_url_enc = encryptMaybe(body.db_url.trim())

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 })
    }

    const { error } = await db.from('projects').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    await audit({
      action: 'project.updated',
      projectId: id,
      detail: Object.keys(patch)
        .map((k) => k.replace('_enc', ''))
        .join(', '),
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao atualizar o projeto.')
  }
}

async function currentUrl(id: string): Promise<string | null> {
  const { data } = await systemDb()
    .from('projects')
    .select('url')
    .eq('id', id)
    .maybeSingle<{ url: string }>()
  return data?.url ?? null
}

/** Arquiva (soft delete), nunca apaga de verdade. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const db = systemDb()

    const { data: project } = await db
      .from('projects')
      .select('name')
      .eq('id', id)
      .maybeSingle<{ name: string }>()

    if (!project) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

    const { error } = await db
      .from('projects')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw new Error(error.message)

    await audit({
      action: 'project.archived',
      projectId: id,
      detail: project.name,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao arquivar o projeto.')
  }
}
