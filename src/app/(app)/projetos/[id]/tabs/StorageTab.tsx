'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronRight,
  Download,
  File,
  Folder,
  FolderTree,
  Globe,
  Lock,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert, Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, formatBytes, formatDateTime } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { ProjectWithMeta } from '@/lib/types'
import type { StorageBucket, StorageObject } from '@/lib/gateway/project'

export function StorageTab({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()

  const [buckets, setBuckets] = useState<StorageBucket[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [objects, setObjects] = useState<StorageObject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [toDelete, setToDelete] = useState<StorageObject | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadBuckets() {
      try {
        const res = await fetch(`/api/projects/${project.id}/storage`)
        const data = await res.json()
        if (cancelled) return

        if (!res.ok) {
          setError(humanizeShort(data.error ?? 'Falha ao listar os buckets.'))
          setBuckets([])
          return
        }

        setBuckets(data.buckets)
        if (data.buckets.length) setSelected(data.buckets[0].name)
      } catch {
        if (!cancelled) {
          setError('Falha de conexão ao listar os buckets.')
          setBuckets([])
        }
      }
    }

    loadBuckets()
    return () => {
      cancelled = true
    }
  }, [project.id])

  const loadObjects = useCallback(async () => {
    if (!selected) return

    setLoading(true)
    try {
      const params = new URLSearchParams({ bucket: selected })
      if (prefix) params.set('prefix', prefix)

      const res = await fetch(`/api/projects/${project.id}/storage?${params}`)
      const data = await res.json()

      if (!res.ok) {
        toast.error('Falha ao listar arquivos', humanizeShort(data.error))
        setObjects([])
        return
      }

      setObjects(data.objects)
    } catch {
      setObjects([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, selected, prefix])

  useEffect(() => {
    loadObjects()
  }, [loadObjects])

  async function download(object: StorageObject) {
    if (!selected) return

    try {
      const res = await fetch(`/api/projects/${project.id}/storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: selected, path: prefix + object.name }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error('Falha ao gerar o link', humanizeShort(data.error))
        return
      }

      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Falha de conexão.')
    }
  }

  async function handleDelete() {
    if (!toDelete || !selected) return

    const res = await fetch(`/api/projects/${project.id}/storage`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: selected, path: prefix + toDelete.name }),
    })

    const data = await res.json()
    if (!res.ok) {
      toast.error('Falha ao excluir', humanizeShort(data.error))
      return
    }

    toast.success('Arquivo excluído')
    setToDelete(null)
    loadObjects()
  }

  /** Objetos sem metadata são "pastas" virtuais no Storage da Supabase. */
  function isFolder(object: StorageObject): boolean {
    return object.id === null && !object.metadata
  }

  if (error) {
    return (
      <Alert tone="alert" title="Não foi possível acessar o Storage">
        {error}
      </Alert>
    )
  }

  if (!buckets) {
    return (
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!buckets.length) {
    return (
      <Card>
        <EmptyState
          icon={<FolderTree className="h-8 w-8" />}
          title="Nenhum bucket"
          description="Este projeto ainda não tem buckets de Storage criados."
        />
      </Card>
    )
  }

  const segments = prefix.split('/').filter(Boolean)

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* Buckets */}
      <Card className="overflow-hidden">
        <CardHeader title="Buckets" />
        <div className="p-2">
          {buckets.map((bucket) => (
            <button
              key={bucket.id}
              type="button"
              onClick={() => {
                setSelected(bucket.name)
                setPrefix('')
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                selected === bucket.name
                  ? 'bg-[var(--surface-2)] font-medium'
                  : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]',
              )}
            >
              {bucket.public ? (
                <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
              ) : (
                <Lock className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{bucket.name}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Arquivos */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-1 font-mono text-xs">
              <button
                type="button"
                onClick={() => setPrefix('')}
                className="hover:text-[var(--signal)]"
              >
                {selected}
              </button>
              {segments.map((segment, index) => (
                <span key={index} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-[var(--ink-4)]" />
                  <button
                    type="button"
                    onClick={() => setPrefix(segments.slice(0, index + 1).join('/') + '/')}
                    className="hover:text-[var(--signal)]"
                  >
                    {segment}
                  </button>
                </span>
              ))}
            </span>
          }
          action={
            <Button size="sm" variant="ghost" onClick={loadObjects} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          }
        />

        {loading && objects === null ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : objects && objects.length === 0 ? (
          <EmptyState title="Pasta vazia" description="Nenhum arquivo neste caminho." />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {prefix && (
              <button
                type="button"
                onClick={() => {
                  const parts = prefix.split('/').filter(Boolean)
                  parts.pop()
                  setPrefix(parts.length ? parts.join('/') + '/' : '')
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]"
              >
                <Folder className="h-4 w-4" />
                ..
              </button>
            )}

            {(objects ?? []).map((object) => {
              const folder = isFolder(object)

              return (
                <div
                  key={object.name}
                  className="group flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-[var(--surface-2)]"
                >
                  {folder ? (
                    <button
                      type="button"
                      onClick={() => setPrefix(`${prefix}${object.name}/`)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-[var(--info)]" />
                      <span className="truncate text-sm">{object.name}</span>
                    </button>
                  ) : (
                    <>
                      <File className="h-4 w-4 shrink-0 text-[var(--ink-4)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{object.name}</p>
                        <p className="text-[11px] text-[var(--ink-4)]">
                          {formatBytes(object.metadata?.size)}
                          {object.metadata?.mimetype && ` · ${object.metadata.mimetype}`}
                          {object.updated_at && ` · ${formatDateTime(object.updated_at)}`}
                        </p>
                      </div>

                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => download(object)}
                          title="Baixar (link temporario)"
                          className="rounded p-1.5 text-[var(--ink-2)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToDelete(object)}
                          title="Excluir arquivo"
                          className="rounded p-1.5 text-[var(--ink-2)] hover:bg-[color-mix(in srgb, var(--alert) 14%, transparent)] hover:text-[var(--alert)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Excluir arquivo"
        confirmLabel="Excluir"
        message={
          <>
            O arquivo{' '}
            <strong className="font-mono">
              {prefix}
              {toDelete?.name}
            </strong>{' '}
            será removido do bucket <strong>{selected}</strong>. Não ha desfazer.
          </>
        }
      />
    </div>
  )
}
