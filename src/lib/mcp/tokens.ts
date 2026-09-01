import crypto from 'node:crypto'
import { systemDb } from '@/lib/db'

/**
 * Tokens de agente.
 *
 * O token é mostrado UMA vez, na criação, e nunca mais. O banco guarda só o
 * hash SHA-256: se este banco vazar, ninguém reconstrói os tokens. É a mesma
 * lógica de senha: não há motivo para o servidor conseguir ler de volta.
 *
 * SHA-256 puro basta aqui (diferente de senha, que precisa de KDF lento):
 * o token tem 32 bytes aleatórios, então força bruta é inviável por entropia.
 */

const PREFIX = 'sbm_'

export interface McpToken {
  id: string
  name: string
  token_prefix: string
  project_ids: string[]
  can_write: boolean
  can_ddl: boolean
  can_manage_projects: boolean
  last_used_at: string | null
  call_count: number
  revoked_at: string | null
  created_at: string
  notes: string | null
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Gera um token novo. O texto puro só existe neste retorno. */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  return { token, hash: hash(token), prefix: token.slice(0, 12) }
}

export interface ResolvedToken {
  id: string
  name: string
  /** INSERT, UPDATE, DELETE e as ferramentas de linha. */
  canWrite: boolean
  /** CREATE, ALTER, DROP, migrations, buckets. Ver migration 0007. */
  canDdl: boolean
  /** Criar, pausar, restaurar projeto e editar a carteira. Ver migration 0007. */
  canManageProjects: boolean
  /** Permite obter service_role key e connection string. Ver migration 0005. */
  canReadSecrets: boolean
  /** Vazio = todos os projetos. */
  projectIds: string[]
  /**
   * Limites vindos da URL de conexão (?read_only=true&projeto=…), aplicados
   * por cima do que o token permite. Servem para o mesmo token ser usado de
   * forma mais estreita num cliente específico, como no MCP da Supabase.
   */
  connection?: ConnectionLimits
}

export interface ConnectionLimits {
  readOnly: boolean
  /** Nome ou ref do projeto ao qual esta conexão está presa. */
  project?: string | null
  /** Grupos de ferramentas habilitados. Vazio = todos. */
  features: string[]
}

/**
 * Valida o token recebido no cabeçalho e devolve o escopo.
 * Retorna null para token inválido, revogado ou ausente.
 */
export async function resolveToken(authorization: string | null): Promise<ResolvedToken | null> {
  if (!authorization) return null

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  const token = match?.[1]?.trim()
  if (!token || !token.startsWith(PREFIX)) return null

  interface Row {
    id: string
    name: string
    can_write: boolean
    can_ddl?: boolean | null
    can_manage_projects?: boolean | null
    can_read_secrets: boolean
    project_ids: string[]
    revoked_at: string | null
  }

  const buscar = (colunas: string) =>
    systemDb()
      .from('mcp_tokens')
      .select(colunas)
      .eq('token_hash', hash(token))
      .maybeSingle<Row>()

  let { data, error } = await buscar(
    'id, name, can_write, can_ddl, can_manage_projects, can_read_secrets, project_ids, revoked_at',
  )

  // A migration 0007 pode não ter rodado ainda no banco do sistema. Em vez de
  // recusar todo mundo até alguém aplicá-la, o servidor volta a funcionar como
  // antes dela: sem estrutura e sem gestão de projetos.
  if (error) {
    ;({ data } = await buscar(
      'id, name, can_write, can_read_secrets, project_ids, revoked_at',
    ))
  }

  if (!data || data.revoked_at) return null

  return {
    id: data.id,
    name: data.name,
    canWrite: data.can_write,
    canDdl: data.can_ddl === true,
    canManageProjects: data.can_manage_projects === true,
    canReadSecrets: data.can_read_secrets === true,
    projectIds: data.project_ids ?? [],
  }
}

/**
 * Aperta o token com os limites da URL de conexão.
 *
 * Nunca afrouxa: `read_only=true` desliga escrita, estrutura e gestão, mas
 * nenhum parâmetro liga o que o token não tem. É o mesmo desenho do MCP
 * oficial da Supabase, onde a URL escolhe um recorte mais estreito do que a
 * credencial já permite.
 */
export function applyConnectionLimits(
  token: ResolvedToken,
  limits: ConnectionLimits,
): ResolvedToken {
  if (!limits.readOnly) return { ...token, connection: limits }

  return {
    ...token,
    canWrite: false,
    canDdl: false,
    canManageProjects: false,
    connection: limits,
  }
}

/** Lê os limites da URL do endpoint: ?read_only=true&projeto=x&features=a,b */
export function parseConnectionLimits(url: string): ConnectionLimits {
  const params = new URL(url).searchParams
  const bool = (v: string | null) => v === 'true' || v === '1'

  return {
    readOnly: bool(params.get('read_only')) || bool(params.get('somente_leitura')),
    project: params.get('projeto') ?? params.get('project') ?? params.get('project_ref'),
    features: (params.get('features') ?? params.get('grupos') ?? '')
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean),
  }
}

/** O token alcança este projeto? Lista vazia significa "todos". */
export function tokenReachesProject(token: ResolvedToken, projectId: string): boolean {
  return token.projectIds.length === 0 || token.projectIds.includes(projectId)
}

/**
 * Registra a chamada e atualiza o uso do token.
 *
 * Nunca lança: se o registro falhar, a chamada do agente não pode quebrar
 * por causa disso, mas o erro vai para o log do servidor.
 */
export async function logCall(input: {
  token: ResolvedToken
  tool: string
  args?: unknown
  projectId?: string | null
  ok: boolean
  error?: string
  durationMs: number
}): Promise<void> {
  try {
    const db = systemDb()

    await db.from('mcp_calls').insert({
      token_id: input.token.id,
      token_name: input.token.name,
      project_id: input.projectId ?? null,
      tool: input.tool,
      arguments: input.args ?? null,
      ok: input.ok,
      error: input.error?.slice(0, 500) ?? null,
      duration_ms: input.durationMs,
    })

    // O cliente da Supabase RESOLVE com { error } dentro em vez de rejeitar a
    // promise. Um .then(ok, erro) aqui nunca enxerga a falha, e foi assim que
    // o contador ficou parado em zero por três semanas: a função não existia
    // no banco e o plano B nunca chegou a rodar. Ver migration 0008.
    const { error } = await db.rpc('touch_mcp_token', { token_id: input.token.id })

    if (error) {
      console.error('[mcp] touch_mcp_token falhou:', error.message)

      // Sem a função no banco, ao menos a data de uso fica registrada.
      // call_count depende do incremento atômico que só a função faz.
      await db
        .from('mcp_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', input.token.id)
    }
  } catch (err) {
    console.error('[mcp] falha ao registrar chamada:', err)
  }
}
