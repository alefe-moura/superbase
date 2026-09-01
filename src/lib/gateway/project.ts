/**
 * Acesso aos dados DENTRO de um projeto do cliente, via service_role key.
 * Não depende de PAT, funciona também em projetos cadastrados manualmente.
 *
 * Descoberta de tabelas: o PostgREST publica um spec OpenAPI na raiz do /rest/v1/,
 * que lista tabelas, colunas, tipos e chaves primárias. É o único jeito de mapear
 * o schema sem SQL (que exigiria PAT).
 */

import type { TableColumn, TableInfo } from '@/lib/types'
import { messageFromResponse } from './http-error'

export class ProjectApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'ProjectApiError'
  }
}

function restBase(projectUrl: string): string {
  return `${projectUrl.replace(/\/+$/, '')}/rest/v1`
}

function authBase(projectUrl: string): string {
  return `${projectUrl.replace(/\/+$/, '')}/auth/v1`
}

function storageBase(projectUrl: string): string {
  return `${projectUrl.replace(/\/+$/, '')}/storage/v1`
}

async function request<T>(
  url: string,
  serviceKey: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<{ data: T; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!res.ok) {
      const body = parsed as { message?: string; hint?: string; error?: string } | string
      const msg = messageFromResponse(parsed, res.status, 'O projeto')
      throw new ProjectApiError(
        msg,
        res.status,
        typeof body === 'object' ? body?.hint : undefined,
      )
    }

    return { data: parsed as T, headers: res.headers }
  } catch (err) {
    if (err instanceof ProjectApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProjectApiError('Tempo esgotado ao falar com o projeto.', 408)
    }
    throw new ProjectApiError(
      err instanceof Error ? err.message : 'Falha de rede ao falar com o projeto.',
      0,
    )
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Validação de credenciais (usada ao conectar projeto manual)
// ---------------------------------------------------------------------------

export async function testConnection(
  projectUrl: string,
  serviceKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await request(`${restBase(projectUrl)}/`, serviceKey, { method: 'GET' }, 15000)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ProjectApiError
          ? err.status === 401
            ? 'Chave rejeitada pelo projeto (401). Confira a service_role key.'
            : err.message
          : 'Não foi possível conectar ao projeto.',
    }
  }
}

// ---------------------------------------------------------------------------
// Descoberta de schema via OpenAPI do PostgREST
// ---------------------------------------------------------------------------

interface OpenApiSpec {
  definitions?: Record<
    string,
    {
      required?: string[]
      properties?: Record<
        string,
        { type?: string; format?: string; description?: string; default?: unknown }
      >
    }
  >
  paths?: Record<string, unknown>
}

/** Marcador que o PostgREST usa na descrição da coluna PK. */
function isPrimaryKey(description?: string): boolean {
  return Boolean(description && /<pk\/>/i.test(description))
}

function cleanDescription(description?: string): string | undefined {
  if (!description) return undefined
  const cleaned = description
    .replace(/<pk\/>/gi, '')
    .replace(/<fk table='[^']*' column='[^']*'\/>/gi, '')
    .trim()
  return cleaned || undefined
}

