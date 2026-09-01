'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  Eye,
  HardDriveDownload,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  Stat,
} from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, formatBytes, formatDateTime, formatNumber, timeAgo } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import { BackupViewer } from './BackupViewer'
import type { ProjectWithMeta } from '@/lib/types'

interface Backup {
  id: string
  storage_path: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'error'
  error: string | null
  size_bytes: number | null
  raw_bytes: number | null
  table_count: number | null
  row_count: number | null
  index_count: number | null
  trigger_count: number | null
  function_count: number | null
  policy_count: number | null
  auth_users: number | null
  trigger_source: 'manual' | 'cron'
}

export function BackupTab({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()

  const [backups, setBackups] = useState<Backup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Backup | null>(null)
  const [viewing, setViewing] = useState<Backup | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/backup`)
      const data = await res.json()

      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao listar os backups.'))
        setBackups([])
        return
      }

      setError(null)
      setBackups(data.backups)
    } catch {
      setError('Falha de conexão.')
      setBackups([])
    }
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  async function runNow() {
    setRunning(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/backup`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error('Backup falhou', humanizeShort(data.error))
        await load()
        return
      }

      const c = data.counts
      toast.success(
        'Backup concluído',
        `${c.tables} tabelas · ${formatNumber(c.rows)} linhas · ${formatBytes(data.sizeBytes)}`,
      )

      if (data.warnings?.length) {
        toast.warning('Com avisos', data.warnings[0])
      }

      await load()
    } catch {
      toast.error('Falha de conexão durante o backup.')
    } finally {
      setRunning(false)
    }
  }

  async function download(backup: Backup) {
    setBusy(backup.id)
    try {
      const res = await fetch(`/api/projects/${project.id}/backup`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId: backup.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error('Falha ao gerar o link', humanizeShort(data.error))
        return
      }

      window.location.href = data.url
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete() {
    if (!toDelete) return

    const res = await fetch(`/api/projects/${project.id}/backup`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: toDelete.id }),
    })

    const data = await res.json()
    if (!res.ok) {
      toast.error('Falha ao excluir', humanizeShort(data.error))
      return
    }

    toast.success('Backup excluído')
    setToDelete(null)
    load()
  }

  /* ── Sem token da conta ────────────────────────────────────────────── */
  if (!project.has_pat) {
    return (
      <Card>
        <EmptyState
          icon={<Archive className="h-5 w-5" />}
          title="Backup indisponível"
          description={`Gerar backup exige o token da conta ${
            project.account_email ?? 'de origem'
          }, porque é preciso ler o catálogo do banco. Conecte essa conta em Conexões para liberar.`}
        />
      </Card>
    )
  }

  if (!backups) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const lastOk = backups.find((b) => b.status === 'ok')
  const daysSince = lastOk
    ? Math.floor((Date.now() - new Date(lastOk.started_at).getTime()) / 86400_000)
    : null

  return (
    <div className="space-y-4">
      {/* ─── Estado ────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden p-5">
        {lastOk && (
          <span
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${
                daysSince !== null && daysSince > 2 ? 'var(--warn)' : 'var(--signal)'
              }, transparent)`,
            }}
          />
        )}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={
                lastOk
                  ? {
                      background: 'color-mix(in srgb, var(--signal) 12%, transparent)',
                      color: 'var(--signal)',
                    }
                  : {
                      background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
                      color: 'var(--warn)',
                    }
              }
            >
              <Archive className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[15px] font-semibold tracking-[-0.02em]">
                  Backup do banco
                </h3>
                {lastOk ? (
                  <Badge tone={daysSince !== null && daysSince > 2 ? 'warn' : 'signal'}>
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Último {timeAgo(lastOk.started_at)}
                  </Badge>
                ) : (
                  <Badge tone="warn">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Nunca feito
                  </Badge>
                )}
              </div>

              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-[var(--ink-2)]">
                Estrutura completa (tabelas, índices, constraints, triggers, funções, views e
                policies) mais todos os dados, comprimido e guardado no Storage do projeto do
                sistema. Roda sozinho todo dia às 5h UTC.
              </p>
            </div>
          </div>

          <Button variant="primary" onClick={runNow} loading={running} className="shrink-0">
            <HardDriveDownload className="h-4 w-4" />
            Fazer backup agora
          </Button>
        </div>

        {lastOk && (
          <div className="mt-5 grid grid-cols-2 gap-5 border-t border-[var(--line)] pt-4 sm:grid-cols-4">
            <Stat label="Tabelas" value={formatNumber(lastOk.table_count)} />
            <Stat label="Linhas" value={formatNumber(lastOk.row_count)} />
            <Stat label="Arquivo" value={formatBytes(lastOk.size_bytes)} />
            <Stat
              label="Compressão"
              value={
                lastOk.raw_bytes && lastOk.size_bytes
                  ? `${Math.round((1 - lastOk.size_bytes / lastOk.raw_bytes) * 100)}%`
                  : '·'
              }
            />
          </div>
        )}
      </Card>

      {/* ─── O que não entra ───────────────────────────────────────────── */}
      <Alert tone="warn" title="O que este backup não cobre">
        Os <strong>arquivos dentro dos buckets do Storage</strong> (imagens, PDFs) não são salvos:
        só o inventário deles vai no arquivo. Usuários do Auth também ficam de fora, porque as
        senhas nunca saem do Supabase. Se esses itens forem críticos neste projeto, eles precisam de
        um caminho próprio.
      </Alert>

      {error && <Alert tone="alert">{error}</Alert>}

      {/* ─── Histórico ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Histórico"
          description="Guardados por 30 dias. Use o olho para abrir um backup, ver o conteúdo e restaurar linhas específicas."
          action={
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          }
        />

        {backups.length === 0 ? (
          <EmptyState
            compact
            icon={<Archive className="h-5 w-5" />}
            title="Nenhum backup ainda"
            description="Clique em “Fazer backup agora” para gerar o primeiro e conferir o resultado."
          />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="group flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      backup.status === 'ok'
                        ? 'var(--signal)'
                        : backup.status === 'error'
                          ? 'var(--alert)'
                          : 'var(--warn)',
                  }}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px]">
                      {formatDateTime(backup.started_at)}
                    </span>

                    <Badge tone={backup.trigger_source === 'cron' ? 'neutral' : 'info'}>
                      {backup.trigger_source === 'cron' ? 'automático' : 'manual'}
                    </Badge>

                    {backup.status === 'error' && <Badge tone="alert">falhou</Badge>}
                    {backup.status === 'running' && <Badge tone="warn">em andamento</Badge>}
                  </div>

                  {backup.status === 'ok' && (
                    <p className="mt-1 font-mono text-[11px] text-[var(--ink-4)]">
                      {formatNumber(backup.table_count)} tabelas ·{' '}
                      {formatNumber(backup.row_count)} linhas · {formatBytes(backup.size_bytes)}
                      {backup.error && (
                        <span className="text-[var(--warn)]"> · com avisos</span>
                      )}
                    </p>
                  )}

                  {backup.status === 'error' && backup.error && (
                    <p className="mt-1 break-words text-[11px] text-[var(--alert)]">
                      {backup.error}
                    </p>
                  )}
                </div>

                {backup.status === 'ok' && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Ver conteúdo e restaurar linhas"
                      onClick={() => setViewing(backup)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Baixar"
                      loading={busy === backup.id}
                      onClick={() => download(backup)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Excluir"
                      onClick={() => setToDelete(backup)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {viewing && (
        <BackupViewer
          projectId={project.id}
          projectName={project.name}
          backupId={viewing.id}
          startedAt={viewing.started_at}
          onClose={() => setViewing(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Excluir backup"
        confirmLabel="Excluir"
        message={
          <>
            O backup de{' '}
            <strong className="font-mono text-[var(--ink)]">
              {toDelete && formatDateTime(toDelete.started_at)}
            </strong>{' '}
            será apagado do Storage. Se for o único que você tem deste projeto, confira antes se
            existe outra cópia.
          </>
        }
      />
    </div>
  )
}
