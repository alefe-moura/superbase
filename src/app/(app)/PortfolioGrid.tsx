'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  Cpu,
  Database,
  HardDrive,
  LayoutGrid,
  List,
  MemoryStick,
} from 'lucide-react'
import { Badge, Card, HealthDot, SignalBars, meterColor } from '@/components/ui/Primitives'
import { SearchField, Select } from '@/components/ui/Field'
import { cn, clientColor, formatBytes, formatPct, statusLabel, timeAgo } from '@/lib/utils'
import type { Client, Health, ProjectWithMeta } from '@/lib/types'

type View = 'grid' | 'list'

export function PortfolioGrid({
  projects,
  clients,
}: {
  projects: ProjectWithMeta[]
  clients: Client[]
}) {
  const [query, setQuery] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState('')
  const [grouped, setGrouped] = useState(false)
  const [view, setView] = useState<View>('grid')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return projects.filter((p) => {
      if (clientFilter && p.client_id !== clientFilter) return false
      if (healthFilter && (p.latest_snapshot?.overall_health ?? 'unknown') !== healthFilter)
        return false
      if (!needle) return true

      return [p.name, p.ref, p.account_email, p.client?.name, p.notes]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle))
    })
  }, [projects, query, clientFilter, healthFilter])

  const groups = useMemo(() => {
    if (!grouped) return null

    const map = new Map<string, { name: string; color: string | null; items: ProjectWithMeta[] }>()

    for (const project of filtered) {
      const key = project.client_id ?? '\0sem-cliente'
      if (!map.has(key)) {
        map.set(key, {
          name: project.client?.name ?? 'Sem cliente',
          color: project.client?.color ?? null,
          items: [],
        })
      }
      map.get(key)!.items.push(project)
    }

    return Array.from(map.entries()).sort(([ka, a], [kb, b]) =>
      ka.startsWith('\0') ? 1 : kb.startsWith('\0') ? -1 : a.name.localeCompare(b.name, 'pt-BR'),
    )
  }, [filtered, grouped])

  return (
    <div className="space-y-5">
      {/* ─── Filtros ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar projeto, cliente, ref ou conta…"
          className="min-w-[15rem] flex-1"
        />

        <div className="w-[9.5rem]">
          <Select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">Todos os clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[8.5rem]">
          <Select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
            <option value="">Toda saúde</option>
            <option value="healthy">Saudável</option>
            <option value="degraded">Degradado</option>
            <option value="down">Fora do ar</option>
            <option value="unknown">Sem dados</option>
          </Select>
        </div>

        <button
          type="button"
          onClick={() => setGrouped((g) => !g)}
          className={cn(
            'h-9.5 rounded-lg border px-3 text-[12.5px] transition-colors',
            grouped
              ? 'border-[color-mix(in_srgb,var(--signal)_45%,transparent)] bg-[color-mix(in_srgb,var(--signal)_10%,transparent)] text-[var(--signal)]'
              : 'border-[var(--line-strong)] text-[var(--ink-2)] hover:border-[var(--line-glow)] hover:text-[var(--ink)]',
          )}
        >
          Por cliente
        </button>

        <div className="flex h-9.5 items-center gap-0.5 rounded-lg border border-[var(--line-strong)] p-1">
          {(
            [
              ['grid', LayoutGrid, 'Grade'],
              ['list', List, 'Lista'],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              title={label}
              aria-label={label}
              className={cn(
                'rounded-md p-1.5 transition-colors',
                view === mode
                  ? 'bg-[var(--surface-3)] text-[var(--ink)]'
                  : 'text-[var(--ink-4)] hover:text-[var(--ink-2)]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* ─── Resultado ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <Card className="px-6 py-14 text-center">
          <p className="text-[13px] text-[var(--ink-3)]">Nenhum projeto corresponde aos filtros.</p>
        </Card>
      ) : groups ? (
        <div className="space-y-8">
          {groups.map(([key, group]) => (
            <section key={key}>
              <header className="mb-3 flex items-center gap-2.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: clientColor(group.name, group.color) }}
                />
                <h2 className="font-display text-[14px] font-semibold tracking-[-0.02em]">
                  {group.name}
                </h2>
                <span className="label">
                  {group.items.length} {group.items.length === 1 ? 'projeto' : 'projetos'}
                </span>
                <span className="ml-1 h-px flex-1 bg-[var(--line)]" />
              </header>

              {view === 'grid' ? (
                <ProjectCards projects={group.items} />
              ) : (
                <ProjectTable projects={group.items} />
              )}
            </section>
          ))}
        </div>
      ) : view === 'grid' ? (
        <ProjectCards projects={filtered} />
      ) : (
        <ProjectTable projects={filtered} />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cartões
   ═══════════════════════════════════════════════════════════════════════════ */

function ProjectCards({ projects }: { projects: ProjectWithMeta[] }) {
  return (
    <div className="grid gap-4 stagger sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectWithMeta }) {
  const snap = project.latest_snapshot
  const health: Health = snap?.overall_health ?? 'unknown'
  const paused = /paus|inactive/i.test(project.status ?? '')

  return (
    <Link
      href={`/projetos/${project.id}`}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl p-5',
        'border border-[var(--line)] bg-[var(--surface)]',
        'transition-all duration-200',
        'hover:border-[var(--line-glow)] hover:shadow-[0_16px_50px_-22px_rgba(0,0,0,0.9)]',
      )}
    >
      {/* Fio de luz no topo, na cor da saúde */}
      <span
        className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `linear-gradient(90deg, transparent, ${
            health === 'healthy'
              ? 'var(--signal)'
              : health === 'degraded'
                ? 'var(--warn)'
                : health === 'down'
                  ? 'var(--alert)'
                  : 'var(--line-glow)'
          }, transparent)`,
        }}
      />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <HealthDot health={health} />
            <h3
              className="truncate font-display text-[15px] font-semibold tracking-[-0.025em]"
              title={project.name}
            >
              {project.name}
            </h3>
          </div>

          {project.client ? (
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: clientColor(project.client.name, project.client.color) }}
              />
              <span className="truncate text-[12px] text-[var(--ink-2)]">
                {project.client.name}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-[var(--ink-4)]">Sem cliente</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <ArrowUpRight className="h-4 w-4 text-[var(--ink-4)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--signal)]" />
          {paused && <Badge tone="warn">Pausado</Badge>}
        </div>
      </div>

      {/* Telemetria */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MiniMetric icon={<Cpu className="h-3 w-3" />} label="CPU" value={snap?.cpu_pct} />
        <MiniMetric icon={<MemoryStick className="h-3 w-3" />} label="RAM" value={snap?.ram_pct} />
        <MiniMetric
          icon={<HardDrive className="h-3 w-3" />}
          label="Disco"
          value={snap?.disk_pct}
          warnAt={80}
        />
      </div>

      {/* Rodapé */}
      <div className="mt-auto flex items-center gap-2 border-t border-[var(--line)] pt-3.5 text-[11px] text-[var(--ink-4)]">
        {snap?.db_size_bytes != null && (
          <span className="flex items-center gap-1 font-mono tabular-nums">
            <Database className="h-3 w-3" />
            {formatBytes(snap.db_size_bytes)}
          </span>
        )}

        <span className="ml-auto shrink-0 whitespace-nowrap">{timeAgo(snap?.collected_at)}</span>
      </div>
    </Link>
  )
}

