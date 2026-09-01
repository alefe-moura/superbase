export type Health = 'healthy' | 'degraded' | 'down' | 'unknown'

export interface Client {
  id: string
  name: string
  contact: string | null
  notes: string | null
  color: string | null
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  login_email: string
  alias: string | null
  pat_encrypted: string
  status: 'active' | 'invalid' | 'disabled'
  last_sync_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  account_id: string | null
  client_id: string | null
  ref: string | null
  name: string
  url: string
  account_email: string | null
  anon_key_enc: string | null
  publishable_key_enc: string | null
  service_key_enc: string | null
  db_url_enc: string | null
  source: 'sync' | 'manual'
  status: string | null
  region: string | null
  pg_version: string | null
  notes: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ServiceHealth {
  name: string
  healthy: boolean
  status: string | null
}

export interface Snapshot {
  id: number
  project_id: string
  collected_at: string
  ok: boolean
  error: string | null
  health_json: ServiceHealth[] | null
  overall_health: Health | null
  cpu_pct: number | null
  ram_pct: number | null
  ram_total_bytes: number | null
  ram_used_bytes: number | null
  disk_pct: number | null
  disk_total_bytes: number | null
  disk_used_bytes: number | null
  load1: number | null
  db_size_bytes: number | null
  active_connections: number | null
  max_connections: number | null
  cpu_total_seconds: number | null
  cpu_idle_seconds: number | null
}

export interface AuditLog {
  id: number
  project_id: string | null
  action: string
  detail: string | null
  meta: Record<string, unknown> | null
  actor: string | null
  ip: string | null
  created_at: string
}

export interface QueryHistoryEntry {
  id: number
  project_id: string
  sql: string
  success: boolean
  error: string | null
  row_count: number | null
  duration_ms: number | null
  executed_at: string
}

/** Projeto + dados derivados que a UI consome. */
export interface ProjectWithMeta extends Project {
  client?: Pick<Client, 'id' | 'name' | 'color'> | null
  latest_snapshot?: Snapshot | null
  has_pat: boolean
}

/** Coluna de uma tabela, extraida do spec OpenAPI do PostgREST. */
export interface TableColumn {
  name: string
  type: string
  format: string
  required: boolean
  isPrimaryKey: boolean
  description?: string
}

export interface TableInfo {
  name: string
  columns: TableColumn[]
  primaryKeys: string[]
}
