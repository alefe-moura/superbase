/**
 * Coletor de snapshots: o coracao do modulo de monitoramento.
 *
 * Combina as tres fontes para reproduzir o "Project Overview":
 *   1. health endpoint (Management API)  -> status por serviço
 *   2. métricas Prometheus (service key) -> CPU, RAM, disco
 *   3. SQL (Management API)              -> tamanho do banco, conexões
 *
 * Regra de ouro: falha de um projeto NUNCA derruba a coleta dos outros.
 */

import { systemDb } from '@/lib/db'
import { decryptMaybe } from '@/lib/crypto'
import type { Health, Project, ServiceHealth, Snapshot } from '@/lib/types'
import { getHealth, getProject, runQuery, ManagementApiError } from './management'
import {
  cpuPercentFromDelta,
  cpuPercentFromLoad,
  fetchProjectMetrics,
  type MetricsSummary,
} from './metrics'

export interface CollectResult {
  projectId: string
  projectName: string
  ok: boolean
  error?: string
  health: Health
}

const DB_STATS_SQL = `
  select
    pg_database_size(current_database()) as db_size,
    (select count(*) from pg_stat_activity where datname = current_database()) as active_connections,
    (select setting::int from pg_settings where name = 'max_connections') as max_connections
`

function overallHealth(services: ServiceHealth[], reachable: boolean): Health {
  if (!reachable) return 'down'
  if (!services.length) return 'unknown'

  const healthy = services.filter((s) => s.healthy).length
  if (healthy === services.length) return 'healthy'
  if (healthy === 0) return 'down'
  return 'degraded'
}

/** Um projeto pausado não responde a nada: isso e esperado, não e falha. */
function isPaused(status: string | null | undefined): boolean {
  return Boolean(status && /paus|inactive/i.test(status))
}

/**
 * Última barreira antes de gravar o aviso no snapshot.
 *
 * O tratamento certo acontece em http-error.ts, mas um erro inesperado ainda
 * poderia trazer um bloco enorme. Nada com cara de HTML ou tamanho absurdo
 * entra no banco, ficaria para sempre naquele snapshot.
 */
function sanitizeWarnings(warnings: string[]): string {
  const limpos = warnings.map((w) => {
    const semTags = w.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return semTags.length > 220 ? `${semTags.slice(0, 219)}…` : semTags
  })

  return limpos.join(' | ').slice(0, 900)
}

async function previousSnapshot(projectId: string): Promise<Snapshot | null> {
  const { data } = await systemDb()
    .from('snapshots')
    .select('*')
    .eq('project_id', projectId)
    .order('collected_at', { ascending: false })
    .limit(1)
    .maybeSingle<Snapshot>()

  return data ?? null
}

