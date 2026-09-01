'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Table2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SearchField } from '@/components/ui/Field'
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, formatDateTime, formatNumber, truncate } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'

const PAGE = 100

interface TableSummary {
  table: string
  rows: number
}

/**
 * Abre um backup para leitura, sem restaurar nada por padrão.
 *
 * O caminho seguro para "o que tinha aqui na terça": você olha, confere, e só
 * então escolhe linhas específicas para devolver. Restaurar tudo desfaria o
 * que aconteceu depois, quase nunca é o que se quer.
 */
export function BackupViewer({
  projectId,
  projectName,
  backupId,
  startedAt,
  onClose,
  onRestored,
}: {
  projectId: string
  projectName: string
  backupId: string
  startedAt: string
  onClose: () => void
  onRestored?: () => void
}) {
  const toast = useToast()

  const [tables, setTables] = useState<TableSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loadingRows, setLoadingRows] = useState(false)

  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirmMode, setConfirmMode] = useState<'missing' | 'overwrite' | null>(null)
  const [restoring, setRestoring] = useState(false)

  /* ── Lista de tabelas do backup ─────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/backup/inspect?backupId=${backupId}`,
        )
        const data = await res.json()
        if (cancelled) return

        if (!res.ok) {
          setError(humanizeShort(data.error ?? 'Falha ao abrir o backup.'))
          setTables([])
          return
        }

        setTables(data.tables)
        const first = data.tables.find((t: TableSummary) => t.rows > 0) ?? data.tables[0]
        if (first) setSelectedTable(first.table)
      } catch {
        if (!cancelled) {
          setError('Falha de conexão ao abrir o backup.')
          setTables([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, backupId])

  /* ── Linhas da tabela escolhida ─────────────────────────────────────── */
  const loadRows = useCallback(async () => {
    if (!selectedTable) return

    setLoadingRows(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/backup/inspect?backupId=${backupId}&table=${encodeURIComponent(
          selectedTable,
        )}&offset=${offset}`,
      )
      const data = await res.json()

      if (!res.ok) {
        toast.error('Falha ao ler a tabela', humanizeShort(data.error))
        return
      }

      setColumns(data.columns)
      setRows(data.rows)
      setTotal(data.total)
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setLoadingRows(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, backupId, selectedTable, offset])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  // Trocar de tabela zera seleção e paginação
  useEffect(() => {
    setPicked(new Set())
    setOffset(0)
  }, [selectedTable])

  const visibleTables = useMemo(() => {
    if (!tables) return []
    const needle = filter.trim().toLowerCase()
    return needle ? tables.filter((t) => t.table.toLowerCase().includes(needle)) : tables
  }, [tables, filter])

  async function restore(mode: 'missing' | 'overwrite') {
    setRestoring(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/backup/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupId,
          table: selectedTable,
          rowIndexes: [...picked].map((i) => offset + i),
          mode,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error('Não foi possível restaurar', humanizeShort(data.error))
        return
      }

      toast.success(
        `${data.inserted} ${data.inserted === 1 ? 'linha restaurada' : 'linhas restauradas'}`,
        data.skipped > 0
          ? `${data.skipped} já existia(m) e ${mode === 'missing' ? 'não foram tocadas' : 'foram substituídas'}.`
          : undefined,
      )

      setPicked(new Set())
      setConfirmMode(null)
      onRestored?.()
    } catch {
      toast.error('Falha de conexão ao restaurar.')
    } finally {
      setRestoring(false)
    }
  }

  const allPicked = rows.length > 0 && picked.size === rows.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[3px] fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-[86vh] w-full max-w-6xl flex-col rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_32px_90px_-20px_rgba(0,0,0,0.9)] scale-in"
      >
        {/* ─── Cabeçalho ──────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold tracking-[-0.02em]">
              Backup de {projectName}
            </h2>
            <p className="mt-1 font-mono text-[11.5px] text-[var(--ink-3)]">
              {formatDateTime(startedAt)} · somente leitura
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <div className="p-5">
            <Alert tone="alert">{error}</Alert>
          </div>
        ) : !tables ? (
          <div className="flex-1 space-y-2 p-5">
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* ─── Tabelas do backup ────────────────────────────────── */}
            <div className="flex w-56 shrink-0 flex-col border-r border-[var(--line)]">
              <div className="border-b border-[var(--line)] p-3">
                <SearchField
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar…"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {visibleTables.map((t) => (
                  <button
                    key={t.table}
                    type="button"
                    onClick={() => setSelectedTable(t.table)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      selectedTable === t.table
                        ? 'bg-[var(--surface-2)] text-[var(--ink)]'
                        : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]',
                    )}
                  >
                    <Table2
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        selectedTable === t.table
                          ? 'text-[var(--signal)]'
                          : 'text-[var(--ink-4)]',
                      )}
                    />
                    <span className="truncate font-mono text-[12px]">{t.table}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-[var(--ink-4)]">
                      {formatNumber(t.rows)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ─── Linhas ───────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Barra de seleção */}
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-2.5">
                <span className="font-mono text-[12.5px] font-semibold">{selectedTable}</span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--ink-4)]">
                  {formatNumber(total)} {total === 1 ? 'linha' : 'linhas'} no backup
                </span>

                {picked.size > 0 && (
                  <>
                    <Badge tone="signal">{picked.size} selecionada(s)</Badge>

                    <div className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setConfirmMode('missing')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restaurar só as ausentes
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setConfirmMode('overwrite')}>
                        Substituir as existentes
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* Tabela */}
              <div className="min-h-0 flex-1 overflow-auto">
                {loadingRows ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                ) : rows.length === 0 ? (
                  <EmptyState
                    compact
                    title="Tabela vazia neste backup"
                    description="Não havia linhas nesta tabela no momento em que o backup foi gerado."
                  />
                ) : (
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 z-10 bg-[var(--surface)]">
                      <tr className="border-b border-[var(--line)]">
                        <th className="w-10 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={allPicked}
                            onChange={(e) =>
                              setPicked(
                                e.target.checked
                                  ? new Set(rows.map((_, i) => i))
                                  : new Set(),
                              )
                            }
                            className="h-3.5 w-3.5 accent-[var(--signal)]"
                            title="Selecionar tudo nesta página"
                          />
                        </th>
                        {columns.map((c) => (
                          <th key={c} className="label whitespace-nowrap px-3 py-2 text-left">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-[var(--line)]">
                      {rows.map((row, i) => (
                        <tr
                          key={i}
                          onClick={() =>
                            setPicked((current) => {
                              const next = new Set(current)
                              if (next.has(i)) next.delete(i)
                              else next.add(i)
                              return next
                            })
                          }
                          className={cn(
                            'cursor-pointer transition-colors',
                            picked.has(i)
                              ? 'bg-[color-mix(in_srgb,var(--signal)_9%,transparent)]'
                              : 'hover:bg-[var(--surface-2)]',
                          )}
                        >
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={picked.has(i)}
                              onChange={() => {}}
                              className="h-3.5 w-3.5 accent-[var(--signal)]"
                            />
                          </td>
                          {columns.map((c) => (
                            <td
                              key={c}
                              className="max-w-64 truncate px-3 py-1.5 font-mono text-[11px]"
                              title={
                                row[c] === null || row[c] === undefined
                                  ? 'null'
                                  : String(
                                      typeof row[c] === 'object'
                                        ? JSON.stringify(row[c])
                                        : row[c],
                                    ).slice(0, 400)
                              }
                            >
                              {row[c] === null || row[c] === undefined ? (
                                <span className="italic text-[var(--ink-4)]">null</span>
                              ) : typeof row[c] === 'object' ? (
                                <span className="text-[var(--info)]">
                                  {truncate(JSON.stringify(row[c]), 50)}
                                </span>
                              ) : (
                                truncate(String(row[c]), 70)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Paginação */}
              {total > PAGE && (
                <div className="flex shrink-0 items-center justify-between border-t border-[var(--line)] px-4 py-2.5">
                  <span className="font-mono text-[11.5px] tabular-nums text-[var(--ink-4)]">
                    {offset + 1} a {Math.min(offset + PAGE, total)} de {formatNumber(total)}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                      disabled={offset === 0 || loadingRows}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setOffset((o) => o + PAGE)}
                      disabled={offset + PAGE >= total || loadingRows}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Rodapé ─────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-[var(--line)] bg-[var(--void)]/40 px-5 py-3">
          <p className="text-[11.5px] leading-relaxed text-[var(--ink-4)]">
            Clique nas linhas para selecionar. Nada é gravado no banco até você escolher restaurar.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirmMode !== null}
        onClose={() => setConfirmMode(null)}
        onConfirm={() => restore(confirmMode!)}
        loading={restoring}
        title={
          confirmMode === 'overwrite' ? 'Substituir linhas existentes' : 'Restaurar linhas ausentes'
        }
        confirmLabel={confirmMode === 'overwrite' ? 'Substituir' : 'Restaurar'}
        confirmPhrase={confirmMode === 'overwrite' ? 'substituir' : undefined}
        message={
          confirmMode === 'overwrite' ? (
            <>
              As <strong className="text-[var(--ink)]">{picked.size}</strong> linhas selecionadas
              serão gravadas em{' '}
              <strong className="font-mono text-[var(--ink)]">{selectedTable}</strong>, e as que já
              existirem <strong>serão sobrescritas</strong> pela versão do backup.
              <br />
              <br />
              Qualquer alteração feita nelas depois de {formatDateTime(startedAt)} será perdida.
            </>
          ) : (
            <>
              As <strong className="text-[var(--ink)]">{picked.size}</strong> linhas selecionadas
              serão inseridas em{' '}
              <strong className="font-mono text-[var(--ink)]">{selectedTable}</strong>.
              <br />
              <br />
              As que já existirem no banco <strong>não serão tocadas</strong>, só volta o que está
              faltando. É a opção segura.
            </>
          )
        }
      />
    </div>
  )
}
