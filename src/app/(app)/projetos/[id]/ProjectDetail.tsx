'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Archive,
  ChevronLeft,
  Clock,
  ExternalLink,
  FolderTree,
  Gauge,
  KeyRound,
  Table2,
  Terminal,
  Users,
} from 'lucide-react'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Badge, HealthDot } from '@/components/ui/Primitives'
import { cn, clientColor, statusLabel } from '@/lib/utils'
import type { Client, Health, ProjectWithMeta } from '@/lib/types'
import { OverviewTab } from './tabs/OverviewTab'
import { TablesTab } from './tabs/TablesTab'
import { SqlTab } from './tabs/SqlTab'
import { CronTab } from './tabs/CronTab'
import { AuthTab } from './tabs/AuthTab'
import { StorageTab } from './tabs/StorageTab'
import { BackupTab } from './tabs/BackupTab'

type TabId = 'overview' | 'tables' | 'sql' | 'cron' | 'auth' | 'storage' | 'backup'

const TABS: Array<{ id: TabId; label: string; icon: typeof Gauge; needsPat?: boolean }> = [
  { id: 'overview', label: 'Visão geral', icon: Gauge },
  { id: 'tables', label: 'Tabelas', icon: Table2 },
  { id: 'sql', label: 'SQL Runner', icon: Terminal, needsPat: true },
  { id: 'cron', label: 'Cron Jobs', icon: Clock, needsPat: true },
  { id: 'auth', label: 'Auth', icon: Users },
  { id: 'storage', label: 'Storage', icon: FolderTree },
  { id: 'backup', label: 'Backups', icon: Archive, needsPat: true },
]

export function ProjectDetail({
  project,
  clients,
}: {
  project: ProjectWithMeta
  clients: Client[]
}) {
  const [tab, setTab] = useState<TabId>('overview')

  const health: Health = project.latest_snapshot?.overall_health ?? 'unknown'
  const paused = /paus|inactive/i.test(project.status ?? '')
  const dashboardUrl = project.ref ? `https://supabase.com/dashboard/project/${project.ref}` : null

  return (
    <>
      <PageHeader
        flush
        breadcrumb={
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Carteira
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <HealthDot health={health} size={9} />
            {project.name}
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {project.client && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-2)]">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: clientColor(project.client.name, project.client.color) }}
                />
                {project.client.name}
              </span>
            )}

            <Badge tone={paused ? 'warn' : 'neutral'}>{statusLabel(project.status)}</Badge>

            {project.account_email && (
              <Badge mono>
                <KeyRound className="h-3 w-3" />
                {project.account_email}
              </Badge>
            )}

            {project.region && (
              <span className="font-mono text-[11px] text-[var(--ink-4)]">{project.region}</span>
            )}

            {!project.has_pat && (
              <Badge tone="warn">Sem token da conta</Badge>
            )}
          </div>
        }
        action={
          dashboardUrl && (
            <a
              href={dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9.5 items-center gap-2 rounded-lg border border-[var(--line-strong)] px-4 text-[13.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--line-glow)] hover:text-[var(--ink)]"
            >
              <ExternalLink className="h-4 w-4" />
              Painel oficial
            </a>
          )
        }
      />

      {/* ─── Abas ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--void)]/85 backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] overflow-x-auto px-5 sm:px-7">
          <div className="flex gap-1">
            {TABS.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              const locked = item.needsPat && !project.has_pat

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'relative flex items-center gap-2 whitespace-nowrap px-3 py-3',
                    'font-display text-[13.5px] tracking-[-0.015em] transition-colors',
                    active
                      ? 'font-semibold text-[var(--ink)]'
                      : 'font-medium text-[var(--ink-3)] hover:text-[var(--ink-2)]',
                  )}
                >
                  <Icon
                    className={cn('h-4 w-4', active && 'text-[var(--signal)]')}
                    strokeWidth={active ? 2.2 : 1.9}
                  />
                  {item.label}

                  {locked && (
                    <span className="h-1 w-1 rounded-full bg-[var(--warn)]" title="Requer o token da conta" />
                  )}

                  {/* Sublinhado do item ativo */}
                  <span
                    className={cn(
                      'absolute inset-x-0 bottom-0 h-[2px] rounded-t-full transition-opacity duration-200',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                    style={{
                      background: 'var(--signal)',
                      boxShadow: active ? '0 0 10px var(--signal)' : undefined,
                    }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <PageBody>
        {tab === 'overview' && <OverviewTab project={project} clients={clients} />}
        {tab === 'tables' && <TablesTab project={project} />}
        {tab === 'sql' && <SqlTab project={project} />}
        {tab === 'cron' && <CronTab project={project} />}
        {tab === 'auth' && <AuthTab project={project} />}
        {tab === 'storage' && <StorageTab project={project} />}
        {tab === 'backup' && <BackupTab project={project} />}
      </PageBody>
    </>
  )
}
