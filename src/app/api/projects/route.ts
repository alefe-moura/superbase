import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { encryptMaybe, encryptSecret } from '@/lib/crypto'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { normalizeProjectUrl, refFromUrl } from '@/lib/projects'
import { testConnection } from '@/lib/gateway/project'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CreateProjectBody {
  name: string
  url: string
  service_key: string
  anon_key?: string
  publishable_key?: string
  db_url?: string
  account_email?: string
  client_id?: string | null
  notes?: string
  /** Pula o teste de credenciais (não recomendado). */
  skipValidation?: boolean
}

/**
 * Conecta um projeto avulso (sem PAT), so com URL + chaves.
 * Valida as credenciais de verdade antes de gravar.
 */
export async function POST(request: Request) {
  const g = await guard()
  if (!g.ok) return g.response

  const body = await parseBody<CreateProjectBody>(request)
  if (!body?.name?.trim() || !body.url?.trim() || !body.service_key?.trim()) {
    return NextResponse.json(
      { error: 'Nome, URL e service_role key são obrigatorios.' },
      { status: 400 },
    )
  }

  const url = normalizeProjectUrl(body.url)
  const serviceKey = body.service_key.trim()

  try {
    // Validação ativa: so salva se as credenciais realmente funcionarem.
    if (!body.skipValidation) {
      const test = await testConnection(url, serviceKey)
      if (!test.ok) {
        return NextResponse.json(
          { error: `Credenciais recusadas pelo projeto: ${test.error}` },
          { status: 422 },
        )
      }
    }

    const db = systemDb()
    const ref = refFromUrl(url)

    if (ref) {
      const { data: duplicate } = await db
        .from('projects')
        .select('id, name')
        .eq('ref', ref)
        .is('archived_at', null)
        .maybeSingle<{ id: string; name: string }>()

      if (duplicate) {
        return NextResponse.json(
          { error: `Este projeto ja esta conectado como "${duplicate.name}".` },
          { status: 409 },
        )
      }
    }

    const { data: created, error } = await db
      .from('projects')
      .insert({
        name: body.name.trim(),
        url,
        ref,
        account_email: body.account_email?.trim().toLowerCase() || null,
        client_id: body.client_id || null,
        service_key_enc: encryptSecret(serviceKey),
        anon_key_enc: encryptMaybe(body.anon_key?.trim()),
        publishable_key_enc: encryptMaybe(body.publishable_key?.trim()),
        db_url_enc: encryptMaybe(body.db_url?.trim()),
        notes: body.notes?.trim() || null,
        source: 'manual',
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !created) throw new Error(error?.message ?? 'Falha ao salvar o projeto.')

    await audit({
      action: 'project.created',
      projectId: created.id,
      detail: `${body.name.trim()} (manual)`,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true, id: created.id })
  } catch (err) {
    return errorResponse(err, 'Falha ao conectar o projeto.')
  }
}
