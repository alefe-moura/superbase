'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ScrollText, ShieldAlert } from 'lucide-react'
import { SearchField, Select } from '@/components/ui/Field'
import { Badge, Card, EmptyState } from '@/components/ui/Primitives'
import { AUDIT_LABELS, DESTRUCTIVE_ACTIONS } from '@/lib/audit-labels'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import type { AuditLog, Project } from '@/lib/types'

export function AuditClient({
  logs,
  projects,
}: {
  logs: AuditLog[]
  projects: Array<Pick<Project, 'id' | 'name'>>
}) {
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return logs.filter((log) => {
      if (projectFilter && log.project_id !== projectFilter) return false
      if (actionFilter && log.action !== actionFilter) return false
      if (!needle) return true

      return [log.detail, log.action, AUDIT_LABELS[log.action], log.actor]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle))
    })
  }, [logs, query, projectFilter, actionFilter])

  const destructiveCount = filtered.filter((l) => DESTRUCTIVE_ACTIONS.has(l.action)).length

  return (
    <div className="space-y-5">
      {/* ─── Filtros ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar na auditoria…"
          className="min-w-[15rem] flex-1"
        />

        <div className="w-[11rem]">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Todos os projetos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[12rem]">
          <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">Todas as ações</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {AUDIT_LABELS[action] ?? action}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="text-[11.5px] text-[var(--ink-4)]">
          <span className="font-mono tabular-nums text-[var(--ink-2)]">{filtered.length}</span>{' '}
          {filtered.length === 1 ? 'registro' : 'registros'}
          {destructiveCount > 0 && (
            <>
              {' · '}
              <span className="font-mono tabular-nums text-[var(--warn)]">
                {destructiveCount}
              </span>{' '}
              {destructiveCount === 1 ? 'sensível' : 'sensíveis'}
            </>
          )}
        </p>
      )}

      {/* ─── Linha do tempo ────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title={logs.length ? 'Nenhum registro corresponde aos filtros' : 'Auditoria vazia'}
            description={
              logs.length
                ? 'Ajuste a busca ou os filtros acima.'
                : 'Toda ação sensível que você fizer (revelar chave, editar linha, rodar SQL, excluir usuário) aparece aqui automaticamente.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-[var(--line)]">
            {filtered.map((log) => {
              const destructive = DESTRUCTIVE_ACTIONS.has(log.action)

              return (
                <div
                  key={log.id}
                  className="group flex items-start gap-3.5 px-5 py-3.5 transition-colors hover:bg-[var(--surface-2)]"
                >
                  {/* Marcador de severidade */}
                  <div className="mt-0.5 shrink-0">
                    {destructive ? (
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-md"
                        style={{
                          background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
                          color: 'var(--warn)',
                        }}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--line-glow)]" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-[13px] font-medium',
                          destructive ? 'text-[var(--ink)]' : 'text-[var(--ink-2)]',
                        )}
                      >
                        {AUDIT_LABELS[log.action] ?? log.action}
                      </span>

                      {log.project_id && projectName.has(log.project_id) && (
                        <Link href={`/projetos/${log.project_id}`}>
                          <Badge tone="signal" className="transition-opacity hover:opacity-75">
                            {projectName.get(log.project_id)}
                          </Badge>
                        </Link>
                      )}
                    </div>

                    {log.detail && (
                      <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-[var(--ink-3)]">
                        {log.detail}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className="text-[11.5px] text-[var(--ink-3)]"
                      title={formatDateTime(log.created_at)}
                    >
                      {timeAgo(log.created_at)}
                    </p>
                    {log.ip && (
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--ink-4)]">{log.ip}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <p className="text-center text-[11.5px] text-[var(--ink-4)]">
        Mostrando os 300 registros mais recentes.
      </p>
    </div>
  )
}