export async function listTables(projectUrl: string, serviceKey: string): Promise<TableInfo[]> {
  const { data } = await request<OpenApiSpec>(`${restBase(projectUrl)}/`, serviceKey)

  const definitions = data?.definitions ?? {}
  const tables: TableInfo[] = []

  for (const [name, def] of Object.entries(definitions)) {
    const required = new Set(def.required ?? [])
    const columns: TableColumn[] = []
    const primaryKeys: string[] = []

    for (const [colName, prop] of Object.entries(def.properties ?? {})) {
      const pk = isPrimaryKey(prop.description)
      if (pk) primaryKeys.push(colName)

      columns.push({
        name: colName,
        type: prop.type ?? 'unknown',
        format: prop.format ?? prop.type ?? 'unknown',
        required: required.has(colName),
        isPrimaryKey: pk,
        description: cleanDescription(prop.description),
      })
    }

    tables.push({ name, columns, primaryKeys })
  }

  return tables.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// CRUD de linhas
// ---------------------------------------------------------------------------

export interface RowQueryOptions {
  limit?: number
  offset?: number
  orderBy?: string
  ascending?: boolean
  /** Filtros crus no formato PostgREST: coluna=op.valor */
  filters?: string[]
  schema?: string
}

export async function listRows(
  projectUrl: string,
  serviceKey: string,
  table: string,
  opts: RowQueryOptions = {},
): Promise<{ rows: Record<string, unknown>[]; total: number | null }> {
  const limit = Math.min(opts.limit ?? 50, 500)
  const offset = opts.offset ?? 0

  const params = new URLSearchParams()
  params.set('select', '*')
  if (opts.orderBy) {
    params.set('order', `${opts.orderBy}.${opts.ascending === false ? 'desc' : 'asc'}`)
  }

  let url = `${restBase(projectUrl)}/${encodeURIComponent(table)}?${params.toString()}`
  for (const filter of opts.filters ?? []) {
    if (filter.trim()) url += `&${filter}`
  }

  const headers: Record<string, string> = {
    Range: `${offset}-${offset + limit - 1}`,
    // `estimated` devolve contagem exata em tabelas pequenas e cai para a
    // estimativa do planner nas grandes. Com `exact`, uma tabela de milhões
    // de linhas faria varredura completa a cada página.
    Prefer: 'count=estimated',
  }
  if (opts.schema && opts.schema !== 'public') headers['Accept-Profile'] = opts.schema

  const { data, headers: resHeaders } = await request<Record<string, unknown>[]>(url, serviceKey, {
    method: 'GET',
    headers,
  })

  // Content-Range: "0-49/1234"
  const contentRange = resHeaders.get('content-range')
  const totalRaw = contentRange?.split('/')[1]
  const total = totalRaw && totalRaw !== '*' ? Number(totalRaw) : null

  return { rows: Array.isArray(data) ? data : [], total }
}

/** Monta o seletor PostgREST que identifica exatamente uma linha pela PK. */
function pkSelector(pk: Record<string, unknown>): string {
  return Object.entries(pk)
    .map(([col, val]) => `${encodeURIComponent(col)}=eq.${encodeURIComponent(String(val))}`)
    .join('&')
}

export async function insertRow(
  projectUrl: string,
  serviceKey: string,
  table: string,
  values: Record<string, unknown>,
  schema?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Prefer: 'return=representation' }
  if (schema && schema !== 'public') headers['Content-Profile'] = schema

  const { data } = await request<Record<string, unknown>[]>(
    `${restBase(projectUrl)}/${encodeURIComponent(table)}`,
    serviceKey,
    { method: 'POST', headers, body: JSON.stringify(values) },
  )

  return Array.isArray(data) ? data[0] : (data as Record<string, unknown>)
}

export async function updateRow(
  projectUrl: string,
  serviceKey: string,
  table: string,
  pk: Record<string, unknown>,
  values: Record<string, unknown>,
  schema?: string,
): Promise<Record<string, unknown>> {
  if (!Object.keys(pk).length) {
    throw new ProjectApiError(
      'Esta tabela não tem chave primaria detectável, edição por linha indisponível.',
      400,
    )
  }

  const headers: Record<string, string> = { Prefer: 'return=representation' }
  if (schema && schema !== 'public') headers['Content-Profile'] = schema

  const { data } = await request<Record<string, unknown>[]>(
    `${restBase(projectUrl)}/${encodeURIComponent(table)}?${pkSelector(pk)}`,
    serviceKey,
    { method: 'PATCH', headers, body: JSON.stringify(values) },
  )

  return Array.isArray(data) ? data[0] : (data as Record<string, unknown>)
}

export async function deleteRow(
  projectUrl: string,
  serviceKey: string,
  table: string,
  pk: Record<string, unknown>,
  schema?: string,
): Promise<void> {
  if (!Object.keys(pk).length) {
    throw new ProjectApiError(
      'Esta tabela não tem chave primaria detectável, exclusão por linha indisponível.',
      400,
    )
  }

  const headers: Record<string, string> = {}
  if (schema && schema !== 'public') headers['Content-Profile'] = schema

  await request(
    `${restBase(projectUrl)}/${encodeURIComponent(table)}?${pkSelector(pk)}`,
    serviceKey,
    { method: 'DELETE', headers },
  )
}

// ---------------------------------------------------------------------------
// Auth Admin
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email?: string
  phone?: string
  created_at: string
  last_sign_in_at?: string
  email_confirmed_at?: string
  banned_until?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

