import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { generateToken } from '@/lib/mcp/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lista os tokens de agente. O token em si nunca volta, só o prefixo. */
export async function GET() {
  const g = await guard()
  if (!g.ok) return g.response

  try {
    const db = systemDb()

    const { data: tokens, error } = await db
      .from('mcp_tokens')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    // Quantas chamadas cada token fez nas últimas 24h, para dar noção de uso
    const desde = new Date(Date.now() - 86400_000).toISOString()
    const { data: chamadas } = await db
      .from('mcp_calls')
      .select('token_id, ok')
      .gte('created_at', desde)

    const uso = new Map<string, { total: number; erros: number }>()
    for (const c of chamadas ?? []) {
      if (!c.token_id) continue
      const atual = uso.get(c.token_id) ?? { total: 0, erros: 0 }
      atual.total++
      if (!c.ok) atual.erros++
      uso.set(c.token_id, atual)
    }

    return NextResponse.json({
      tokens: (tokens ?? []).map((t) => ({
        ...t,
        uso_24h: uso.get(t.id) ?? { total: 0, erros: 0 },
      })),
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar os agentes.')
  }
}

interface CreateBody {
  name: string
  project_ids?: string[]
  can_write?: boolean
  can_ddl?: boolean
  can_manage_projects?: boolean
  can_read_secrets?: boolean
  notes?: string
}

/** Cria um token. É a ÚNICA vez que o valor aparece. */
export async function POST(request: Request) {
  const g = await guard()
  if (!g.ok) return g.response

  const body = await parseBody<CreateBody>(request)
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Dê um nome ao agente.' }, { status: 400 })
  }

  try {
    const { token, hash, prefix } = generateToken()

    const { data, error } = await systemDb()
      .from('mcp_tokens')
      .insert({
        name: body.name.trim(),
        token_hash: hash,
        token_prefix: prefix,
        project_ids: body.project_ids ?? [],
        can_write: body.can_write === true,
        can_ddl: body.can_ddl === true,
        can_manage_projects: body.can_manage_projects === true,
        can_read_secrets: body.can_read_secrets === true,
        notes: body.notes?.trim() || null,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !data) throw new Error(error?.message ?? 'Falha ao criar o token.')

    const poderes = [
      body.can_write ? 'escrita' : 'somente leitura',
      body.can_ddl ? 'ALTERA ESTRUTURA' : null,
      body.can_manage_projects ? 'GERENCIA PROJETOS' : null,
      body.can_read_secrets ? 'PODE LER CREDENCIAIS' : null,
    ].filter(Boolean)

    await audit({
      action: 'agent.token_created',
      detail: `${body.name.trim()} · ${poderes.join(' · ')} · ${
        body.project_ids?.length ? `${body.project_ids.length} projeto(s)` : 'todos os projetos'
      }`,
      actor: g.session.email,
    })

    // O token só existe aqui. Depois disto, nem o banco sabe qual é.
    return NextResponse.json({ ok: true, id: data.id, token })
  } catch (err) {
    return errorResponse(err, 'Falha ao criar o agente.')
  }
}

/** Revoga (não apaga, para o histórico de chamadas continuar fazendo sentido). */
export async function DELETE(request: Request) {
  const g = await guard()
  if (!g.ok) return g.response

  const body = await parseBody<{ id: string }>(request)
  if (!body?.id) return NextResponse.json({ error: 'Informe o agente.' }, { status: 400 })

  try {
    const db = systemDb()

    const { data: token } = await db
      .from('mcp_tokens')
      .select('name')
      .eq('id', body.id)
      .maybeSingle<{ name: string }>()

    if (!token) return NextResponse.json({ error: 'Agente não encontrado.' }, { status: 404 })

    await db
      .from('mcp_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.id)

    await audit({
      action: 'agent.token_revoked',
      detail: token.name,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao revogar o agente.')
  }
}

/** Ajusta escopo e permissão de um token existente. */
export async function PATCH(request: Request) {
  const g = await guard()
  if (!g.ok) return g.response

  const body = await parseBody<{
    id: string
    project_ids?: string[]
    can_write?: boolean
    can_ddl?: boolean
    can_manage_projects?: boolean
    can_read_secrets?: boolean
  }>(request)
  if (!body?.id) return NextResponse.json({ error: 'Informe o agente.' }, { status: 400 })

  try {
    const patch: Record<string, unknown> = {}
    if (body.project_ids !== undefined) patch.project_ids = body.project_ids
    if (body.can_write !== undefined) patch.can_write = body.can_write
    if (body.can_ddl !== undefined) patch.can_ddl = body.can_ddl
    if (body.can_manage_projects !== undefined) {
      patch.can_manage_projects = body.can_manage_projects
    }
    if (body.can_read_secrets !== undefined) patch.can_read_secrets = body.can_read_secrets

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'Nada para alterar.' }, { status: 400 })
    }

    const { error } = await systemDb().from('mcp_tokens').update(patch).eq('id', body.id)
    if (error) throw new Error(error.message)

    await audit({
      action: 'agent.token_updated',
      detail: Object.keys(patch).join(', '),
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao atualizar o agente.')
  }
}
