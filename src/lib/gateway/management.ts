/**
 * Management API da Supabase (api.supabase.com/v1), autenticada por PAT.
 * Toda chamada sai daqui para que mudancas na API fiquem isoladas em um lugar.
 */

import { messageFromResponse } from './http-error'

const BASE = 'https://api.supabase.com/v1'

export class ManagementApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ManagementApiError'
  }
}

async function call<T>(
  pat: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })

    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!res.ok) {
      // Nunca usar o corpo cru como mensagem: quando o Cloudflare responde,
      // ele manda uma página HTML inteira.
      const msg = messageFromResponse(parsed, res.status, 'A Supabase')
      throw new ManagementApiError(msg, res.status, parsed)
    }

    return parsed as T
  } catch (err) {
    if (err instanceof ManagementApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ManagementApiError('Tempo esgotado ao falar com a Management API.', 408)
    }
    throw new ManagementApiError(
      err instanceof Error ? err.message : 'Falha de rede na Management API.',
      0,
    )
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Tipos da API
// ---------------------------------------------------------------------------

export interface MgmtProject {
  id: string
  ref?: string
  organization_id: string
  name: string
  region: string
  created_at: string
  status: string
  database?: { host: string; version: string; postgres_engine?: string }
}

export interface MgmtApiKey {
  name: string
  api_key: string
  id?: string
  type?: string
}

export interface MgmtOrganization {
  id: string
  /** Identificador atual da organizacao. O `id` esta deprecado na API. */
  slug: string
  name: string
}

export interface CreateProjectInput {
  name: string
  organizationSlug: string
  /** Senha do banco. Gerada por nos: a Supabase nunca a devolve depois. */
  dbPass: string
  region?: string
}

export interface MgmtHealthService {
  name: string
  healthy: boolean
  status: string
  error?: string
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

/** Valida o PAT listando organizacoes. Erro aqui = token inválido/expirado. */
export async function validatePat(pat: string): Promise<MgmtOrganization[]> {
  return call<MgmtOrganization[]>(pat, '/organizations')
}

/**
 * Organizacoes da conta. Mesma chamada da validacao, com outro nome, aqui o
 * interesse e a lista em si: e dentro de uma organizacao que um projeto nasce.
 */
export async function listOrganizations(pat: string): Promise<MgmtOrganization[]> {
  return call<MgmtOrganization[]>(pat, '/organizations')
}

/**
 * Cria um projeto novo na conta. A Supabase responde antes de o projeto estar
 * de pe (status COMING_UP): quem chama precisa lidar com essa espera.
 *
 * A senha do banco so existe nesta requisicao: a API nao a devolve depois, e
 * nem o painel. Perdeu, so resetando.
 */
export async function createProject(
  pat: string,
  input: CreateProjectInput,
): Promise<MgmtProject> {
  const project = await call<MgmtProject>(
    pat,
    '/projects',
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        organization_slug: input.organizationSlug,
        db_pass: input.dbPass,
        ...(input.region ? { region: input.region } : {}),
      }),
    },
    45000,
  )

  return { ...project, ref: project.ref ?? project.id }
}

export async function listProjects(pat: string): Promise<MgmtProject[]> {
  const projects = await call<MgmtProject[]>(pat, '/projects')
  return projects.map((p) => ({ ...p, ref: p.ref ?? p.id }))
}

export async function getProject(pat: string, ref: string): Promise<MgmtProject> {
  const p = await call<MgmtProject>(pat, `/projects/${ref}`)
  return { ...p, ref: p.ref ?? p.id }
}

/**
 * Chaves de API do projeto. `reveal=true` e necessário nas versoes recentes
 * da API para trazer o valor da service_role.
 */
export async function getProjectKeys(pat: string, ref: string): Promise<MgmtApiKey[]> {
  try {
    return await call<MgmtApiKey[]>(pat, `/projects/${ref}/api-keys?reveal=true`)
  } catch (err) {
    // Compatibilidade com contas/planos onde o parametro reveal não existe.
    if (err instanceof ManagementApiError && (err.status === 400 || err.status === 404)) {
      return call<MgmtApiKey[]>(pat, `/projects/${ref}/api-keys`)
    }
    throw err
  }
}