export async function listAuthUsers(
  projectUrl: string,
  serviceKey: string,
  page = 1,
  perPage = 50,
): Promise<{ users: AuthUser[]; total: number | null }> {
  const { data } = await request<{ users: AuthUser[]; aud?: string; total?: number }>(
    `${authBase(projectUrl)}/admin/users?page=${page}&per_page=${perPage}`,
    serviceKey,
  )

  return { users: data?.users ?? [], total: data?.total ?? null }
}

export async function createAuthUser(
  projectUrl: string,
  serviceKey: string,
  payload: {
    email: string
    password?: string
    email_confirm?: boolean
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  },
): Promise<AuthUser> {
  const { data } = await request<AuthUser>(`${authBase(projectUrl)}/admin/users`, serviceKey, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data
}

export async function updateAuthUser(
  projectUrl: string,
  serviceKey: string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<AuthUser> {
  const { data } = await request<AuthUser>(
    `${authBase(projectUrl)}/admin/users/${userId}`,
    serviceKey,
    { method: 'PUT', body: JSON.stringify(payload) },
  )
  return data
}

export async function deleteAuthUser(
  projectUrl: string,
  serviceKey: string,
  userId: string,
): Promise<void> {
  await request(`${authBase(projectUrl)}/admin/users/${userId}`, serviceKey, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageBucket {
  id: string
  name: string
  public: boolean
  created_at: string
  updated_at: string
  file_size_limit: number | null
  allowed_mime_types: string[] | null
}

export interface StorageObject {
  name: string
  id: string | null
  updated_at: string | null
  created_at: string | null
  last_accessed_at: string | null
  metadata: { size?: number; mimetype?: string } | null
}

export async function listBuckets(
  projectUrl: string,
  serviceKey: string,
): Promise<StorageBucket[]> {
  const { data } = await request<StorageBucket[]>(`${storageBase(projectUrl)}/bucket`, serviceKey)
  return Array.isArray(data) ? data : []
}

/**
 * Cria um bucket no Storage do projeto.
 *
 * `public: true` significa que qualquer pessoa com a URL le o arquivo, sem
 * token, e a escolha certa para imagem de produto e avatar, e a errada para
 * documento de cliente. Por isso o padrao aqui e privado.
 */
export async function createBucket(
  projectUrl: string,
  serviceKey: string,
  input: {
    name: string
    public?: boolean
    fileSizeLimit?: number | null
    allowedMimeTypes?: string[] | null
  },
): Promise<{ name: string }> {
  const { data } = await request<{ name: string }>(`${storageBase(projectUrl)}/bucket`, serviceKey, {
    method: 'POST',
    body: JSON.stringify({
      id: input.name,
      name: input.name,
      public: input.public === true,
      ...(input.fileSizeLimit ? { file_size_limit: input.fileSizeLimit } : {}),
      ...(input.allowedMimeTypes?.length ? { allowed_mime_types: input.allowedMimeTypes } : {}),
    }),
  })

  return data ?? { name: input.name }
}

export async function listObjects(
  projectUrl: string,
  serviceKey: string,
  bucket: string,
  prefix = '',
  limit = 100,
): Promise<StorageObject[]> {
  const { data } = await request<StorageObject[]>(
    `${storageBase(projectUrl)}/object/list/${encodeURIComponent(bucket)}`,
    serviceKey,
    {
      method: 'POST',
      body: JSON.stringify({
        prefix,
        limit,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      }),
    },
  )
  return Array.isArray(data) ? data : []
}

export async function deleteObject(
  projectUrl: string,
  serviceKey: string,
  bucket: string,
  path: string,
): Promise<void> {
  await request(
    `${storageBase(projectUrl)}/object/${encodeURIComponent(bucket)}/${path}`,
    serviceKey,
    { method: 'DELETE' },
  )
}

export async function signedUrl(
  projectUrl: string,
  serviceKey: string,
  bucket: string,
  path: string,
  expiresIn = 300,
): Promise<string> {
  const { data } = await request<{ signedURL: string }>(
    `${storageBase(projectUrl)}/object/sign/${encodeURIComponent(bucket)}/${path}`,
    serviceKey,
    { method: 'POST', body: JSON.stringify({ expiresIn }) },
  )

  const base = projectUrl.replace(/\/+$/, '')
  return data.signedURL.startsWith('http')
    ? data.signedURL
    : `${base}/storage/v1${data.signedURL}`
}
