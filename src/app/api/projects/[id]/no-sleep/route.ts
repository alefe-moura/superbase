import { NextResponse } from 'next/server'
import { errorResponse, guard } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import { runQuery } from '@/lib/gateway/management'
import { invalidateSchema } from '@/lib/gateway/schema-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * "No Sleep", impede que o projeto seja pausado por inatividade.
 *
 * O plano gratuito da Supabase pausa projetos após 7 dias sem atividade.
 * Este módulo cria uma tabela mínima e agenda uma escrita diária nela, de
 * modo que o banco nunca fique uma semana parado.
 *
 * Três decisões que se afastam do roteiro manual mais comum:
 *
 * 1. A tabela tem CHECK (id = 1), garantindo UMA linha para sempre, não
 *    depende de o UPDATE ser escrito corretamente para não acumular lixo.
 *
 * 2. O UPDATE **define** um valor aleatório em vez de somar ao anterior.
 *    Somar até 1e15 por dia estoura o bigint em ~25 anos e aí o job passa
 *    a falhar em silêncio. Definir nunca estoura, e cumpre o mesmo papel:
 *    o que mantém o projeto ativo é a escrita acontecer, não o valor.
 *
 * 3. Há uma coluna `atualizado_em`, para dar como conferir se o agendamento
 *    está mesmo rodando, sem ela, a única forma seria comparar números.
 *
 * RLS fica habilitado e sem policies: a tabela existe só para gerar escrita,
 * ninguém precisa lê-la pela API.
 *
 * Por que não confiar apenas no coletor de monitoramento: ele também toca
 * cada projeto (métricas + SQL de estatísticas), mas só quando alguém abre o
 * painel ou quando o agendamento diário da Vercel dispara, e só enquanto o
 * app estiver publicado. O No Sleep vive dentro do projeto do cliente e
 * sobrevive à queda de qualquer um desses.
 */

const JOB_NAME = 'no_sleep'
const SCHEDULE = '0 0 * * *' // meia-noite UTC
const UPDATE_SQL =
  'update public.no_sleep set numero = floor(random() * 1000000000000000)::bigint, atualizado_em = now() where id = 1'

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function credentials(id: string) {
  const creds = await getProjectCredentials(id)

  if (!creds) {
    return { error: NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 }) }
  }

  if (!creds.pat || !creds.project.ref) {
    return {
      error: NextResponse.json(
        {
          error:
            'O No Sleep exige o token da conta, porque precisa criar tabela e agendar tarefa. Conecte a conta deste projeto em Conexões.',
          needsPat: true,
        },
        { status: 422 },
      ),
    }
  }

  return { creds }
}

/** Estado atual: tabela criada? agendamento ativo? quando rodou pela última vez? */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const pat = creds.pat!
    const ref = creds.project.ref!

    const base = await runQuery<{ tabela: boolean; cron: boolean }>(
      pat,
      ref,
      `select
         to_regclass('public.no_sleep') is not null as tabela,
         exists(select 1 from pg_extension where extname = 'pg_cron') as cron`,
      true,
    )

    const tableExists = Boolean(base[0]?.tabela)
    const cronInstalled = Boolean(base[0]?.cron)

    let job: { schedule: string; active: boolean } | null = null
    if (cronInstalled) {
      const jobs = await runQuery<{ schedule: string; active: boolean }>(
        pat,
        ref,
        `select schedule, active from cron.job where jobname = ${quoteLiteral(JOB_NAME)}`,
        true,
      )
      job = jobs[0] ?? null
    }

    let row: { numero: string | number; atualizado_em: string } | null = null
    if (tableExists) {
      const rows = await runQuery<{ numero: string | number; atualizado_em: string }>(
        pat,
        ref,
        'select numero, atualizado_em from public.no_sleep where id = 1',
        true,
      )
      row = rows[0] ?? null
    }

    return NextResponse.json({
      installed: tableExists && Boolean(job),
      tableExists,
      cronInstalled,
      job,
      row,
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao verificar o No Sleep.')
  }
}

/** Instala tudo: extensão, tabela, linha inicial e agendamento. Idempotente. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const pat = creds.pat!
    const ref = creds.project.ref!
    const steps: string[] = []

    // 1. Extensão de agendamento
    await runQuery(pat, ref, 'create extension if not exists pg_cron', false)
    steps.push('extensão pg_cron')

    // 2. Tabela, o CHECK garante uma única linha para sempre
    await runQuery(
      pat,
      ref,
      `create table if not exists public.no_sleep (
         id            smallint primary key default 1,
         numero        bigint not null default 1,
         atualizado_em timestamptz not null default now(),
         constraint no_sleep_linha_unica check (id = 1)
       )`,
      false,
    )
    steps.push('tabela no_sleep')

    // 3. Fecha para leitura externa: existe só para gerar escrita
    await runQuery(pat, ref, 'alter table public.no_sleep enable row level security', false)

    // 4. Linha inicial (não duplica se já existir)
    await runQuery(
      pat,
      ref,
      'insert into public.no_sleep (id, numero) values (1, 1) on conflict (id) do nothing',
      false,
    )
    steps.push('linha inicial')

    // 5. Agendamento, cron.schedule com nome faz upsert
    await runQuery(
      pat,
      ref,
      `select cron.schedule(${quoteLiteral(JOB_NAME)}, ${quoteLiteral(SCHEDULE)}, ${quoteLiteral(UPDATE_SQL)})`,
      false,
    )
    steps.push('agendamento diário')

    // 6. Roda uma vez agora, para já contar como atividade e provar que funciona
    await runQuery(pat, ref, UPDATE_SQL, false)
    steps.push('primeira execução')

    invalidateSchema(id)

    await audit({
      action: 'cron.no_sleep_installed',
      projectId: id,
      detail: `${creds.project.name} · ${steps.join(', ')}`,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true, steps })
  } catch (err) {
    return errorResponse(err, 'Falha ao instalar o No Sleep.')
  }
}

/** Remove o agendamento. A tabela fica, apagá-la é decisão separada. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const dropTable = new URL(request.url).searchParams.get('dropTable') === '1'

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const pat = creds.pat!
    const ref = creds.project.ref!

    await runQuery(pat, ref, `select cron.unschedule(${quoteLiteral(JOB_NAME)})`, false)

    if (dropTable) {
      await runQuery(pat, ref, 'drop table if exists public.no_sleep', false)
      invalidateSchema(id)
    }

    await audit({
      action: 'cron.no_sleep_removed',
      projectId: id,
      detail: `${creds.project.name}${dropTable ? ' · tabela removida' : ' · tabela mantida'}`,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao remover o No Sleep.')
  }
}
