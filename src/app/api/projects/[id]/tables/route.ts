import { NextResponse } from 'next/server'
import { errorResponse, guard } from '@/lib/api-helpers'
import { getProjectCredentials } from '@/lib/projects'
import { listTables } from '@/lib/gateway/project'
import { getCachedSchema, invalidateSchema, setCachedSchema } from '@/lib/gateway/schema-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Lista tabelas e colunas a partir do spec OpenAPI do PostgREST.
 *
 * Serve do cache quando possível: a primeira chamada a cada projeto paga
 * conexão fria (400ms a 1,9s medidos), e o schema muda raramente.
 * `?refresh=1` força ir buscar de novo.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const force = new URL(request.url).searchParams.get('refresh') === '1'

  try {
    if (force) invalidateSchema(id)

    const cached = force ? null : getCachedSchema(id)
    if (cached) {
      return NextResponse.json({ tables: cached, cached: true })
    }

    const creds = await getProjectCredentials(id)
    if (!creds) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

    if (!creds.serviceKey) {
      return NextResponse.json(
        { error: 'Este projeto não tem service_role key salva. Adicione-a nas configurações.' },
        { status: 422 },
      )
    }

    const tables = await listTables(creds.project.url, creds.serviceKey)
    setCachedSchema(id, tables)

    return NextResponse.json({ tables, cached: false })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar as tabelas.')
  }
}
