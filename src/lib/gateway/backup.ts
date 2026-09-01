import { gzipSync } from 'node:zlib'
import { systemDb } from '@/lib/db'
import { decryptMaybe } from '@/lib/crypto'
import { runQuery } from './management'
import type { Project } from '@/lib/types'

/**
 * Backup lógico de um projeto Supabase.
 *
 * Não é `pg_dump`: função serverless não executa binário. É uma reconstrução
 * a partir do catálogo do Postgres, e o catálogo entrega o DDL exato de
 * quase tudo (`pg_get_constraintdef`, `pg_indexes.indexdef`,
 * `pg_get_triggerdef`, `pg_get_functiondef`, `pg_get_viewdef`), então a
 * fidelidade é alta.
 *
 * O truque que torna os dados confiáveis: em vez de montar INSERTs com
 * aspas na mão (onde qualquer tipo exótico vira bug silencioso), cada lote
 * de linhas vai como JSON e o próprio Postgres reconstrói os registros com
 * `json_populate_recordset`. Quem faz a conversão de tipo é o banco, não nós.
 *
 * FORA DO ESCOPO, e isso precisa ficar claro para quem for restaurar:
 *   - os ARQUIVOS dentro dos buckets do Storage (só a listagem é registrada);
 *   - código de Edge Functions;
 *   - roles, grants e configuração de extensões além do schema public.
 */

const DATA_BATCH = 500
const MAX_ROWS_PER_TABLE = 200_000

/**
 * Teto de bytes por comando INSERT.
 *
 * Dividir por quantidade de linhas não funciona: uma tabela com assinaturas
 * em base64 tem linhas milhares de vezes maiores que uma tabela de categorias.
 * 500 linhas de uma viravam 6 MB num único comando, que a API recusa.
 * O corte é por tamanho, então cada comando cabe em qualquer caminho de
 * restauração, API, SQL Editor ou psql.
 */
const MAX_STATEMENT_BYTES = 500_000

/**
 * Marcador de fim de comando.
 *
 * Bancos com dados pesados geram arquivos de vários MB: uma única tabela que
 * guarde binários em base64 passa de 6 MB sozinha. Nem a Management API nem o
 * SQL Editor engolem isso de uma vez.
 *
 * É um comentário SQL, então o arquivo continua válido para rodar inteiro no
 * psql; e quem precisar executar em blocos só divide por esta linha, sem
 * arriscar cortar no meio de uma string que contenha ponto e vírgula.
 */
export const STATEMENT_MARK = '-- @@'

/** Divide um dump nos comandos individuais, com segurança. */
export function splitStatements(dump: string): string[] {
  return dump
    .split(new RegExp(`^${STATEMENT_MARK}$`, 'm'))
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk && !/^(--[^\n]*\n?)+$/.test(chunk))
}

export interface BackupCounts {
  tables: number
  rows: number
  indexes: number
  triggers: number
  functions: number
  policies: number
  views: number
  sequences: number
  authUsers: number
}

