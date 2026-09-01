import { NextResponse } from 'next/server'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import { runQuery } from '@/lib/gateway/management'
import { truncate } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron Jobs via extensão pg_cron.
 *
 * Tudo aqui passa pela Management API (exige o PAT da conta), porque agendar
 * tarefa é DDL/execução no banco, o PostgREST não alcança.
 *
 * Segurança: os nomes de job são interpolados em SQL, então TODA string vai
 * por `quoteLiteral`. O comando SQL do job é do próprio usuário e roda como
 * ele quiser: é o mesmo poder do SQL Runner, com a mesma auditoria.
 */

/** Escapa um literal para SQL, no padrão do Postgres (aspas simples dobradas). */
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
            'Cron Jobs exigem o token da conta. Conecte a conta deste projeto em Conexões para habilitar.',
          needsPat: true,
        },
        { status: 422 },
      ),
    }
  }

  return { creds }
}

const LIST_SQL = `
  select
    j.jobid,
    j.jobname,
    j.schedule,
    j.command,
    j.active,
    j.database,
    (
      select r.status
      from cron.job_run_details r
      where r.jobid = j.jobid
      order by r.start_time desc
      limit 1
    ) as last_status,
    (
      select r.start_time
      from cron.job_run_details r
      where r.jobid = j.jobid
      order by r.start_time desc
      limit 1
    ) as last_run,
    (
      select r.return_message
      from cron.job_run_details r
      where r.jobid = j.jobid
      order by r.start_time desc
      limit 1
    ) as last_message
  from cron.job j
  order by j.jobid
`

/** Detecta a ausência da extensão para orientar em vez de só devolver erro. */
function isMissingExtension(message: string): boolean {
  return /schema "cron" does not exist|relation "cron\.job" does not exist|does not exist/i.test(
    message,
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    // A extensão está instalada?
    const check = await runQuery<{ installed: boolean }>(
      creds.pat!,
      creds.project.ref!,
      "select exists(select 1 from pg_extension where extname = 'pg_cron') as installed",
      true,
    )

    if (!check[0]?.installed) {
      return NextResponse.json({ installed: false, jobs: [] })
    }

    const jobs = await runQuery(creds.pat!, creds.project.ref!, LIST_SQL, true)

    return NextResponse.json({ installed: true, jobs })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (isMissingExtension(message)) {
      return NextResponse.json({ installed: false, jobs: [] })
    }
    return errorResponse(err, 'Falha ao listar os agendamentos.')
  }
}

interface CronBody {
  action: 'install' | 'create' | 'toggle' | 'delete' | 'run'
  jobName?: string
  schedule?: string
  command?: string
  active?: boolean
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<CronBody>(request)

  if (!body?.action) {
    return NextResponse.json({ error: 'Ação não informada.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    const pat = creds.pat!
    const ref = creds.project.ref!
    const projectName = creds.project.name

    switch (body.action) {
      /* ── Instalar a extensão ─────────────────────────────────────────── */
      case 'install': {
        await runQuery(pat, ref, 'create extension if not exists pg_cron', false)

        await audit({
          action: 'cron.installed',
          projectId: id,
          detail: `${projectName} · extensão pg_cron instalada`,
          actor: g.session.email,
        })

        return NextResponse.json({ ok: true })
      }

      /* ── Criar ou atualizar um agendamento ───────────────────────────── */
      case 'create': {
        const { jobName, schedule, command } = body

        if (!jobName?.trim() || !schedule?.trim() || !command?.trim()) {
          return NextResponse.json(
            { error: 'Informe nome, expressão de agendamento e comando SQL.' },
            { status: 400 },
          )
        }

        // cron.schedule com nome faz upsert: recria se já existir.
        const sql = `select cron.schedule(${quoteLiteral(jobName.trim())}, ${quoteLiteral(
          schedule.trim(),
        )}, ${quoteLiteral(command.trim())})`

        await runQuery(pat, ref, sql, false)

        await audit({
          action: 'cron.created',
          projectId: id,
          detail: `${projectName} · ${jobName.trim()} (${schedule.trim()}) · ${truncate(
            command.trim().replace(/\s+/g, ' '),
            90,
          )}`,
          actor: g.session.email,
          meta: { jobName: jobName.trim(), schedule: schedule.trim() },
        })

        return NextResponse.json({ ok: true })
      }

      /* ── Ativar / pausar ─────────────────────────────────────────────── */
      case 'toggle': {
        if (!body.jobName?.trim()) {
          return NextResponse.json({ error: 'Informe o agendamento.' }, { status: 400 })
        }

        const active = body.active === true
        const sql = `update cron.job set active = ${active ? 'true' : 'false'} where jobname = ${quoteLiteral(
          body.jobName.trim(),
        )}`

        await runQuery(pat, ref, sql, false)

        await audit({
          action: 'cron.toggled',
          projectId: id,
          detail: `${projectName} · ${body.jobName.trim()} ${active ? 'ativado' : 'pausado'}`,
          actor: g.session.email,
        })

        return NextResponse.json({ ok: true })
      }

      /* ── Excluir ─────────────────────────────────────────────────────── */
      case 'delete': {
        if (!body.jobName?.trim()) {
          return NextResponse.json({ error: 'Informe o agendamento.' }, { status: 400 })
        }

        await runQuery(
          pat,
          ref,
          `select cron.unschedule(${quoteLiteral(body.jobName.trim())})`,
          false,
        )

        await audit({
          action: 'cron.deleted',
          projectId: id,
          detail: `${projectName} · ${body.jobName.trim()}`,
          actor: g.session.email,
        })

        return NextResponse.json({ ok: true })
      }

      /* ── Executar agora (roda o comando fora do agendamento) ─────────── */
      case 'run': {
        if (!body.command?.trim()) {
          return NextResponse.json({ error: 'Comando não informado.' }, { status: 400 })
        }

        const startedAt = Date.now()
        await runQuery(pat, ref, body.command.trim(), false)

        await audit({
          action: 'cron.ran_now',
          projectId: id,
          detail: `${projectName} · ${body.jobName ?? 'comando avulso'}`,
          actor: g.session.email,
          meta: { durationMs: Date.now() - startedAt },
        })

        return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt })
      }

      default:
        return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 })
    }
  } catch (err) {
    return errorResponse(err, 'Falha ao operar os agendamentos.')
  }
}