export function pickKeys(keys: MgmtApiKey[]): {
  anon: string | null
  service: string | null
  publishable: string | null
} {
  const find = (needle: string) =>
    keys.find((k) => k.name?.toLowerCase() === needle)?.api_key ??
    keys.find((k) => k.name?.toLowerCase().includes(needle))?.api_key ??
    null

  // A publishable nao se acha pelo nome: a primeira chama-se "default" e o
  // projeto pode ter varias. O tipo e o prefixo sao o que a identificam.
  const publishable =
    keys.find((k) => k.type === 'publishable' && k.name?.toLowerCase() === 'default')?.api_key ??
    keys.find((k) => k.type === 'publishable')?.api_key ??
    keys.find((k) => k.api_key?.startsWith('sb_publishable_'))?.api_key ??
    null

  return { anon: find('anon'), service: find('service_role') ?? find('service'), publishable }
}

/** Saúde por serviço. Base do "Project Overview". */
export async function getHealth(
  pat: string,
  ref: string,
  services = ['db', 'auth', 'rest', 'storage', 'realtime'],
): Promise<MgmtHealthService[]> {
  const qs = services.map((s) => `services=${s}`).join('&')
  return call<MgmtHealthService[]>(pat, `/projects/${ref}/health?${qs}`)
}

/** Executa SQL arbitrario no banco do projeto. */
export async function runQuery<T = Record<string, unknown>>(
  pat: string,
  ref: string,
  query: string,
  readOnly = false,
): Promise<T[]> {
  const result = await call<T[] | { result?: T[] }>(
    pat,
    `/projects/${ref}/database/query`,
    {
      method: 'POST',
      body: JSON.stringify({ query, read_only: readOnly }),
    },
    60000,
  )

  if (Array.isArray(result)) return result
  if (result && Array.isArray(result.result)) return result.result
  return []
}

export async function pauseProject(pat: string, ref: string): Promise<void> {
  await call(pat, `/projects/${ref}/pause`, { method: 'POST' })
}

export async function restoreProject(pat: string, ref: string): Promise<void> {
  await call(pat, `/projects/${ref}/restore`, { method: 'POST' })
}

export async function getFunctionSecrets(
  pat: string,
  ref: string,
): Promise<Array<{ name: string; value: string }>> {
  return call(pat, `/projects/${ref}/secrets`)
}

export async function getPostgresConfig(pat: string, ref: string): Promise<Record<string, unknown>> {
  return call(pat, `/projects/${ref}/config/database/postgres`)
}

// ---------------------------------------------------------------------------
// Ferramentas de desenvolvimento
//
// Tudo daqui para baixo existe para os agentes de IA: sao as chamadas que o
// MCP oficial da Supabase expoe e que faltavam aqui.
// ---------------------------------------------------------------------------

/**
 * Tipos TypeScript gerados a partir do schema do projeto.
 *
 * E o mesmo arquivo que `supabase gen types typescript` produz, quem esta
 * escrevendo o app cola isso em `database.types.ts` e ganha autocomplete.
 */
export async function generateTypescriptTypes(
  pat: string,
  ref: string,
  schemas = ['public'],
): Promise<string> {
  const qs = schemas.map((s) => `included_schemas=${encodeURIComponent(s)}`).join('&')
  const result = await call<{ types?: string } | string>(
    pat,
    `/projects/${ref}/types/typescript?${qs}`,
    {},
    45000,
  )

  if (typeof result === 'string') return result
  return result?.types ?? ''
}

export interface Advisor {
  name: string
  title?: string
  level?: string
  categories?: string[]
  description?: string
  detail?: string
  remediation?: string
  metadata?: Record<string, unknown>
}

/**
 * Avisos de seguranca e de performance do projeto: RLS desligado, funcao com
 * search_path mutavel, indice faltando em chave estrangeira, indice sem uso.
 *
 * E a mesma lista da aba Advisors do painel. Depois de criar tabela nova,
 * vale sempre conferir aqui, e como se descobre RLS esquecido.
 */
export async function getAdvisors(
  pat: string,
  ref: string,
  type: 'security' | 'performance',
): Promise<Advisor[]> {
  const result = await call<{ lints?: Advisor[] } | Advisor[]>(
    pat,
    `/projects/${ref}/advisors/${type}`,
    {},
    30000,
  )

  if (Array.isArray(result)) return result
  return result?.lints ?? []
}