function MiniMetric({
  icon,
  label,
  value,
  warnAt = 75,
}: {
  icon: React.ReactNode
  label: string
  value: number | null | undefined
  warnAt?: number
}) {
  const has = value !== null && value !== undefined && Number.isFinite(value)
  const pct = has ? Math.max(0, Math.min(100, value)) : 0
  const color = meterColor(value, warnAt)

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink-4)]">
        {icon}
        {label}
      </div>

      <div
        className="mb-1.5 font-mono text-[15px] font-semibold leading-none tabular-nums"
        style={{ color }}
      >
        {has ? pct.toFixed(0) : '·'}
        {has && <span className="text-[0.6em] opacity-60">%</span>}
      </div>

      <div className="h-[3px] overflow-hidden rounded-full bg-[var(--void)]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: color, boxShadow: has ? `0 0 6px ${color}` : undefined }}
        />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tabela
   ═══════════════════════════════════════════════════════════════════════════ */

function ProjectTable({ projects }: { projects: ProjectWithMeta[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line)]">
              {['Projeto', 'Cliente', 'Sinal', 'CPU', 'RAM', 'Disco', 'Banco', 'Conta'].map(
                (head, i) => (
                  <th
                    key={head}
                    className={cn('label px-4 py-3 font-medium', i >= 3 && i <= 6 && 'text-right')}
                  >
                    {head}
                  </th>
                ),
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--line)]">
            {projects.map((project) => {
              const snap = project.latest_snapshot
              return (
                <tr
                  key={project.id}
                  className="group transition-colors hover:bg-[var(--surface-2)]"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/projetos/${project.id}`}
                      className="flex items-center gap-2 font-medium transition-colors group-hover:text-[var(--signal)]"
                    >
                      <HealthDot health={snap?.overall_health ?? 'unknown'} size={6} />
                      <span className="truncate">{project.name}</span>
                    </Link>
                  </td>

                  <td className="px-4 py-2.5 text-[12px] text-[var(--ink-2)]">
                    {project.client?.name ?? '·'}
                  </td>

                  <td className="px-4 py-2.5">
                    <SignalBars health={snap?.overall_health ?? 'unknown'} />
                  </td>

                  <MetricCell value={snap?.cpu_pct} />
                  <MetricCell value={snap?.ram_pct} />
                  <MetricCell value={snap?.disk_pct} warnAt={80} />

                  <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--ink-2)]">
                    {formatBytes(snap?.db_size_bytes)}
                  </td>

                  <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--ink-4)]">
                    {project.account_email ?? '·'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function MetricCell({ value, warnAt = 75 }: { value: number | null | undefined; warnAt?: number }) {
  return (
    <td className="px-4 py-2.5 text-right">
      <span
        className="font-mono text-[12px] font-medium tabular-nums"
        style={{ color: meterColor(value, warnAt) }}
      >
        {formatPct(value)}
      </span>
    </td>
  )
}
