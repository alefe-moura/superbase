import { systemDb } from './db'
import { decryptMaybe, encryptSecret } from './crypto'
import { getProjectKeys, pickKeys } from './gateway/management'
import type { Client, Project, ProjectWithMeta, Snapshot } from './types'

/** Projeto com credenciais ja descriptografadas, SO no servidor. */
export interface ProjectCredentials {
  project: Project
  serviceKey: string | null
  anonKey: string | null
  /** Chave nova do cliente (sb_publishable_...), sucessora da anon. */
  publishableKey: string | null
  dbUrl: string | null
  /** PAT da conta de origem, quando o projeto veio de um sync. */
  pat: string | null
}

export async function getProjectCredentials(projectId: string): Promise<ProjectCredentials | null> {
  const db = systemDb()

  const { data: project, error } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .is('archived_at', null)
    .maybeSingle<Project>()

  if (error || !project) return null

  let pat: string | null = null
  if (project.account_id) {
    const { data: account } = await db
      .from('accounts')
      .select('pat_encrypted, status')
      .eq('id', project.account_id)
      .maybeSingle<{ pat_encrypted: string; status: string }>()

    if (account && account.status !== 'disabled') {
      pat = decryptMaybe(account.pat_encrypted)
    }
  }

  return {
    project,
    serviceKey: decryptMaybe(project.service_key_enc),
    anonKey: decryptMaybe(project.anon_key_enc),
    publishableKey: decryptMaybe(project.publishable_key_enc),
    dbUrl: decryptMaybe(project.db_url_enc),
    pat,
  }
}

/**
 * Publishable key do projeto, buscando na Supabase quando ela ainda não esta
 * no cofre, o caso de todo projeto importado antes desta coluna existir e de
 * todo projeto que criou as chaves novas depois do ultimo sync. Achou, guarda,
 * e a proxima leitura ja sai do banco.
 *
 * Nunca lanca: um projeto so com chaves legadas simplesmente nao tem essa
 * chave, e isso e uma resposta valida, nao um erro.
 */
export async function ensurePublishableKey(creds: ProjectCredentials): Promise<string | null> {
  if (creds.publishableKey) return creds.publishableKey
  if (!creds.pat || !creds.project.ref) return null

  try {
    const { publishable } = pickKeys(await getProjectKeys(creds.pat, creds.project.ref))
    if (!publishable) return null

    await systemDb()
      .from('projects')
      .update({ publishable_key_enc: encryptSecret(publishable) })
      .eq('id', creds.project.id)

    return publishable
  } catch {
    return null
  }
}

/** Lista a carteira com cliente e último snapshot embutidos. */
export async function listProjectsWithMeta(): Promise<ProjectWithMeta[]> {
  const db = systemDb()

  const { data: projects, error } = await db
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .order('name', { ascending: true })
    .returns<Project[]>()

  if (error || !projects?.length) return []

  const [{ data: clients }, { data: snapshots }] = await Promise.all([
    db.from('clients').select('id, name, color').returns<Pick<Client, 'id' | 'name' | 'color'>[]>(),
    db
      .from('snapshots')
      .select('*')
      .in(
        'project_id',
        projects.map((p) => p.id),
      )
      .order('collected_at', { ascending: false })
      .limit(projects.length * 3)
      .returns<Snapshot[]>(),
  ])

  const clientById = new Map((clients ?? []).map((c) => [c.id, c]))

  const latestByProject = new Map<string, Snapshot>()
  for (const snap of snapshots ?? []) {
    if (!latestByProject.has(snap.project_id)) latestByProject.set(snap.project_id, snap)
  }

  return projects.map((p) => ({
    ...p,
    client: p.client_id ? (clientById.get(p.client_id) ?? null) : null,
    latest_snapshot: latestByProject.get(p.id) ?? null,
    has_pat: Boolean(p.account_id),
  }))
}

export async function getProjectWithMeta(projectId: string): Promise<ProjectWithMeta | null> {
  const db = systemDb()

  const { data: project } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .is('archived_at', null)
    .maybeSingle<Project>()

  if (!project) return null

  const [{ data: client }, { data: snapshot }] = await Promise.all([
    project.client_id
      ? db
          .from('clients')
          .select('id, name, color')
          .eq('id', project.client_id)
          .maybeSingle<Pick<Client, 'id' | 'name' | 'color'>>()
      : Promise.resolve({ data: null }),
    db
      .from('snapshots')
      .select('*')
      .eq('project_id', project.id)
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle<Snapshot>(),
  ])

  return {
    ...project,
    client: client ?? null,
    latest_snapshot: snapshot ?? null,
    has_pat: Boolean(project.account_id),
  }
}

/** Extrai o ref a partir da URL do projeto (https://<ref>.supabase.co). */
export function refFromUrl(url: string): string | null {
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in|red)/i.exec(url.trim())
  return match ? match[1] : null
}

export function normalizeProjectUrl(input: string): string {
  let url = input.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  return url.replace(/\/+$/, '')
}
