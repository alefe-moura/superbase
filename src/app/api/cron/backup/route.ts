import { NextResponse } from 'next/server'
import { systemDb, systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { autorizarCron } from '@/lib/cron-auth'
import { runBackup } from '@/lib/gateway/backup'
import type { Project } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Backup diário de todos os projetos.
 *
 * Duas proteções contra o limite de tempo da função:
 *
 * 1. Ordena pelos projetos com o backup MAIS ANTIGO primeiro. Se o tempo
 *    acabar antes de terminar, os que ficaram de fora são os primeiros da
 *    próxima execução, ninguém fica sem backup indefinidamente.
 *
 * 2. Para antes do teto, em vez de ser morto no meio de um upload.
 */

const TIME_BUDGET_MS = 240_000

export async function GET() {
  return run()
}

export async function POST() {
  return run()
}

async function run() {
  const recusa = await autorizarCron()
  if (recusa) return recusa

  if (!systemDbReady() || !vaultReady()) {
    return NextResponse.json({ error: 'Sistema não configurado.' }, { status: 503 })
  }

  const db = systemDb()
  const startedAt = Date.now()

  try {
    const { data: projects } = await db
      .from('projects')
      .select('*')
      .is('archived_at', null)
      .not('account_id', 'is', null)
      .returns<Project[]>()

    if (!projects?.length) {
      return NextResponse.json({ ok: true, message: 'Nenhum projeto com token de conta.' })
    }

    // Quem está há mais tempo sem backup entra na frente.
    const { data: lastRuns } = await db
      .from('backups')
      .select('project_id, started_at')
      .eq('status', 'ok')
      .order('started_at', { ascending: false })

    const lastByProject = new Map<string, string>()
    for (const row of lastRuns ?? []) {
      if (!lastByProject.has(row.project_id)) lastByProject.set(row.project_id, row.started_at)
    }

    const queue = [...projects].sort((a, b) => {
      const ta = lastByProject.get(a.id) ?? ''
      const tb = lastByProject.get(b.id) ?? ''
      return ta.localeCompare(tb)
    })

    const done: Array<{ project: string; ok: boolean; sizeKb?: number; error?: string }> = []
    const skipped: string[] = []

    for (const project of queue) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        skipped.push(project.name)
        continue
      }

      const result = await runBackup(project, 'cron')
      done.push({
        project: project.name,
        ok: result.ok,
        sizeKb: result.sizeBytes ? Math.round(result.sizeBytes / 1024) : undefined,
        error: result.error,
      })
    }

    // Retenção POR DATA: mantém os últimos N dias, independente de quantos
    // backups existam. Contar arquivos era enganoso, clicar em "fazer agora"
    // várias vezes num dia consumia dias do histórico.
    //
    // Apaga do Storage antes de tirar o registro; ao contrário, o arquivo
    // ficaria órfão ocupando espaço para sempre.
    let pruned = 0
    try {
      const days = Number(process.env.BACKUP_RETENTION_DAYS) || 30
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString()

      const { data: stale } = await db
        .from('backups')
        .select('id, project_id, storage_path, started_at')
        .eq('status', 'ok')
        .lt('started_at', cutoff)
        .order('started_at', { ascending: false })

      // Rede de segurança: nunca deixa um projeto sem nenhum backup, mesmo
      // que ele passe mais de 30 dias sem rodar.
      const { data: newest } = await db
        .from('backups')
        .select('id, project_id, started_at')
        .eq('status', 'ok')
        .order('started_at', { ascending: false })

      const keepAlive = new Set<string>()
      for (const row of newest ?? []) {
        if (!keepAlive.has(row.project_id)) keepAlive.add(row.id)
      }

      const toRemove: Array<{ id: string; path: string }> = []
      for (const row of stale ?? []) {
        if (keepAlive.has(row.id)) continue
        toRemove.push({ id: row.id, path: row.storage_path })
      }

      if (toRemove.length) {
        await db.storage.from('backups').remove(toRemove.map((r) => r.path))
        await db
          .from('backups')
          .delete()
          .in('id', toRemove.map((r) => r.id))
        pruned = toRemove.length
      }

      // Registros de execuções que falharam também não precisam durar para sempre.
      await db
        .from('backups')
        .delete()
        .eq('status', 'error')
        .lt('started_at', new Date(Date.now() - 30 * 86400_000).toISOString())
    } catch (err) {
      console.error('[cron/backup] falha na retenção:', err)
    }

    const failed = done.filter((d) => !d.ok)

    return NextResponse.json({
      ok: true,
      backed_up: done.filter((d) => d.ok).length,
      failed: failed.length,
      skipped,
      pruned,
      durationMs: Date.now() - startedAt,
      results: done,
    })
  } catch (err) {
    console.error('[cron/backup] falha geral:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha no backup.' },
      { status: 500 },
    )
  }
}
