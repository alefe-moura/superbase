import { NextResponse } from 'next/server'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import { deleteRow, insertRow, listRows, updateRow } from '@/lib/gateway/project'
import { truncate } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function credentials(id: string) {
  const creds = await getProjectCredentials(id)
  if (!creds) return { error: NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 }) }
  if (!creds.serviceKey) {
    return {
      error: NextResponse.json(
        { error: 'Este projeto não tem service_role key salva.' },
        { status: 422 },
      ),
    }
  }
  return { creds }
}

/** Lista linhas com paginação, ordenação e filtros. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const url = new URL(request.url)
  const table = url.searchParams.get('table')

  if (!table) return NextResponse.json({ error: 'Informe a tabela.' }, { status: 400 })

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const { rows, total } = await listRows(creds.project.url, creds.serviceKey!, table, {
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
      orderBy: url.searchParams.get('orderBy') || undefined,
      ascending: url.searchParams.get('ascending') !== 'false',
      filters: url.searchParams.getAll('filter'),
    })

    return NextResponse.json({ rows, total })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar as linhas.')
  }
}

/** Insere uma linha. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ table: string; values: Record<string, unknown> }>(request)

  if (!body?.table || !body.values) {
    return NextResponse.json({ error: 'Informe a tabela e os valores.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const row = await insertRow(creds.project.url, creds.serviceKey!, body.table, body.values)

    await audit({
      action: 'data.row_inserted',
      projectId: id,
      detail: `${creds.project.name} · ${body.table}`,
      actor: g.session.email,
      meta: { table: body.table, values: body.values },
    })

    return NextResponse.json({ ok: true, row })
  } catch (err) {
    return errorResponse(err, 'Falha ao inserir a linha.')
  }
}

/** Atualiza uma linha identificada pela chave primaria. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{
    table: string
    pk: Record<string, unknown>
    values: Record<string, unknown>
  }>(request)

  if (!body?.table || !body.pk || !body.values) {
    return NextResponse.json({ error: 'Informe tabela, chave primaria e valores.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const row = await updateRow(
      creds.project.url,
      creds.serviceKey!,
      body.table,
      body.pk,
      body.values,
    )

    await audit({
      action: 'data.row_updated',
      projectId: id,
      detail: `${creds.project.name} · ${body.table} · ${truncate(JSON.stringify(body.pk), 60)}`,
      actor: g.session.email,
      meta: { table: body.table, pk: body.pk, values: body.values },
    })

    return NextResponse.json({ ok: true, row })
  } catch (err) {
    return errorResponse(err, 'Falha ao atualizar a linha.')
  }
}

/** Exclui uma linha identificada pela chave primaria. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ table: string; pk: Record<string, unknown> }>(request)

  if (!body?.table || !body.pk) {
    return NextResponse.json({ error: 'Informe a tabela e a chave primaria.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    await deleteRow(creds.project.url, creds.serviceKey!, body.table, body.pk)

    await audit({
      action: 'data.row_deleted',
      projectId: id,
      detail: `${creds.project.name} · ${body.table} · ${truncate(JSON.stringify(body.pk), 60)}`,
      actor: g.session.email,
      meta: { table: body.table, pk: body.pk },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao excluir a linha.')
  }
}
