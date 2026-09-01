/**
 * Métricas por projeto, endpoint Prometheus privilegiado da Supabase.
 *
 *   GET https://<ref>.supabase.co/customer/v1/privileged/metrics
 *   Basic auth: usuário "service_role", senha = service_role key
 *
 * E daqui que saem CPU, RAM e disco do "Project Overview".
 * Nem todo plano expoe este endpoint; quando falta, o coletor cai no fallback
 * (health + SQL), que ainda cobre saúde, status e tamanho do banco.
 */

export interface ParsedMetric {
  name: string
  labels: Record<string, string>
  value: number
}

export interface MetricsSummary {
  available: boolean
  error?: string

  ramTotalBytes?: number
  ramUsedBytes?: number
  ramPct?: number

  diskTotalBytes?: number
  diskUsedBytes?: number
  diskPct?: number

  load1?: number
  cpuCount?: number

  /** Contadores cumulativos: o % de CPU sai do delta entre dois snapshots. */
  cpuTotalSeconds?: number
  cpuIdleSeconds?: number
}

const LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+0-9.eEnaN]+)$/

export function parsePrometheus(text: string): ParsedMetric[] {
  const out: ParsedMetric[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const m = LINE_RE.exec(line)
    if (!m) continue

    const value = Number(m[4])
    if (!Number.isFinite(value)) continue

    const labels: Record<string, string> = {}
    if (m[3]) {
      for (const pair of m[3].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
        const eq = pair.indexOf('=')
        if (eq === -1) continue
        labels[pair.slice(0, eq).trim()] = pair
          .slice(eq + 1)
          .trim()
          .replace(/^"|"$/g, '')
      }
    }

    out.push({ name: m[1], labels, value })
  }

  return out
}

function sumBy(metrics: ParsedMetric[], name: string): number | undefined {
  const found = metrics.filter((m) => m.name === name)
  if (!found.length) return undefined
  return found.reduce((acc, m) => acc + m.value, 0)
}

function firstValue(metrics: ParsedMetric[], name: string): number | undefined {
  return metrics.find((m) => m.name === name)?.value
}

/**
 * Escolhe o filesystem de dados. Supabase monta o volume do Postgres em
 * /data (ou similar); descartamos pseudo-filesystems e, na dúvida, ficamos
 * com o maior volume real.
 */
function pickDataFilesystem(metrics: ParsedMetric[]): { total: number; avail: number } | undefined {
  const IGNORED_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'ramfs', 'iso9660'])

  const sizes = metrics.filter(
    (m) =>
      m.name === 'node_filesystem_size_bytes' &&
      !IGNORED_FS.has(m.labels.fstype ?? '') &&
      m.value > 0,
  )
  if (!sizes.length) return undefined

  const availFor = (mountpoint: string, device: string) =>
    metrics.find(
      (m) =>
        m.name === 'node_filesystem_avail_bytes' &&
        m.labels.mountpoint === mountpoint &&
        (!device || m.labels.device === device),
    )?.value

  const preferred =
    sizes.find((m) => /data|pgdata|postgres/i.test(m.labels.mountpoint ?? '')) ??
    sizes.reduce((biggest, m) => (m.value > biggest.value ? m : biggest), sizes[0])

  const avail = availFor(preferred.labels.mountpoint ?? '', preferred.labels.device ?? '')
  if (avail === undefined) return undefined

  return { total: preferred.value, avail }
}

export function summarizeMetrics(metrics: ParsedMetric[]): MetricsSummary {
  const summary: MetricsSummary = { available: true }

  // --- Memória ---
  const memTotal = firstValue(metrics, 'node_memory_MemTotal_bytes')
  const memAvailable =
    firstValue(metrics, 'node_memory_MemAvailable_bytes') ??
    firstValue(metrics, 'node_memory_MemFree_bytes')

  if (memTotal && memAvailable !== undefined && memTotal > 0) {
    summary.ramTotalBytes = memTotal
    summary.ramUsedBytes = memTotal - memAvailable
    summary.ramPct = ((memTotal - memAvailable) / memTotal) * 100
  }

  // --- Disco ---
  const fs = pickDataFilesystem(metrics)
  if (fs && fs.total > 0) {
    summary.diskTotalBytes = fs.total
    summary.diskUsedBytes = fs.total - fs.avail
    summary.diskPct = ((fs.total - fs.avail) / fs.total) * 100
  }

  // --- CPU ---
  const cpuTotal = sumBy(metrics, 'node_cpu_seconds_total')
  if (cpuTotal !== undefined) {
    summary.cpuTotalSeconds = cpuTotal
    summary.cpuIdleSeconds = metrics
      .filter((m) => m.name === 'node_cpu_seconds_total' && m.labels.mode === 'idle')
      .reduce((acc, m) => acc + m.value, 0)

    const cpus = new Set(
      metrics.filter((m) => m.name === 'node_cpu_seconds_total').map((m) => m.labels.cpu),
    )
    summary.cpuCount = cpus.size || undefined
  }

  summary.load1 = firstValue(metrics, 'node_load1')

  return summary
}

/**
 * % de CPU entre dois snapshots: 100 - (delta ocioso / delta total).
 * Precisa de dois pontos porque os contadores são cumulativos.
 */
export function cpuPercentFromDelta(
  prev: { cpuTotalSeconds: number | null; cpuIdleSeconds: number | null } | null | undefined,
  curr: { cpuTotalSeconds?: number; cpuIdleSeconds?: number },
): number | undefined {
  if (!prev?.cpuTotalSeconds || !prev.cpuIdleSeconds) return undefined
  if (curr.cpuTotalSeconds === undefined || curr.cpuIdleSeconds === undefined) return undefined

  const totalDelta = curr.cpuTotalSeconds - prev.cpuTotalSeconds
  const idleDelta = curr.cpuIdleSeconds - prev.cpuIdleSeconds

  // Contador reiniciou (restart do projeto) ou intervalo nulo.
  if (totalDelta <= 0 || idleDelta < 0) return undefined

  const pct = 100 - (idleDelta / totalDelta) * 100
  return Math.max(0, Math.min(100, pct))
}

/** Aproximacao de CPU a partir do load average, quando não ha snapshot anterior. */
export function cpuPercentFromLoad(load1?: number, cpuCount?: number): number | undefined {
  if (load1 === undefined || !cpuCount) return undefined
  return Math.max(0, Math.min(100, (load1 / cpuCount) * 100))
}

export async function fetchProjectMetrics(
  projectUrl: string,
  serviceKey: string,
  timeoutMs = 20000,
): Promise<MetricsSummary> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const base = projectUrl.replace(/\/+$/, '')
    const auth = Buffer.from(`service_role:${serviceKey}`).toString('base64')

    const res = await fetch(`${base}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!res.ok) {
      return {
        available: false,
        error:
          res.status === 401 || res.status === 403
            ? 'Endpoint de métricas negou a service_role key.'
            : res.status === 404
              ? 'Endpoint de métricas indisponível neste projeto/plano.'
              : `Métricas retornaram ${res.status}.`,
      }
    }

    return summarizeMetrics(parsePrometheus(await res.text()))
  } catch (err) {
    return {
      available: false,
      error:
        err instanceof Error && err.name === 'AbortError'
          ? 'Tempo esgotado ao buscar métricas.'
          : err instanceof Error
            ? err.message
            : 'Falha ao buscar métricas.',
    }
  } finally {
    clearTimeout(timer)
  }
}
