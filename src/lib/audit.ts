import { headers } from 'next/headers'
import { systemDb } from './db'

export type AuditAction =
  | 'login.success'
  | 'login.failure'
  | 'logout'
  | 'account.connected'
  | 'account.deleted'
  | 'account.synced'
  | 'project.created'
  | 'project.provisioned'
  | 'project.updated'
  | 'project.paused'
  | 'project.restored'
  | 'project.archived'
  | 'project.keys_revealed'
  | 'client.created'
  | 'client.updated'
  | 'client.deleted'
  | 'data.row_inserted'
  | 'data.row_updated'
  | 'data.row_deleted'
  | 'sql.executed'
  | 'sql.migration_applied'
  | 'auth.user_created'
  | 'auth.user_updated'
  | 'auth.user_deleted'
  | 'storage.file_deleted'
  | 'storage.file_uploaded'
  | 'storage.bucket_created'
  | 'function.deployed'
  | 'snapshot.collected'
  | 'cron.installed'
  | 'cron.created'
  | 'cron.toggled'
  | 'cron.deleted'
  | 'cron.ran_now'
  | 'cron.no_sleep_installed'
  | 'cron.no_sleep_removed'
  | 'backup.created'
  | 'backup.failed'
  | 'backup.downloaded'
  | 'backup.deleted'
  | 'backup.rows_restored'
  | 'agent.token_created'
  | 'agent.token_revoked'
  | 'agent.token_updated'

interface AuditInput {
  action: AuditAction
  detail?: string
  projectId?: string | null
  meta?: Record<string, unknown>
  actor?: string | null
}

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers()
    return (
      h.get('x-forwarded-for')?.split(',')[0].trim() ||
      h.get('x-real-ip') ||
      null
    )
  } catch {
    return null
  }
}

/**
 * Registra uma ação sensivel. Nunca lanca, auditoria falhando não pode
 * derrubar a operação que o usuário pediu (mas vai pro log do servidor).
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const ip = await clientIp()
    await systemDb().from('audit_logs').insert({
      project_id: input.projectId ?? null,
      action: input.action,
      detail: input.detail ?? null,
      meta: input.meta ?? null,
      actor: input.actor ?? null,
      ip,
    })
  } catch (err) {
    console.error('[audit] falha ao registrar:', input.action, err)
  }
}

export { AUDIT_LABELS, DESTRUCTIVE_ACTIONS } from './audit-labels'