export async function collectProjectSnapshot(project: Project): Promise<CollectResult> {
  const db = systemDb()
  const serviceKey = decryptMaybe(project.service_key_enc)

  let pat: string | null = null
  if (project.account_id) {
    const { data: account } = await db
      .from('accounts')
      .select('pat_encrypted, status')
      .eq('id', project.account_id)
      .maybeSingle<{ pat_encrypted: string; status: string }>()

    if (account && account.status !== 'disabled') pat = decryptMaybe(account.pat_encrypted)
  }

  const errors: string[] = []
  let services: ServiceHealth[] = []
  let metrics: MetricsSummary = { available: false }
  let dbSize: number | null = null
  let activeConnections: number | null = null
  let maxConnections: number | null = null
  let status = project.status
  let region = project.region
  let pgVersion = project.pg_version
  let reachable = false

  // --- 1. Metadados + saúde (exigem PAT) ---
  if (pat && project.ref) {
    try {
      const meta = await getProject(pat, project.ref)
      status = meta.status ?? status
      region = meta.region ?? region
      pgVersion = meta.database?.version ?? pgVersion
    } catch (err) {
      errors.push(`metadados: ${err instanceof Error ? err.message : 'falha'}`)
    }

    if (!isPaused(status)) {
      try {
        const health = await getHealth(pat, project.ref)
        services = health.map((s) => ({
          name: s.name,
          healthy: s.healthy,
          status: s.status ?? null,
        }))
        reachable = true
      } catch (err) {
        errors.push(`health: ${err instanceof Error ? err.message : 'falha'}`)
      }
    }
  }

  // --- 2. Métricas de recurso (exigem service key) ---
  if (serviceKey && !isPaused(status)) {
    metrics = await fetchProjectMetrics(project.url, serviceKey)
    if (metrics.available) reachable = true
    else if (metrics.error) errors.push(`métricas: ${metrics.error}`)
  }

  // --- 3. Estatisticas do banco via SQL (exigem PAT) ---
  if (pat && project.ref && !isPaused(status)) {
    try {
      const rows = await runQuery<{
        db_size: string | number
        active_connections: string | number
        max_connections: string | number
      }>(pat, project.ref, DB_STATS_SQL, true)

      if (rows[0]) {
        dbSize = Number(rows[0].db_size) || null
        activeConnections = Number(rows[0].active_connections) || null
        maxConnections = Number(rows[0].max_connections) || null
        reachable = true
      }
    } catch (err) {
      // read_only pode não ser aceito em versoes antigas, tenta sem.
      if (err instanceof ManagementApiError && err.status === 400) {
        try {
          const rows = await runQuery<{
            db_size: string | number
            active_connections: string | number
            max_connections: string | number
          }>(pat, project.ref, DB_STATS_SQL, false)

          if (rows[0]) {
            dbSize = Number(rows[0].db_size) || null
            activeConnections = Number(rows[0].active_connections) || null
            maxConnections = Number(rows[0].max_connections) || null
            reachable = true
          }
        } catch (retryErr) {
          errors.push(`sql: ${retryErr instanceof Error ? retryErr.message : 'falha'}`)
        }
      } else {
        errors.push(`sql: ${err instanceof Error ? err.message : 'falha'}`)
      }
    }
  }

  // --- CPU: delta contra o snapshot anterior; senao, aproxima pelo load ---
  const prev = await previousSnapshot(project.id)
  const prevCounters = prev
    ? { cpuTotalSeconds: prev.cpu_total_seconds, cpuIdleSeconds: prev.cpu_idle_seconds }
    : null

  const cpuPct =
    cpuPercentFromDelta(prevCounters, metrics) ??
    cpuPercentFromLoad(metrics.load1, metrics.cpuCount) ??
    null

  const paused = isPaused(status)
  const health: Health = paused ? 'unknown' : overallHealth(services, reachable)
  const ok = paused || reachable

  await db.from('snapshots').insert({
    project_id: project.id,
    ok,
    error: errors.length ? sanitizeWarnings(errors) : null,
    health_json: services.length ? services : null,
    overall_health: health,
    cpu_pct: cpuPct,
    ram_pct: metrics.ramPct ?? null,
    ram_total_bytes: metrics.ramTotalBytes ?? null,
    ram_used_bytes: metrics.ramUsedBytes ?? null,
    disk_pct: metrics.diskPct ?? null,
    disk_total_bytes: metrics.diskTotalBytes ?? null,
    disk_used_bytes: metrics.diskUsedBytes ?? null,
    load1: metrics.load1 ?? null,
    db_size_bytes: dbSize,
    active_connections: activeConnections,
    max_connections: maxConnections,
    cpu_total_seconds: metrics.cpuTotalSeconds ?? null,
    cpu_idle_seconds: metrics.cpuIdleSeconds ?? null,
  })

  // Mantem os metadados do projeto em dia sem exigir ressincronização manual.
  if (status !== project.status || region !== project.region || pgVersion !== project.pg_version) {
    await db
      .from('projects')
      .update({ status, region, pg_version: pgVersion })
      .eq('id', project.id)
  }

  return {
    projectId: project.id,
    projectName: project.name,
    ok,
    error: errors.length ? errors.join(' | ') : undefined,
    health,
  }
}

/** Coleta todos os projetos ativos, isolando falhas individuais. */
export async function collectAll(): Promise<CollectResult[]> {
  const { data: projects } = await systemDb()
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .returns<Project[]>()

  if (!projects?.length) return []

  const settled = await Promise.allSettled(projects.map((p) => collectProjectSnapshot(p)))

  return settled.map((result, i) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          projectId: projects[i].id,
          projectName: projects[i].name,
          ok: false,
          error: result.reason instanceof Error ? result.reason.message : 'falha desconhecida',
          health: 'unknown' as Health,
        },
  )
}
