'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, MoonStar, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert, Badge, Card, Skeleton } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatNumber, timeAgo } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { ProjectWithMeta } from '@/lib/types'

interface Status {
  installed: boolean
  tableExists: boolean
  cronInstalled: boolean
  job: { schedule: string; active: boolean } | null
  row: { numero: string | number; atualizado_em: string } | null
}

/**
 * No Sleep, evita que o projeto seja pausado por inatividade.
 *
 * O convite some depois de instalado, dando lugar ao estado: quando rodou
 * pela última vez e qual o valor atual. Sem isso não haveria como saber se
 * o agendamento continua funcionando.
 */
export function NoSleepCard({
  project,
  onChanged,
}: {
  project: ProjectWithMeta
  onChanged?: () => void
}) {
  const toast = useToast()

  const [status, setStatus] = useState<Status | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/no-sleep`)
      const data = await res.json()

      if (!res.ok) {
        setUnavailable(true)
        return
      }

      setUnavailable(false)
      setStatus(data)
    } catch {
      setUnavailable(true)
    }
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  async function install() {
    setInstalling(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/no-sleep`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error('Não foi possível instalar', humanizeShort(data.error))
        return
      }

      toast.success('No Sleep instalado', 'O projeto não será mais pausado por inatividade.')
      await load()
      onChanged?.()
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setInstalling(false)
    }
  }

  async function remove(dropTable: boolean) {
    setRemoving(true)
    try {
      const res = await fetch(
        `/api/projects/${project.id}/no-sleep${dropTable ? '?dropTable=1' : ''}`,
        { method: 'DELETE' },
      )
      const data = await res.json()

      if (!res.ok) {
        toast.error('Não foi possível remover', humanizeShort(data.error))
        return
      }

      toast.success('No Sleep removido', 'O projeto volta a poder ser pausado após 7 dias parado.')
      setConfirmRemove(false)
      await load()
      onChanged?.()
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setRemoving(false)
    }
  }

  // Sem token da conta: o card não faz sentido, a aba já explica o motivo.
  if (unavailable) return null

  if (!status) return <Skeleton className="h-28 w-full" />

  /* ─── Já instalado: vira painel de estado ───────────────────────────── */
  if (status.installed) {
    return (
      <>
        <Card className="relative overflow-hidden p-5">
          <span
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, var(--signal), transparent)',
            }}
          />

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3.5">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: 'color-mix(in srgb, var(--signal) 12%, transparent)',
                  color: 'var(--signal)',
                }}
              >
                <MoonStar className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-[15px] font-semibold tracking-[-0.02em]">
                    No Sleep
                  </h3>
                  <Badge tone="signal">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Ativo
                  </Badge>
                  {status.job && !status.job.active && <Badge tone="warn">Pausado</Badge>}
                </div>

                <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
                  Este projeto grava na tabela{' '}
                  <code className="font-mono text-[11.5px] text-[var(--ink)]">no_sleep</code> todo
                  dia à meia-noite (UTC), então nunca completa 7 dias parado.
                </p>

                {status.row && (
                  <p className="mt-2 font-mono text-[11px] text-[var(--ink-4)]">
                    última escrita {timeAgo(status.row.atualizado_em)} · valor{' '}
                    {formatNumber(Number(status.row.numero))}
                  </p>
                )}
              </div>
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmRemove(true)}
              className="shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remover
            </Button>
          </div>
        </Card>

        <ConfirmDialog
          open={confirmRemove}
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => remove(false)}
          loading={removing}
          title="Remover No Sleep"
          confirmLabel="Remover agendamento"
          message={
            <>
              O agendamento diário será removido de{' '}
              <strong className="text-[var(--ink)]">{project.name}</strong>, e o projeto volta a
              poder ser pausado depois de 7 dias sem atividade.
              <br />
              <br />
              A tabela <code className="font-mono text-[var(--ink)]">no_sleep</code> é mantida, ela
              não atrapalha e guarda o histórico. Para apagá-la também, use o SQL Runner com{' '}
              <code className="font-mono text-[11px] text-[var(--ink)]">drop table no_sleep</code>.
            </>
          }
        />
      </>
    )
  }

  /* ─── Não instalado: o convite ──────────────────────────────────────── */
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--ink-3)]">
            <MoonStar className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <h3 className="font-display text-[15px] font-semibold tracking-[-0.02em]">
              Impedir que o projeto durma
            </h3>

            <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-[var(--ink-2)]">
              A Supabase pausa projetos do plano gratuito após 7 dias sem atividade. Um clique aqui
              cria uma tabela mínima e agenda uma escrita diária nela, o suficiente para o projeto
              nunca ficar parado tempo demais.
            </p>

            {status.tableExists && !status.job && (
              <p className="mt-2 text-[11.5px] text-[var(--warn)]">
                A tabela <span className="font-mono">no_sleep</span> já existe, mas não há
                agendamento ativo. Instalar recria o agendamento sem duplicar a tabela.
              </p>
            )}
          </div>
        </div>

        <Button variant="primary" onClick={install} loading={installing} className="shrink-0">
          <Zap className="h-4 w-4" />
          Instalar No Sleep
        </Button>
      </div>

      <Alert tone="info" className="mt-4">
        Cria a tabela <code className="font-mono text-[11px]">no_sleep</code> com uma única linha
        (garantida por constraint), habilita RLS nela e agenda um <span className="font-mono">
          UPDATE
        </span>{' '}
        diário. Não toca em nenhum dado existente do projeto.
      </Alert>
    </Card>
  )
}