/**
 * Consulta os logs do projeto (API, Postgres, Auth, Storage, Edge Functions)
 * com SQL, na janela de tempo pedida.
 *
 * A Supabase guarda cada servico numa tabela propria do BigQuery. O `sql`
 * chega pronto de quem chama, porque a forma da consulta muda de servico
 * para servico.
 */
export async function queryLogs(
  pat: string,
  ref: string,
  sql: string,
  opts: { iso_timestamp_start?: string; iso_timestamp_end?: string } = {},
): Promise<unknown[]> {
  const params = new URLSearchParams({ sql })
  if (opts.iso_timestamp_start) params.set('iso_timestamp_start', opts.iso_timestamp_start)
  if (opts.iso_timestamp_end) params.set('iso_timestamp_end', opts.iso_timestamp_end)

  const result = await call<{ result?: unknown[] } | unknown[]>(
    pat,
    `/projects/${ref}/analytics/endpoints/logs.all?${params.toString()}`,
    {},
    45000,
  )

  if (Array.isArray(result)) return result
  return result?.result ?? []
}

export interface EdgeFunction {
  id?: string
  slug: string
  name: string
  status?: string
  version?: number
  verify_jwt?: boolean
  entrypoint_path?: string
  created_at?: number
  updated_at?: number
}

export async function listEdgeFunctions(pat: string, ref: string): Promise<EdgeFunction[]> {
  const result = await call<EdgeFunction[]>(pat, `/projects/${ref}/functions`)
  return Array.isArray(result) ? result : []
}

/** Metadados de uma function. O codigo vem por `getEdgeFunctionBody`. */
export async function getEdgeFunction(
  pat: string,
  ref: string,
  slug: string,
): Promise<EdgeFunction> {
  return call<EdgeFunction>(pat, `/projects/${ref}/functions/${encodeURIComponent(slug)}`)
}

export async function getEdgeFunctionBody(
  pat: string,
  ref: string,
  slug: string,
): Promise<string> {
  const result = await call<string | { body?: string }>(
    pat,
    `/projects/${ref}/functions/${encodeURIComponent(slug)}/body`,
  )
  if (typeof result === 'string') return result
  return result?.body ?? ''
}

export interface EdgeFunctionFile {
  /** Caminho relativo dentro da function, ex: "index.ts". */
  name: string
  content: string
}

/**
 * Publica (ou atualiza) uma edge function.
 *
 * A API espera multipart: uma parte `metadata` em JSON e uma parte por
 * arquivo. E o mesmo formato que o CLI usa em `supabase functions deploy`.
 * Criar e atualizar sao a mesma chamada: o `slug` decide.
 */
export async function deployEdgeFunction(
  pat: string,
  ref: string,
  input: {
    slug: string
    name?: string
    files: EdgeFunctionFile[]
    entrypoint?: string
    importMap?: string
    verifyJwt?: boolean
  },
): Promise<EdgeFunction> {
  const entrypoint = input.entrypoint ?? input.files[0]?.name ?? 'index.ts'

  const form = new FormData()
  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name: input.name ?? input.slug,
          entrypoint_path: entrypoint,
          ...(input.importMap ? { import_map_path: input.importMap } : {}),
          ...(input.verifyJwt === undefined ? {} : { verify_jwt: input.verifyJwt }),
        }),
      ],
      { type: 'application/json' },
    ),
  )

  for (const file of input.files) {
    form.append('file', new Blob([file.content], { type: 'text/typescript' }), file.name)
  }

  // Sem `Content-Type` de proposito: o fetch precisa montar o boundary.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)

  try {
    const res = await fetch(
      `${BASE}/projects/${ref}/functions/deploy?slug=${encodeURIComponent(input.slug)}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${pat}` },
        body: form,
        cache: 'no-store',
      },
    )

    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!res.ok) {
      throw new ManagementApiError(
        messageFromResponse(parsed, res.status, 'A Supabase'),
        res.status,
        parsed,
      )
    }

    return parsed as EdgeFunction
  } catch (err) {
    if (err instanceof ManagementApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ManagementApiError('Tempo esgotado ao publicar a edge function.', 408)
    }
    throw new ManagementApiError(
      err instanceof Error ? err.message : 'Falha ao publicar a edge function.',
      0,
    )
  } finally {
    clearTimeout(timer)
  }
}
