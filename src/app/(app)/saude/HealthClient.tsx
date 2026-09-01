'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Activity, AlertTriangle, Cpu, HardDrive, MemoryStick, RefreshCw } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Button } from '@/components/ui/Button'
import {
  Alert,
  Card,
  EmptyState,
  HealthDot,
  SignalBars,
  meterColor,
} from '@/components/ui/Primitives'
import { useToast } from '@/components/ui/Toast'
import { cn, formatBytes, formatNumber, formatPct, timeAgo } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { Health, ProjectWithMeta } from '@/lib/types'

const SUMMARY: Array<{ key: Health; label: string }> = [
  { key: 'healthy', label: 'Saudáveis' },
  { key: 'degraded', label: 'Degradados' },
  { key: 'down', label: 'Fora do ar' },
  { key: 'unknown', label: 'Sem dados' },
]

/** Acima disso, os dados na tela já não valem muito, vale recoletar. */
const STALE_MINUTES = 30

export function HealthClient({ projects }: { projects: ProjectWithMeta[] }) {
  const router = useRouter()
  const toast = useToast()
  const [collecting, setCollecting] = useState(false)
  const [autoRan, setAutoRan] = useState(false)
  const autoGuard = useRef(false)

  /** Coleta mais recente da carteira inteira. */
  const newestAt = projects.reduce<number | null>((newest, p) => {
    const at = p.latest_snapshot?.collected_at
    if (!at) return newest
    const time = new Date(at).getTime()
    return newest === null || time > newest ? time : newest
  }, null)

  const staleMinutes =
    newestAt === null ? null : Math.floor((Date.now() - newestAt) / 60000)

  const isStale = projects.length > 0 && (newestAt === null || (staleMinutes ?? 0) >= STALE_MINUTES)

  const tally = projects.reduce<Record<Health, number>>(
    (acc, p) => {
      const h = p.latest_snapshot?.overall_health ?? 'unknown'
      acc[h] = (acc[h] ?? 0) + 1
      return acc
    },
    { healthy: 0, degraded: 0, down: 0, unknown: 0 },
  )

  const attention = projects.filter((p) => {
    const s = p.latest_snapshot
    if (!s) return false
    return (
      s.overall_health === 'down' ||
      s.overall_health === 'degraded' ||
      (s.disk_pct ?? 0) >= 85 ||
      (s.ram_pct ?? 0) >= 90 ||
      (s.cpu_pct ?? 0) >= 90
    )
  })

  const collectAll = useCallback(
    async (silent = false) => {
      setCollecting(true)
      try {
        const res = await fetch('/api/cron/snapshot', { method: 'POST' })
        const data = await res.json()

        if (!res.ok) {
          if (!silent) toast.error('Falha na coleta', humanizeShort(data.error))
          return
        }

        if (!silent) {
          toast.success(
            `${data.collected} ${data.collected === 1 ? 'projeto coletado' : 'projetos coletados'}`,
            data.failed
              ? `${data.failed} com problema.`
              : `Concluído em ${(data.durationMs / 1000).toFixed(1)}s.`,
          )
        }

        router.refresh()
      } catch {
        if (!silent) toast.error('Falha de conexão durante a coleta.')
      } finally {
        setCollecting(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  )

  /**
   * Dados velhos ao abrir a tela: recoleta sozinho, uma vez.
   *
   * Assim o painel fica correto sem depender de cron, o que importa quando
   * o plano Hobby da Vercel só dispara agendamento uma vez por dia.
   */
  useEffect(() => {
    if (!isStale || autoGuard.current) return
    autoGuard.current = true
    setAutoRan(true)
    collectAll(true)
  }, [isStale, collectAll])

  return (
    <>
      <PageHeader
        title="Saúde geral"
        description="Todos os projetos lado a lado, a visão que o painel oficial da Supabase não dá, porque lá cada projeto vive isolado."
        meta={
          projects.length > 0 && (
            <p className="text-[12px] text-[var(--ink-3)]">
              {collecting && autoRan ? (
                <span className="text-[var(--signal)]">Atualizando os dados…</span>
              ) : staleMinutes === null ? (
                'Nenhuma coleta ainda.'
              ) : (
                <>
                  Dados de{' '}
                  <span className="font-mono tabular-nums text-[var(--ink-2)]">
                    {staleMinutes < 1 ? 'agora mesmo' : timeAgo(new Date(newestAt!).toISOString())}
                  </span>
                  . A tela se atualiza sozinha quando você abre e os dados estão velhos.
                </>
              )}
            </p>
          )
        }
        action={
          <Button variant="primary" onClick={() => collectAll()} loading={collecting}>
            <RefreshCw className={cn('h-4 w-4', collecting && 'spin')} />
            Coletar tudo agora
          </Button>
        }
      />

      <PageBody>
        {projects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="Nenhum projeto para monitorar"
              description="Conecte projetos na tela de Conexões para acompanhar a saúde deles aqui."
            />
          </Card>
        ) : (
          <div className="space-y-5 stagger">
            {/* ─── Resumo ────────────────────────────────────────────── */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {SUMMARY.map(({ key, label }) => (
                <SummaryTile key={key} health={key} count={tally[key]} label={label} />
              ))}
            </div>

            {/* ─── Atenção ───────────────────────────────────────────── */}
            {attention.length > 0 && (
              <Alert
                tone="warn"
                title={`${attention.length} ${attention.length === 1 ? 'projeto pede' : 'projetos pedem'} atenção`}
              >
                <div className="mt-2 flex flex-wrap gap-2">
                  {attention.map((p) => (
                    <Link
                      key={p.id}
                      href={`/projetos/${p.id}`}
                      className="rounded-md border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2 py-1 text-[11.5px] font-medium text-[var(--warn)] transition-opacity hover:opacity-75"
                    >
                      {p.name}
                    </Link>
                  ))}
                </div>
              </Alert>
            )}

            {/* ─── Tabela comparativa ────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      <th className="label px-4 py-3">Projeto</th>
                      <th className="label px-4 py-3">Sinal</th>
                      <th className="label px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <Cpu className="h-3 w-3" />
                          CPU
                        </span>
                      </th>
                      <th className="label px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <MemoryStick className="h-3 w-3" />
                          RAM
                        </span>
                      </th>
                      <th className="label px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          Disco
                        </span>
                      </th>
                      <th className="label px-4 py-3 text-right">Banco</th>
                      <th className="label px-4 py-3 text-right">Conexões</th>
                      <th className="label px-4 py-3">Coleta</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[var(--line)]">
                    {projects.map((p) => {
                      const s = p.latest_snapshot
                      return (
                        <tr key={p.id} className="group transition-colors hover:bg-[var(--surface-2)]">
                          <td className="px-4 py-3">
                            <Link
                              href={`/projetos/${p.id}`}
                              className="flex items-center gap-2 font-medium transition-colors group-hover:text-[var(--signal)]"
                            >
                              <HealthDot health={s?.overall_health ?? 'unknown'} size={6} />
                              {p.name}
                            </Link>
                            {p.client && (
                              <span className="ml-[18px] block text-[11px] text-[var(--ink-4)]">
                                {p.client.name}
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <SignalBars health={s?.overall_health ?? 'unknown'} />
                          </td>

                          <MetricCell value={s?.cpu_pct} />
                          <MetricCell value={s?.ram_pct} />
                          <MetricCell value={s?.disk_pct} warnAt={80} />

                          <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-[var(--ink-2)]">
                            {formatBytes(s?.db_size_bytes)}
                          </td>

                          <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-[var(--ink-2)]">
                            {s?.active_connections != null
                              ? `${formatNumber(s.active_connections)}${s.max_connections ? `/${s.max_connections}` : ''}`
                              : '·'}
                          </td>

                          <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-[var(--ink-4)]">
                            {timeAgo(s?.collected_at)}
                            {s?.error && (
                              <AlertTriangle
                                className="ml-1.5 inline h-3 w-3 text-[var(--warn)]"
                                aria-label="Coleta com avisos"
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <p className="text-center text-[11.5px] leading-relaxed text-[var(--ink-4)]">
              Os dados se atualizam sozinhos ao abrir esta tela, e uma vez por dia pelo agendamento
              da Vercel. Para manter os projetos acordados, use o No Sleep na aba Cron Jobs de cada
              projeto, ele roda dentro do Supabase e não depende deste sistema.
            </p>
          </div>
        )}
      </PageBody>
    </>
  )
}

function SummaryTile({
  health,
  count,
  label,
}: {
  health: Health
  count: number
  label: string
}) {
  const active = count > 0
  const color =
    health === 'healthy'
      ? 'var(--signal)'
      : health === 'degraded'
        ? 'var(--warn)'
        : health === 'down'
          ? 'var(--alert)'
          : 'var(--ink-4)'

  return (
    <Card
      className={cn('relative overflow-hidden p-5 transition-opacity', !active && 'opacity-55')}
    >
      {active && (
        <span
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
        />
      )}

      <div className="flex items-center justify-between">
        <p className="font-display text-[32px] font-bold leading-none tracking-[-0.05em] tabular-nums" style={{ color: active ? color : 'var(--ink-4)' }}>
          {count}
        </p>
        <HealthDot health={health} size={9} />
      </div>

      <p className="label mt-3">{label}</p>
    </Card>
  )
}

function MetricCell({ value, warnAt = 75 }: { value: number | null | undefined; warnAt?: number }) {
  return (
    <td className="px-4 py-3 text-right">
      <span
        className="font-mono text-[12.5px] font-medium tabular-nums"
        style={{ color: meterColor(value, warnAt) }}
      >
        {formatPct(value)}
      </span>
    </td>
  )
}
