import { NextResponse } from 'next/server'
import { gunzipSync } from 'node:zlib'
import { systemDb } from '@/lib/db'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import { runQuery } from '@/lib/gateway/management'
import { parseBackupData } from '@/lib/gateway/backup'
import { truncate } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const PAGE = 100

async function loadDump(backupId: string, projectId: string) {
  const db = systemDb()

  const { data: backup } = await db
    .from('backups')
    .select('storage_path, project_id, started_at')
    .eq('id', backupId)
    .maybeSingle<{ storage_path: string; project_id: string; started_at: string }>()

  if (!backup || backup.project_id !== projectId) return null

  const { data: file, error } = await db.storage.from('backups').download(backup.storage_path)
  if (error || !file) return null

  const dump = gunzipSync(Buffer.from(await file.arrayBuffer())).toString('utf8')
  return { dump, startedAt: backup.started_at }
}

/**
 * Abre um backup para leitura, sem restaurar nada.
 *
 * Sem `table`: devolve a lista de tabelas e quantas linhas cada uma tem.
 * Com `table`: devolve as linhas daquela tabela, paginadas.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const url = new URL(request.url)
  const backupId = url.searchParams.get('backupId')
  const table = url.searchParams.get('table')
  const offset = Number(url.searchParams.get('offset')) || 0

  if (!backupId) return NextResponse.json({ error: 'Informe o backup.' }, { status: 400 })

  try {
    const loaded = await loadDump(backupId, id)
    if (!loaded) return NextResponse.json({ error: 'Backup não encontrado.' }, { status: 404 })

    const data = parseBackupData(loaded.dump)

    if (!table) {
      return NextResponse.json({
        startedAt: loaded.startedAt,
        tables: data.map((t) => ({ table: t.table, rows: t.rows.length })),
      })
    }

    const found = data.find((t) => t.table === table)
    if (!found) {
      return NextResponse.json({ error: 'Tabela não encontrada neste backup.' }, { status: 404 })
    }

    const columns = found.rows.length ? Object.keys(found.rows[0]) : []

    return NextResponse.json({
      table,
      columns,
      total: found.rows.length,
      offset,
      rows: found.rows.slice(offset, offset + PAGE),
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao abrir o backup.')
  }
}

interface RestoreBody {
  backupId: string
  table: string
  /** Índices das linhas dentro da tabela, como vieram na leitura. */
  rowIndexes: number[]
  /** `missing` insere só o que não existe; `overwrite` substitui pela versão do backup. */
  mode: 'missing' | 'overwrite'
}

/**
 * Devolve linhas específicas de um backup para a tabela viva.
 *
 * Resolve o caso real mais comum, "apagaram itens que não podiam", sem
 * desfazer tudo que aconteceu depois, que é o que uma restauração completa
 * faria.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<RestoreBody>(request)

  if (!body?.backupId || !body.table || !body.rowIndexes?.length) {
    return NextResponse.json(
      { error: 'Informe o backup, a tabela e quais linhas restaurar.' },
      { status: 400 },
    )
  }

  try {
    const creds = await getProjectCredentials(id)
    if (!creds) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

    if (!creds.pat || !creds.project.ref) {
      return NextResponse.json(
        { error: 'Restaurar linhas exige o token da conta deste projeto.' },
        { status: 422 },
      )
    }

    const loaded = await loadDump(body.backupId, id)
    if (!loaded) return NextResponse.json({ error: 'Backup não encontrado.' }, { status: 404 })

    const found = parseBackupData(loaded.dump).find((t) => t.table === body.table)
    if (!found) {
      return NextResponse.json({ error: 'Tabela não encontrada neste backup.' }, { status: 404 })
    }

    const rows = body.rowIndexes
      .map((i) => found.rows[i])
      .filter((r): r is Record<string, unknown> => Boolean(r))

    if (!rows.length) {
      return NextResponse.json({ error: 'Nenhuma linha válida selecionada.' }, { status: 400 })
    }

    const ident = (name: string) => `"${name.replace(/"/g, '""')}"`
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
    const target = `public.${ident(body.table)}`

    // Descobre a chave primária: sem ela não há como decidir o que é conflito.
    const pkRows = await runQuery<{ col: string }>(
      creds.pat,
      creds.project.ref,
      `select a.attname as col
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = ${literal(target)}::regclass and i.indisprimary`,
      true,
    )

    const pkCols = pkRows.map((r) => r.col)

    if (!pkCols.length) {
      return NextResponse.json(
        {
          error:
            'Esta tabela não tem chave primária, então não há como identificar quais linhas já existem. Restaurar aqui poderia duplicar dados.',
        },
        { status: 422 },
      )
    }

    const conflictTarget = `(${pkCols.map(ident).join(', ')})`

    // `missing` é o padrão seguro: recoloca o que sumiu sem tocar no que ficou.
    const onConflict =
      body.mode === 'overwrite'
        ? `on conflict ${conflictTarget} do update set ${Object.keys(rows[0])
            .filter((c) => !pkCols.includes(c))
            .map((c) => `${ident(c)} = excluded.${ident(c)}`)
            .join(', ')}`
        : `on conflict ${conflictTarget} do nothing`

    const before = await runQuery<{ n: number }>(
      creds.pat,
      creds.project.ref,
      `select count(*)::int as n from ${target}`,
      true,
    )

    await runQuery(
      creds.pat,
      creds.project.ref,
      `insert into ${target}
       select * from json_populate_recordset(null::${target}, ${literal(JSON.stringify(rows))}::json)
       ${onConflict}`,
      false,
    )

    const after = await runQuery<{ n: number }>(
      creds.pat,
      creds.project.ref,
      `select count(*)::int as n from ${target}`,
      true,
    )

    const inserted = (after[0]?.n ?? 0) - (before[0]?.n ?? 0)

    await audit({
      action: 'backup.rows_restored',
      projectId: id,
      detail: `${creds.project.name} · ${body.table} · ${rows.length} selecionada(s), ${inserted} inserida(s) · modo ${
        body.mode === 'overwrite' ? 'substituir' : 'só as ausentes'
      }`,
      actor: g.session.email,
      meta: { table: body.table, selected: rows.length, inserted, mode: body.mode },
    })

    return NextResponse.json({
      ok: true,
      selected: rows.length,
      inserted,
      skipped: rows.length - inserted,
      mode: body.mode,
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao restaurar as linhas.')
  }
}
