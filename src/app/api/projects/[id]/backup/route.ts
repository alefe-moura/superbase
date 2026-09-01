import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { runBackup } from '@/lib/gateway/backup'
import type { Project } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Histórico de backups do projeto. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const { data, error } = await systemDb()
      .from('backups')
      .select('*')
      .eq('project_id', id)
      .order('started_at', { ascending: false })
      .limit(60)

    if (error) throw new Error(error.message)

    return NextResponse.json({ backups: data ?? [] })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar os backups.')
  }
}

/** Executa um backup agora. */
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

    const result = await runBackup(project, 'manual')

    await audit({
      action: result.ok ? 'backup.created' : 'backup.failed',
      projectId: id,
      detail: result.ok
        ? `${project.name} · ${result.counts?.tables} tabelas, ${result.counts?.rows} linhas, ${((result.sizeBytes ?? 0) / 1024).toFixed(0)} KB`
        : `${project.name} · ${result.error}`,
      actor: g.session.email,
      meta: result.counts as unknown as Record<string, unknown>,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err, 'Falha ao gerar o backup.')
  }
}

/** Gera link temporário de download, ou exclui um backup. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ backupId: string }>(request)

  if (!body?.backupId) {
    return NextResponse.json({ error: 'Informe o backup.' }, { status: 400 })
  }

  try {
    const db = systemDb()

    const { data: backup } = await db
      .from('backups')
      .select('storage_path, project_id')
      .eq('id', body.backupId)
      .maybeSingle<{ storage_path: string; project_id: string }>()

    if (!backup || backup.project_id !== id) {
      return NextResponse.json({ error: 'Backup não encontrado.' }, { status: 404 })
    }

    // 5 minutos é tempo de sobra para baixar e curto o bastante para o link
    // não virar uma porta aberta se vazar.
    const { data, error } = await db.storage
      .from('backups')
      .createSignedUrl(backup.storage_path, 300, { download: true })

    if (error || !data) {
      return NextResponse.json(
        { error: `Falha ao gerar o link: ${error?.message ?? 'desconhecida'}` },
        { status: 500 },
      )
    }

    await audit({
      action: 'backup.downloaded',
      projectId: id,
      detail: backup.storage_path,
      actor: g.session.email,
    })

    return NextResponse.json({ url: data.signedUrl })
  } catch (err) {
    return errorResponse(err, 'Falha ao gerar o link de download.')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ backupId: string }>(request)

  if (!body?.backupId) {
    return NextResponse.json({ error: 'Informe o backup.' }, { status: 400 })
  }

  try {
    const db = systemDb()

    const { data: backup } = await db
      .from('backups')
      .select('storage_path, project_id')
      .eq('id', body.backupId)
      .maybeSingle<{ storage_path: string; project_id: string }>()

    if (!backup || backup.project_id !== id) {
      return NextResponse.json({ error: 'Backup não encontrado.' }, { status: 404 })
    }

    // Arquivo primeiro; se falhar, o registro fica e dá para tentar de novo.
    await db.storage.from('backups').remove([backup.storage_path])
    await db.from('backups').delete().eq('id', body.backupId)

    await audit({
      action: 'backup.deleted',
      projectId: id,
      detail: backup.storage_path,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao excluir o backup.')
  }
}