export interface BackupResult {
  sql: string
  counts: BackupCounts
  warnings: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   Consultas ao catálogo
   ═══════════════════════════════════════════════════════════════════════════ */

interface ColumnRow {
  tbl: string
  col: string
  typ: string
  notnull: boolean
  default_expr: string | null
}

interface ConstraintRow {
  tbl: string
  conname: string
  def: string
  contype: string
}

const SQL = {
  /** format_type devolve o tipo exato, inclusive precisão e array. */
  columns: `
    select c.relname as tbl,
           a.attname as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as notnull,
           pg_get_expr(d.adbin, d.adrelid) as default_expr
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`,

  constraints: `
    select c.conrelid::regclass::text as tbl,
           c.conname,
           pg_get_constraintdef(c.oid) as def,
           c.contype::text as contype
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
    order by case c.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end`,

  indexes: `
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
    order by indexname`,

  triggers: `
    select t.tgname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
    order by t.tgname`,

  functions: `
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f','p')
    order by p.proname`,

  views: `
    select table_name, view_definition
    from information_schema.views
    where table_schema = 'public'
    order by table_name`,

  sequences: `
    select c.relname as name,
           s.seqstart as start_value,
           s.seqincrement as increment,
           s.seqmin as min_value,
           s.seqmax as max_value,
           s.seqcache as cache,
           s.seqcycle as cycle,
           pg_sequence_last_value(c.oid) as last_value,
           owner_tbl.relname as owned_table,
           owner_col.attname as owned_column
    from pg_sequence s
    join pg_class c on c.oid = s.seqrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_depend d
      on d.objid = c.oid and d.classid = 'pg_class'::regclass
     and d.refclassid = 'pg_class'::regclass and d.deptype = 'a'
    left join pg_class owner_tbl on owner_tbl.oid = d.refobjid
    left join pg_attribute owner_col
      on owner_col.attrelid = d.refobjid and owner_col.attnum = d.refobjsubid
    where n.nspname = 'public'
    order by c.relname`,

  policies: `
    select tablename, policyname, permissive, roles::text as roles,
           cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname`,

  rlsTables: `
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,

  authUsers: `select count(*)::int as n from auth.users`,

  storageObjects: `
    select b.name as bucket, count(o.id)::int as objetos,
           coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as bytes
    from storage.buckets b
    left join storage.objects o on o.bucket_id = b.id
    group by b.name
    order by b.name`,
}

/* ═══════════════════════════════════════════════════════════════════════════
   Utilidades
   ═══════════════════════════════════════════════════════════════════════════ */

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Tenta a query e devolve [] em vez de derrubar o backup inteiro. */
async function safeQuery<T>(
  pat: string,
  ref: string,
  sql: string,
  label: string,
  warnings: string[],
): Promise<T[]> {
  try {
    return await runQuery<T>(pat, ref, sql, true)
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : 'falhou'}`)
    return []
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Geração do arquivo
   ═══════════════════════════════════════════════════════════════════════════ */

export async function buildBackupSql(
  pat: string,
  ref: string,
  projectName: string,
  generatedAt: string,
): Promise<BackupResult> {
  const warnings: string[] = []
  const out: string[] = []

  /** Empurra um comando completo e fecha com o marcador. */
  const stmt = (sql: string) => out.push(sql, STATEMENT_MARK)

  const [columns, constraints, indexes, triggers, functions, views, sequences, policies, rlsTables] =
    await Promise.all([
      safeQuery<ColumnRow>(pat, ref, SQL.columns, 'colunas', warnings),
      safeQuery<ConstraintRow>(pat, ref, SQL.constraints, 'constraints', warnings),
      safeQuery<{ indexname: string; indexdef: string }>(pat, ref, SQL.indexes, 'índices', warnings),
      safeQuery<{ tgname: string; def: string }>(pat, ref, SQL.triggers, 'triggers', warnings),
      safeQuery<{ proname: string; def: string }>(pat, ref, SQL.functions, 'funções', warnings),
      safeQuery<{ table_name: string; view_definition: string }>(pat, ref, SQL.views, 'views', warnings),
      safeQuery<{
        name: string
        start_value: string
        increment: string
        min_value: string
        max_value: string
        cache: string
        cycle: boolean
        last_value: string | null
        owned_table: string | null
        owned_column: string | null
      }>(pat, ref, SQL.sequences, 'sequences', warnings),
      safeQuery<{
        tablename: string
        policyname: string
        permissive: string
        roles: string
        cmd: string
        qual: string | null
        with_check: string | null
      }>(pat, ref, SQL.policies, 'policies', warnings),
      safeQuery<{ tbl: string }>(pat, ref, SQL.rlsTables, 'RLS', warnings),
    ])

  // Agrupa colunas por tabela
  const tables = new Map<string, ColumnRow[]>()
  for (const c of columns) {
    if (!tables.has(c.tbl)) tables.set(c.tbl, [])
    tables.get(c.tbl)!.push(c)
  }

  const tableNames = [...tables.keys()].sort()

  /* ── Cabeçalho ────────────────────────────────────────────────────── */
  out.push(
    '-- ═══════════════════════════════════════════════════════════════════',
    `-- Backup lógico, ${projectName}`,
    `-- Gerado em ${generatedAt} pelo SuperBase Manager`,
    '--',
    '-- COMO RESTAURAR',
    '--   Sempre em um projeto VAZIO. Restaurar por cima de um banco com dados',
    '--   vai falhar nas constraints, e isso é proposital, para não sobrescrever',
    '--   nada por acidente.',
    '--',
    '--   Arquivo pequeno: cole tudo no SQL Editor do Supabase e execute.',
    '--',
    '--   Arquivo grande (alguns MB): o SQL Editor não aguenta de uma vez. Use',
    '--     psql "<connection string>" -f backup.sql',
    '--   ou execute em blocos, separando pelas linhas "-- @@" abaixo. Cada bloco',
    '--   é um comando completo, então cortar ali é sempre seguro.',
    '--',
    '--   A ordem importa: tabelas, constraints, índices, funções, dados,',
    '--   triggers e por fim RLS. Não reordene.',
    '--',
    '-- O QUE ESTE ARQUIVO NÃO CONTÉM',
    '--   · os arquivos dentro dos buckets do Storage (só o inventário, no fim)',
    '--   · código de Edge Functions',
    '--   · roles, grants e schemas fora do public',
    '--   · usuários do Auth (o inventário está no fim; recriar exige a Admin API)',
    '-- ═══════════════════════════════════════════════════════════════════',
    '',
  )
  stmt('set statement_timeout = 0;')
  stmt('set client_min_messages = warning;')

  /* ── Sequences ────────────────────────────────────────────────────────
     Vêm ANTES das tabelas: colunas serial têm default nextval('...') e o
     CREATE TABLE falha se a sequence ainda não existir. Foi assim que um
     projeto real quebrou no teste de restauração.                        */
  if (sequences.length) {
    out.push('-- ─── Sequences ─────────────────────────────────────────────────────', '')
    for (const q of sequences) {
      stmt(
        `create sequence if not exists public.${ident(q.name)}` +
          ` increment by ${q.increment}` +
          ` minvalue ${q.min_value}` +
          ` maxvalue ${q.max_value}` +
          ` start with ${q.start_value}` +
          ` cache ${q.cache}` +
          (q.cycle ? ' cycle' : ' no cycle') +
          ';',
      )
    }
  }

  /* ── Tabelas ──────────────────────────────────────────────────────── */
  out.push('-- ─── Tabelas ───────────────────────────────────────────────────────', '')

  for (const tbl of tableNames) {
    const cols = tables.get(tbl)!
    const lines = cols.map((c) => {
      let line = `  ${ident(c.col)} ${c.typ}`
      if (c.default_expr) line += ` default ${c.default_expr}`
      if (c.notnull) line += ' not null'
      return line
    })

    stmt(`create table if not exists public.${ident(tbl)} (\n${lines.join(',\n')}\n);`)
  }

  /* ── Constraints (depois das tabelas, para FKs resolverem) ────────── */
  const realConstraints = constraints.filter((c) => c.contype !== 'p' || true)
  if (realConstraints.length) {
    out.push('-- ─── Constraints ───────────────────────────────────────────────────', '')
    for (const c of realConstraints) {
      // conrelid::regclass já vem com o schema quando necessário
      const target = c.tbl.includes('.') ? c.tbl : `public.${ident(c.tbl.replace(/"/g, ''))}`
      stmt(`alter table ${target} add constraint ${ident(c.conname)} ${c.def};`)
    }
    out.push('')
  }

  /* ── Índices (o DDL vem pronto do banco; PKs já entraram acima) ───── */
  const extraIndexes = indexes.filter(
    (i) => !constraints.some((c) => c.conname === i.indexname),
  )
  if (extraIndexes.length) {
    out.push('-- ─── Índices ───────────────────────────────────────────────────────', '')
    for (const i of extraIndexes) stmt(`${i.indexdef};`)
  }

  /* ── Funções (antes dos triggers, que dependem delas) ─────────────── */
  if (functions.length) {
    out.push('-- ─── Funções ───────────────────────────────────────────────────────', '')
    for (const f of functions) stmt(f.def.trim().replace(/;?\s*$/, ';'))
  }

  /* ── Views ────────────────────────────────────────────────────────── */
  if (views.length) {
    out.push('-- ─── Views ─────────────────────────────────────────────────────────', '')
    for (const v of views) {
      stmt(
        `create or replace view public.${ident(v.table_name)} as\n${v.view_definition
          .trim()
          .replace(/;?\s*$/, ';')}`,
      )
    }
  }

  /* ── Dados ────────────────────────────────────────────────────────── */
  out.push('-- ─── Dados ─────────────────────────────────────────────────────────', '')

  let totalRows = 0

  for (const tbl of tableNames) {
    let offset = 0
    let tableRows = 0

    for (;;) {
      const rows = await safeQuery<Record<string, unknown>>(
        pat,
        ref,
        `select * from public.${ident(tbl)} limit ${DATA_BATCH} offset ${offset}`,
        `dados de ${tbl}`,
        warnings,
      )

      if (!rows.length) break

      // O Postgres reconstrói os registros a partir do JSON: a conversão de
      // tipo é dele, não nossa. É o que torna isto confiável.
      //
      // O lote é fatiado por TAMANHO, não por contagem: linhas grandes geram
      // fatias pequenas, e nenhum comando estoura o limite de quem for
      // restaurar.
      let slice: Record<string, unknown>[] = []
      let sliceBytes = 0

      const flush = () => {
        if (!slice.length) return
        stmt(
          `insert into public.${ident(tbl)}\n` +
            `select * from json_populate_recordset(null::public.${ident(tbl)}, ${literal(
              JSON.stringify(slice),
            )}::json);`,
        )
        slice = []
        sliceBytes = 0
      }

      for (const row of rows) {
        const size = JSON.stringify(row).length

        if (size > MAX_STATEMENT_BYTES) {
          // Uma linha sozinha maior que o teto: vai sozinha e fica registrado,
          // porque pode não passar em algum caminho de restauração.
          flush()
          stmt(
            `insert into public.${ident(tbl)}\n` +
              `select * from json_populate_recordset(null::public.${ident(tbl)}, ${literal(
                JSON.stringify([row]),
              )}::json);`,
          )
          warnings.push(
            `${tbl}: uma linha tem ${(size / 1024).toFixed(0)} KB sozinha, restaurar pode exigir psql`,
          )
          continue
        }

        if (sliceBytes + size > MAX_STATEMENT_BYTES) flush()

        slice.push(row)
        sliceBytes += size
      }

      flush()

      tableRows += rows.length
      offset += DATA_BATCH

      if (rows.length < DATA_BATCH) break

      if (offset >= MAX_ROWS_PER_TABLE) {
        warnings.push(
          `${tbl}: parou em ${MAX_ROWS_PER_TABLE} linhas (limite de segurança): o backup desta tabela está incompleto`,
        )
        break
      }
    }

    totalRows += tableRows
  }

  /* ── Triggers (depois dos dados, para não dispararem na carga) ────── */
  if (triggers.length) {
    out.push('-- ─── Triggers ──────────────────────────────────────────────────────', '')
    for (const t of triggers) stmt(`${t.def};`)
  }

  /* ── Sequences: reposiciona para não colidir com os dados carregados ─ */
  if (sequences.length) {
    out.push('-- ─── Sequences: vínculo e posição ──────────────────────────────────', '')
    for (const q of sequences) {
      // OWNED BY faz a sequence ser removida junto com a tabela
      if (q.owned_table && q.owned_column) {
        stmt(
          `alter sequence public.${ident(q.name)} owned by public.${ident(
            q.owned_table,
          )}.${ident(q.owned_column)};`,
        )
      }
      // Reposiciona para o próximo id não colidir com os dados carregados
      if (q.last_value != null) {
        stmt(`select setval('public.${ident(q.name)}', ${q.last_value}, true);`)
      }
    }
    out.push('')
  }

  /* ── RLS ──────────────────────────────────────────────────────────── */
  if (rlsTables.length || policies.length) {
    out.push('-- ─── Row Level Security ────────────────────────────────────────────', '')
    for (const t of rlsTables) {
      stmt(`alter table public.${ident(t.tbl)} enable row level security;`)
    }
    for (const p of policies) {
      const parts = [
        `create policy ${ident(p.policyname)} on public.${ident(p.tablename)}`,
        `  as ${p.permissive === 'PERMISSIVE' ? 'permissive' : 'restrictive'}`,
        `  for ${p.cmd.toLowerCase()}`,
        `  to ${p.roles.replace(/[{}]/g, '')}`,
      ]
      if (p.qual) parts.push(`  using (${p.qual})`)
      if (p.with_check) parts.push(`  with check (${p.with_check})`)
      stmt(parts.join('\n') + ';')
    }
  }

  out.push('')

  /* ── Inventário do que ficou de fora ──────────────────────────────── */
  const authUsers = await safeQuery<{ n: number }>(pat, ref, SQL.authUsers, 'auth.users', warnings)
  const storage = await safeQuery<{ bucket: string; objetos: number; bytes: string }>(
    pat, ref, SQL.storageObjects, 'inventário do Storage', warnings,
  )

  out.push(
    '-- ═══════════════════════════════════════════════════════════════════',
    '-- INVENTÁRIO DO QUE NÃO ESTÁ NESTE ARQUIVO',
    '--',
    `-- Usuários no Auth: ${authUsers[0]?.n ?? 0}`,
    '--   Recriá-los exige a Admin API; as senhas nunca saem do Supabase.',
    '--',
    '-- Storage:',
  )

  if (storage.length) {
    for (const b of storage) {
      const mb = (Number(b.bytes) / 1024 / 1024).toFixed(1)
      out.push(`--   bucket "${b.bucket}": ${b.objetos} arquivo(s), ${mb} MB`)
    }
  } else {
    out.push('--   nenhum bucket')
  }

  out.push(
    '--   Os arquivos em si NÃO estão aqui. Se forem críticos, baixe-os à parte.',
    '-- ═══════════════════════════════════════════════════════════════════',
  )

  if (warnings.length) {
    out.push('', '-- AVISOS DURANTE A GERAÇÃO:')
    for (const w of warnings) out.push(`--   ${w}`)
  }

  return {
    sql: out.join('\n'),
    counts: {
      tables: tableNames.length,
      rows: totalRows,
      indexes: extraIndexes.length,
      triggers: triggers.length,
      functions: functions.length,
      policies: policies.length,
      views: views.length,
      sequences: sequences.length,
      authUsers: authUsers[0]?.n ?? 0,
    },
    warnings,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Execução completa: gera, comprime, sobe e registra
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RunBackupResult {
  ok: boolean
  backupId?: string
  path?: string
  sizeBytes?: number
  counts?: BackupCounts
  warnings?: string[]
  error?: string
}

export async function runBackup(
  project: Project,
  source: 'manual' | 'cron',
): Promise<RunBackupResult> {
  const db = systemDb()

  // O PAT é obrigatório: só a Management API alcança o catálogo.
  let pat: string | null = null
  if (project.account_id) {
    const { data: account } = await db
      .from('accounts')
      .select('pat_encrypted, status')
      .eq('id', project.account_id)
      .maybeSingle<{ pat_encrypted: string; status: string }>()

    if (account && account.status !== 'disabled') pat = decryptMaybe(account.pat_encrypted)
  }

  if (!pat || !project.ref) {
    return {
      ok: false,
      error:
        'Backup exige o token da conta, porque precisa ler o catálogo do banco. Conecte a conta deste projeto em Conexões.',
    }
  }

  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
  const path = `${project.id}/${stamp}.sql.gz`

  const { data: record } = await db
    .from('backups')
    .insert({
      project_id: project.id,
      storage_path: path,
      status: 'running',
      trigger_source: source,
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single<{ id: string }>()

  const backupId = record?.id

  async function fail(message: string): Promise<RunBackupResult> {
    if (backupId) {
      await db
        .from('backups')
        .update({ status: 'error', error: message.slice(0, 900), finished_at: new Date().toISOString() })
        .eq('id', backupId)
    }
    return { ok: false, error: message, backupId }
  }

  try {
    const result = await buildBackupSql(
      pat,
      project.ref,
      project.name,
      startedAt.toLocaleString('pt-BR', { timeZone: 'UTC' }) + ' UTC',
    )

    if (result.counts.tables === 0) {
      return fail('Nenhuma tabela encontrada no schema public, nada para salvar.')
    }

    const raw = Buffer.from(result.sql, 'utf8')
    const gz = gzipSync(raw, { level: 9 })

    const { error: uploadError } = await db.storage
      .from('backups')
      .upload(path, gz, { contentType: 'application/gzip', upsert: true })

    if (uploadError) {
      return fail(`Falha ao gravar no Storage: ${uploadError.message}`)
    }

    if (backupId) {
      await db
        .from('backups')
        .update({
          status: 'ok',
          finished_at: new Date().toISOString(),
          size_bytes: gz.byteLength,
          raw_bytes: raw.byteLength,
          table_count: result.counts.tables,
          row_count: result.counts.rows,
          index_count: result.counts.indexes,
          trigger_count: result.counts.triggers,
          function_count: result.counts.functions,
          policy_count: result.counts.policies,
          auth_users: result.counts.authUsers,
          error: result.warnings.length ? result.warnings.join(' | ').slice(0, 900) : null,
        })
        .eq('id', backupId)
    }

    return {
      ok: true,
      backupId,
      path,
      sizeBytes: gz.byteLength,
      counts: result.counts,
      warnings: result.warnings,
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Falha inesperada ao gerar o backup.')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Leitura de um backup já gerado

   O formato dos dados é previsível porque somos nós que o escrevemos:
   cada bloco é um `json_populate_recordset` com o JSON das linhas. Isso
   permite abrir o arquivo e ler o conteúdo sem restaurar nada, que é o
   caminho seguro para investigar "o que tinha aqui antes".
   ═══════════════════════════════════════════════════════════════════════════ */

const DATA_BLOCK = /insert into public\."((?:[^"]|"")+)"\s*\n\s*select \* from json_populate_recordset\(null::public\."(?:[^"]|"")+", '([\s\S]*?)'::json\);/g

export interface BackupTableData {
  table: string
  rows: Record<string, unknown>[]
}

/**
 * Extrai os dados de um dump, tabela a tabela.
 *
 * As aspas simples foram dobradas na geração (padrão SQL), então desfazemos
 * isso antes de interpretar o JSON.
 */
export function parseBackupData(dump: string): BackupTableData[] {
  const byTable = new Map<string, Record<string, unknown>[]>()

  DATA_BLOCK.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = DATA_BLOCK.exec(dump)) !== null) {
    const table = match[1].replace(/""/g, '"')
    const payload = match[2].replace(/''/g, "'")

    let rows: Record<string, unknown>[]
    try {
      rows = JSON.parse(payload)
    } catch {
      continue // bloco corrompido: pula em vez de derrubar a leitura inteira
    }

    if (!byTable.has(table)) byTable.set(table, [])
    byTable.get(table)!.push(...rows)
  }

  return [...byTable.entries()]
    .map(([table, rows]) => ({ table, rows }))
    .sort((a, b) => a.table.localeCompare(b.table, 'pt-BR'))
}

/** Só os nomes de tabela e a contagem, para montar a lista sem carregar tudo. */
export function summarizeBackupData(dump: string): Array<{ table: string; rows: number }> {
  return parseBackupData(dump).map((t) => ({ table: t.table, rows: t.rows.length }))
}
