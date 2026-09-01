import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import { runQuery } from '@/lib/gateway/management'
import { isWriteQuery, truncate } from '@/lib/utils'
import { invalidateSchema } from '@/lib/gateway/schema-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Histórico de queries do projeto. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const { data } = await systemDb()
      .from('query_history')
      .select('*')
      .eq('project_id', id)
      .order('executed_at', { ascending: false })
      .limit(50)

    return NextResponse.json({ history: data ?? [] })
  } catch (err) {
    return errorResponse(err, 'Falha ao carregar o histórico.')
  }
}

/** Executa SQL arbitrario via Management API (exige PAT da conta). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ sql: string }>(request)

  if (!body?.sql?.trim()) {
    return NextResponse.json({ error: 'Informe o SQL a executar.' }, { status: 400 })
  }

  const sql = body.sql.trim()

  try {
    const creds = await getProjectCredentials(id)
    if (!creds) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

    if (!creds.pat || !creds.project.ref) {
      return NextResponse.json(
        {
          error:
            'O SQL Runner precisa do token da conta. Conecte a conta deste projeto em Conexões para habilitar.',
        },
        { status: 422 },
      )
    }

    const startedAt = Date.now()
    let rows: Record<string, unknown>[] = []
    let success = true
    let errorMessage: string | null = null

    try {
      // NÃO usar o modo somente-leitura aqui.
      //
      // Quando `read_only` é verdadeiro, a Supabase executa como
      // `supabase_read_only_user` em vez de `postgres`, e esse papel não tem
      // permissão em várias funções. Um `select vault.create_secret(...)`
      // falhava com "permission denied for function create_secret", que não
      // tem nada a ver com o problema real.
      //
      // A causa raiz é que não dá para saber por análise de texto se uma
      // função escreve. Como quem usa esta tela é uma pessoa autenticada, que
      // já confirma antes de rodar comando de escrita, o modo somente-leitura
      // não acrescentava segurança, só quebrava casos legítimos.
      //
      // O MCP é outra história: lá o modo somente-leitura continua valendo,
      // porque é barreira contra agente sequestrado.
      rows = await runQuery(creds.pat, creds.project.ref, sql, false)
    } catch (err) {
      success = false
      errorMessage = err instanceof Error ? err.message : 'Falha ao executar o SQL.'
    }

    const durationMs = Date.now() - startedAt

    // DDL pode ter mudado o schema: derruba o cache para a aba Tabelas
    // não continuar mostrando a estrutura antiga.
    if (/\b(create|alter|drop|rename|comment)\b/i.test(sql)) {
      invalidateSchema(id)
    }

    await systemDb().from('query_history').insert({
      project_id: id,
      sql,
      success,
      error: errorMessage,
      row_count: rows.length,
      duration_ms: durationMs,
    })

    await audit({
      action: 'sql.executed',
      projectId: id,
      detail: `${creds.project.name} · ${truncate(sql.replace(/\s+/g, ' '), 120)}`,
      actor: g.session.email,
      meta: { success, write: isWriteQuery(sql), rows: rows.length, durationMs },
    })

    if (!success) {
      return NextResponse.json({ error: errorMessage, durationMs }, { status: 400 })
    }

    return NextResponse.json({ ok: true, rows, durationMs, rowCount: rows.length })
  } catch (err) {
    return errorResponse(err, 'Falha ao executar o SQL.')
  }
}
