import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard } from '@/lib/api-helpers'
import { collectProjectSnapshot } from '@/lib/gateway/collector'
import type { Project, Snapshot } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Histórico de snapshots para os graficos (24h ou 7d). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const range = new URL(request.url).searchParams.get('range') ?? '24h'
  const hours = range === '7d' ? 168 : 24
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()

  try {
    const { data } = await systemDb()
      .from('snapshots')
      .select(
        'collected_at, cpu_pct, ram_pct, disk_pct, db_size_bytes, active_connections, overall_health, ok',
      )
      .eq('project_id', id)
      .gte('collected_at', since)
      .order('collected_at', { ascending: true })
      .returns<Partial<Snapshot>[]>()

    return NextResponse.json({ snapshots: data ?? [] })
  } catch (err) {
    return errorResponse(err, 'Falha ao carregar o histórico.')
  }
}

/** "Atualizar agora", coleta sob demanda de um projeto. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const { data: project } = await systemDb()
      .from('projects')
      .select('*')
      .eq('id', id)
      .is('archived_at', null)
      .maybeSingle<Project>()

    if (!project) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

    const result = await collectProjectSnapshot(project)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err, 'Falha ao coletar o snapshot.')
  }
}
