'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Field'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  Skeleton,
} from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, describeCron, timeAgo, truncate } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import { NoSleepCard } from './NoSleepCard'
import type { ProjectWithMeta } from '@/lib/types'

interface CronJob {
  jobid: number
  jobname: string | null
  schedule: string
  command: string
  active: boolean
  database: string
  last_status: string | null
  last_run: string | null
  last_message: string | null
}

/** Modelos prontos para o que se agenda no dia a dia de um projeto Supabase. */
const PRESETS: Array<{ label: string; schedule: string; command: string; hint: string }> = [
  {
    label: 'Limpar registros antigos',
    schedule: '0 3 * * *',
    command: "delete from logs where created_at < now() - interval '30 days';",
    hint: 'Todo dia às 3h',
  },
  {
    label: 'Atualizar view materializada',
    schedule: '*/30 * * * *',
    command: 'refresh materialized view concurrently minha_view;',
    hint: 'A cada 30 minutos',
  },
  {
    label: 'Rodar VACUUM',
    schedule: '0 4 * * 0',
    command: 'vacuum analyze;',
    hint: 'Domingos às 4h',
  },
]

export function CronTab({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()

  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsPat, setNeedsPat] = useState(false)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<CronJob | null>(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<CronJob | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/projects/${project.id}/cron`)
      const data = await res.json()

      if (!res.ok) {
        setNeedsPat(Boolean(data.needsPat))
        setError(humanizeShort(data.error ?? 'Falha ao listar os agendamentos.'))
        setJobs([])
        return
      }

      setInstalled(data.installed)
      setJobs(data.jobs ?? [])
    } catch {
      setError('Falha de conexão.')
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  async function act(action: string, payload: Record<string, unknown>, successMessage: string) {
    const key = `${action}:${payload.jobName ?? ''}`
    setBusy(key)

    try {
      const res = await fetch(`/api/projects/${project.id}/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error('Falha', humanizeShort(data.error))
        return false
      }

      toast.success(successMessage)
      await load()
      return true
    } catch {
      toast.error('Falha de conexão.')
      return false
    } finally {
      setBusy(null)
    }
  }

  /* ── Sem token da conta ────────────────────────────────────────────── */
  if (needsPat || (!project.has_pat && !loading)) {
    return (
      <Card>
        <EmptyState
          icon={<Clock className="h-5 w-5" />}
          title="Cron Jobs indisponíveis"
          description={`Agendar tarefas exige o token da conta ${
            project.account_email ?? 'de origem'
          }, porque a operação acontece no banco. Conecte essa conta na tela de Conexões para liberar.`}
        />
      </Card>
    )
  }

  if (loading && jobs === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert tone="alert" title="Não foi possível ler os agendamentos">
        {error}
      </Alert>
    )
  }

  /* ── Extensão não instalada ────────────────────────────────────────── */
  if (installed === false) {
    return (
      <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="relative px-6 py-12 text-center">
          <div
            className="hairline-grid absolute inset-0 opacity-30"
            style={{
              maskImage: 'radial-gradient(ellipse at center, black 0%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 0%, transparent 70%)',
            }}
          />

          <div className="relative mx-auto max-w-md">
            <div
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border"
              style={{
                borderColor: 'color-mix(in srgb, var(--signal) 32%, transparent)',
                background: 'color-mix(in srgb, var(--signal) 10%, transparent)',
                color: 'var(--signal)',
              }}
            >
              <Clock className="h-6 w-6" />
            </div>

            <h3 className="font-display text-[19px] font-semibold tracking-[-0.03em]">
              Ative os Cron Jobs neste projeto
            </h3>

            <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
              Agendamentos no Postgres usam a extensão <span className="font-mono">pg_cron</span>.
              Ela ainda não está instalada em{' '}
              <strong className="text-[var(--ink)]">{project.name}</strong>.
            </p>

            <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-3)]">
              Instalar é seguro e reversível: cria o schema <span className="font-mono">cron</span>{' '}
              sem tocar nos seus dados. A partir daí você agenda limpezas, refresh de views e o que
              mais precisar, direto daqui.
            </p>

            <Button
              variant="primary"
              size="lg"
              className="mt-6"
              loading={installing}
              onClick={async () => {
                setInstalling(true)
                await act('install', {}, 'Extensão pg_cron instalada')
                setInstalling(false)
              }}
            >
              <Zap className="h-4 w-4" />
              Instalar pg_cron
            </Button>
          </div>
        </div>
      </Card>

      {/* O No Sleep instala a extensão sozinho, então já aparece aqui */}
      <NoSleepCard project={project} onChanged={load} />
      </div>
    )
  }

  /* ── Lista de agendamentos ─────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <NoSleepCard project={project} onChanged={load} />

      <Card>
        <CardHeader
          icon={<Clock className="h-4 w-4" />}
          title="Agendamentos"
          description={`Tarefas que o Postgres de ${project.name} executa sozinho, no horário definido.`}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={load} loading={loading}>
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'spin')} />
              </Button>
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" />
                Novo agendamento
              </Button>
            </div>
          }
        />

        {jobs && jobs.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-5 w-5" />}
            title="Nenhum agendamento"
            description="Crie o primeiro para o banco executar tarefas sozinho, limpar registros antigos, atualizar views, rodar manutenção."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Criar agendamento
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {(jobs ?? []).map((job) => {
              const name = job.jobname ?? `job_${job.jobid}`
              const failed = job.last_status && job.last_status !== 'succeeded'

              return (
                <div key={job.jobid} className="group px-5 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-[14px] font-semibold tracking-[-0.02em]">
                          {name}
                        </span>

                        {job.active ? (
                          <Badge tone="signal">Ativo</Badge>
                        ) : (
                          <Badge tone="neutral">
                            <Pause className="h-2.5 w-2.5" />
                            Pausado
                          </Badge>
                        )}

                        {job.last_status &&
                          (failed ? (
                            <Badge tone="alert">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Última falhou
                            </Badge>
                          ) : (
                            <Badge tone="signal">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Última OK
                            </Badge>
                          ))}
                      </div>

                      {/* Expressão + tradução em português */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="rounded-md border border-[var(--line)] bg-[var(--void)] px-2 py-1 font-mono text-[11.5px] text-[var(--signal)]">
                          {job.schedule}
                        </code>
                        <span className="text-[12px] text-[var(--ink-2)]">
                          {describeCron(job.schedule)}
                        </span>
                      </div>

                      <pre className="mt-2.5 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--void)] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--ink-2)]">
                        {job.command}
                      </pre>

                      {job.last_run && (
                        <p className="mt-2 text-[11px] text-[var(--ink-4)]">
                          Última execução {timeAgo(job.last_run)}
                          {job.last_message && failed && (
                            <span className="text-[var(--alert)]">
                              {' '}
                              · {truncate(job.last_message, 90)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Executar agora"
                        loading={busy === `run:${name}`}
                        onClick={() =>
                          act('run', { jobName: name, command: job.command }, 'Comando executado')
                        }
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={job.active ? 'Pausar' : 'Ativar'}
                        loading={busy === `toggle:${name}`}
                        onClick={() =>
                          act(
                            'toggle',
                            { jobName: name, active: !job.active },
                            job.active ? 'Agendamento pausado' : 'Agendamento ativado',
                          )
                        }
                      >
                        {job.active ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>

                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Editar"
                        onClick={() => setEditing(job)}
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Excluir"
                        onClick={() => setToDelete(job)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Alert tone="info">
        Os agendamentos rodam no fuso <strong>UTC</strong>, que é o padrão do Postgres. Horário de
        Brasília é UTC−3: para executar às 3h da manhã aqui, agende para as 6h em UTC.
      </Alert>

      <CronModal
        open={creating || Boolean(editing)}
        job={editing}
        projectId={project.id}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          load()
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          const name = toDelete?.jobname ?? `job_${toDelete?.jobid}`
          await act('delete', { jobName: name }, 'Agendamento excluído')
          setToDelete(null)
        }}
        title="Excluir agendamento"
        confirmLabel="Excluir"
        message={
          <>
            O agendamento{' '}
            <strong className="font-mono text-[var(--ink)]">
              {toDelete?.jobname ?? `job_${toDelete?.jobid}`}
            </strong>{' '}
            será removido de <strong className="text-[var(--ink)]">{project.name}</strong> e deixa
            de executar. Os dados que ele já processou não são afetados.
          </>
        }
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Criar / editar agendamento
   ═══════════════════════════════════════════════════════════════════════════ */

function CronModal({
  open,
  job,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean
  job: CronJob | null
  projectId: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()

  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  if (open && !ready) {
    setName(job?.jobname ?? '')
    setSchedule(job?.schedule ?? '0 3 * * *')
    setCommand(job?.command ?? '')
    setReady(true)
    setError(null)
  }

  function handleClose() {
    setReady(false)
    setError(null)
    onClose()
  }

  async function handleSave() {
    if (!name.trim() || !schedule.trim() || !command.trim()) {
      setError('Preencha nome, agendamento e comando.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/projects/${projectId}/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          jobName: name.trim(),
          schedule: schedule.trim(),
          command: command.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao salvar.'))
        return
      }

      toast.success(job ? 'Agendamento atualizado' : 'Agendamento criado')
      setReady(false)
      onSaved()
    } catch {
      setError('Falha de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={job ? 'Editar agendamento' : 'Novo agendamento'}
      description="O comando roda no banco do cliente, no horário definido. Trate como produção."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} loading={loading}>
            {job ? 'Salvar' : 'Criar agendamento'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!job && (
          <div>
            <p className="label mb-2">Começar de um modelo</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setSchedule(preset.schedule)
                    setCommand(preset.command)
                    if (!name.trim()) {
                      setName(
                        preset.label
                          .toLowerCase()
                          .normalize('NFD')
                          .replace(/[̀-ͯ]/g, '')
                          .replace(/[^a-z0-9]+/g, '_'),
                      )
                    }
                  }}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-left transition-colors hover:border-[var(--line-glow)]"
                >
                  <span className="block text-[12px] font-medium text-[var(--ink)]">
                    {preset.label}
                  </span>
                  <span className="mt-1 block text-[11px] text-[var(--ink-4)]">{preset.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <Input
          label="Nome do agendamento"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="limpar_logs_antigos"
          hint={job ? 'Renomear cria um novo agendamento.' : 'Sem espaços, use underscore.'}
          mono
          required
          disabled={Boolean(job)}
        />

        <div>
          <Input
            label="Expressão de agendamento (cron)"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 3 * * *"
            mono
            required
          />
          <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--ink-2)]">
            <Clock className="h-3.5 w-3.5 text-[var(--signal)]" />
            {describeCron(schedule)}{' '}
            <span className="text-[var(--ink-4)]">(UTC)</span>
          </p>
        </div>

        <Textarea
          label="Comando SQL"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="delete from logs where created_at < now() - interval '30 days';"
          rows={4}
          mono
          required
        />

        <Alert tone="warn">
          Este comando será executado automaticamente, sem ninguém olhando. Teste antes no SQL
          Runner para ter certeza de que faz o que você espera.
        </Alert>

        {error && <Alert tone="alert">{error}</Alert>}
      </div>
    </Modal>
  )
}
