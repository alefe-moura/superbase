'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Key,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, SearchField, Select, Textarea } from '@/components/ui/Field'
import { Alert, Badge, Card, EmptyState, Modal, Skeleton } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, formatNumber, truncate } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { ProjectWithMeta, TableColumn, TableInfo } from '@/lib/types'

const PAGE_SIZE = 50

export function TablesTab({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()

  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [tablesError, setTablesError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState('')
  const [reloading, setReloading] = useState(false)

  const loadSchema = useCallback(
    async (force = false) => {
      if (force) setReloading(true)

      try {
        const res = await fetch(`/api/projects/${project.id}/tables${force ? '?refresh=1' : ''}`)
        const data = await res.json()

        if (!res.ok) {
          setTablesError(data.error ?? 'Falha ao listar as tabelas.')
          setTables([])
          return
        }

        setTablesError(null)
        setTables(data.tables)
        setSelected((current) =>
          current && data.tables.some((t: TableInfo) => t.name === current)
            ? current
            : (data.tables[0]?.name ?? null),
        )

        if (force) toast.success('Estrutura relida do banco')
      } catch {
        setTablesError('Falha de conexão ao listar as tabelas.')
        setTables([])
      } finally {
        setReloading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id],
  )

  useEffect(() => {
    loadSchema()
  }, [loadSchema])

  const filteredTables = useMemo(() => {
    if (!tables) return []
    const needle = tableFilter.trim().toLowerCase()
    return needle ? tables.filter((t) => t.name.toLowerCase().includes(needle)) : tables
  }, [tables, tableFilter])

  const currentTable = tables?.find((t) => t.name === selected) ?? null

  if (tablesError) {
    return (
      <Alert tone="alert" title="Não foi possível ler o schema">
        {tablesError}
      </Alert>
    )
  }

  if (!tables) {
    return (
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!tables.length) {
    return (
      <Card>
        <EmptyState
          icon={<Table2 className="h-5 w-5" />}
          title="Nenhuma tabela exposta"
          description="O PostgREST não expôs nenhuma tabela neste projeto. Verifique se o schema public tem tabelas acessíveis."
          action={
            <Button variant="secondary" onClick={() => loadSchema(true)} loading={reloading}>
              <RefreshCw className={cn('h-4 w-4', reloading && 'spin')} />
              Reler estrutura
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
      {/* ─── Lista de tabelas ──────────────────────────────────────────── */}
      <Card className="flex max-h-[72vh] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-[var(--line)] p-3">
          <SearchField
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="Filtrar tabelas…"
          />

          <button
            type="button"
            onClick={() => loadSchema(true)}
            disabled={reloading}
            className="flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[11px] text-[var(--ink-4)] transition-colors hover:text-[var(--ink-2)] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', reloading && 'spin')} />
            {reloading ? 'Relendo…' : 'Reler estrutura'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredTables.map((table) => (
            <button
              key={table.name}
              type="button"
              onClick={() => setSelected(table.name)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                selected === table.name
                  ? 'bg-[var(--surface-2)] text-[var(--ink)]'
                  : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]',
              )}
            >
              <Table2
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  selected === table.name ? 'text-[var(--signal)]' : 'text-[var(--ink-4)]',
                )}
              />
              <span className="truncate font-mono text-[12px]">{table.name}</span>
              {table.primaryKeys.length === 0 && (
                <span
                  className="ml-auto shrink-0 text-[9px] font-medium text-[var(--warn)]"
                  title="Sem chave primária: somente leitura"
                >
                  RO
                </span>
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* ─── Dados ─────────────────────────────────────────────────────── */}
      {currentTable ? (
        <TableDataView key={currentTable.name} project={project} table={currentTable} />
      ) : (
        <Card>
          <EmptyState title="Escolha uma tabela" description="Selecione uma tabela na lista ao lado." />
        </Card>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Dados da tabela
   ═══════════════════════════════════════════════════════════════════════════ */

function TableDataView({ project, table }: { project: ProjectWithMeta; table: TableInfo }) {
  const toast = useToast()

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [orderBy, setOrderBy] = useState<string | null>(table.primaryKeys[0] ?? null)
  const [ascending, setAscending] = useState(true)
  const [filterColumn, setFilterColumn] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null)

  /** Célula aberta para edição por duplo clique. */
  const [cell, setCell] = useState<{
    rowIndex: number
    column: TableColumn
    value: unknown
  } | null>(null)

  const readOnly = table.primaryKeys.length === 0

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        table: table.name,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      })
      if (orderBy) {
        params.set('orderBy', orderBy)
        params.set('ascending', String(ascending))
      }
      if (appliedFilter) params.append('filter', appliedFilter)

      const res = await fetch(`/api/projects/${project.id}/rows?${params}`)
      const data = await res.json()

      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao carregar as linhas.'))
        setRows([])
        return
      }

      setRows(data.rows)
      setTotal(data.total)
    } catch {
      setError('Falha de conexão ao carregar as linhas.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [project.id, table.name, page, orderBy, ascending, appliedFilter])

  useEffect(() => {
    load()
  }, [load])

  function pkOf(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(table.primaryKeys.map((col) => [col, row[col]]))
  }

  /** Salva o valor de UMA célula, sem recarregar a página inteira. */
  async function saveCell(rowIndex: number, column: TableColumn, raw: string, asNull: boolean) {
    const row = rows?.[rowIndex]
    if (!row) return false

    const value = asNull ? null : parseValue(raw, column)

    const res = await fetch(`/api/projects/${project.id}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: table.name, pk: pkOf(row), values: { [column.name]: value } }),
    })

    const data = await res.json()
    if (!res.ok) {
      toast.error(
        'Não foi possível salvar',
        humanizeShort(data.hint ? `${data.error} (${data.hint})` : data.error))
      return false
    }

    setRows((current) => {
      if (!current) return current
      const next = [...current]
      next[rowIndex] = { ...next[rowIndex], ...(data.row ?? { [column.name]: value }) }
      return next
    })

    toast.success('Célula salva', `${table.name}.${column.name}`)
    return true
  }

  async function handleDelete() {
    if (!toDelete) return

    const res = await fetch(`/api/projects/${project.id}/rows`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: table.name, pk: pkOf(toDelete) }),
    })

    const data = await res.json()
    if (!res.ok) {
      toast.error('Falha ao excluir', humanizeShort(data.error))
      return
    }

    toast.success('Linha excluída')
    setToDelete(null)
    load()
  }

  function applyFilter() {
    setAppliedFilter(
      filterColumn && filterValue.trim()
        ? `${encodeURIComponent(filterColumn)}=ilike.*${encodeURIComponent(filterValue.trim())}*`
        : null,
    )
    setPage(0)
  }

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null

  return (
    <div className="min-w-0 space-y-3">
      {/* ─── Barra de ações ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[14px] font-semibold">{table.name}</h2>

        {total != null && (
          <span className="font-mono text-[11.5px] tabular-nums text-[var(--ink-3)]">
            {total > 50000 && '~'}
            {formatNumber(total)} {total === 1 ? 'linha' : 'linhas'}
          </span>
        )}

        {readOnly && (
          <Badge tone="warn" title="Sem chave primária detectável">
            Somente leitura
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={load} title="Recarregar linhas">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'spin')} />
          </Button>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Inserir
          </Button>
        </div>
      </div>

      {/* ─── Filtro ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <Select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)}>
            <option value="">Filtrar por coluna…</option>
            {table.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <input
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
          placeholder="Contém o texto…"
          disabled={!filterColumn}
          className="h-9.5 min-w-40 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--void)] px-3 text-[13.5px] placeholder:text-[var(--ink-4)] focus:border-[var(--signal)] focus:shadow-[0_0_0_3px_var(--focus)] focus:outline-none disabled:opacity-45"
        />

        <Button variant="secondary" onClick={applyFilter} disabled={!filterColumn}>
          Filtrar
        </Button>

        {appliedFilter && (
          <Button
            variant="ghost"
            onClick={() => {
              setFilterColumn('')
              setFilterValue('')
              setAppliedFilter(null)
              setPage(0)
            }}
          >
            Limpar
          </Button>
        )}
      </div>

      {error && <Alert tone="alert">{error}</Alert>}

      {!readOnly && rows && rows.length > 0 && (
        <p className="text-[11.5px] text-[var(--ink-4)]">
          Dê <strong className="text-[var(--ink-3)]">duplo clique</strong> em qualquer célula para
          abrir e editar o valor completo.
        </p>
      )}

      {/* ─── Tabela ────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {loading && rows === null ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : rows && rows.length === 0 ? (
            <EmptyState
              compact
              title="Nenhuma linha"
              description={
                appliedFilter ? 'Nenhuma linha corresponde ao filtro.' : 'Esta tabela está vazia.'
              }
            />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="w-16 px-3 py-2.5" />
                  {table.columns.map((column) => (
                    <th key={column.name} className="whitespace-nowrap px-3 py-2.5 text-left">
                      <button
                        type="button"
                        onClick={() => {
                          if (orderBy === column.name) setAscending((a) => !a)
                          else {
                            setOrderBy(column.name)
                            setAscending(true)
                          }
                          setPage(0)
                        }}
                        className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--ink)]"
                      >
                        {column.isPrimaryKey && (
                          <Key className="h-3 w-3 shrink-0 text-[var(--signal)]" />
                        )}
                        <span className="label">{column.name}</span>
                        {orderBy === column.name && (
                          <span className="text-[var(--signal)]">{ascending ? '↑' : '↓'}</span>
                        )}
                      </button>
                      <span className="ml-1.5 font-mono text-[9.5px] font-normal text-[var(--ink-4)]">
                        {column.format}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--line)]">
                {(rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex} className="group transition-colors hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-1.5">
                      <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setEditingRow(row)}
                          disabled={readOnly}
                          title={readOnly ? 'Tabela sem chave primária' : 'Editar linha inteira'}
                          className="rounded p-1 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:opacity-30"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToDelete(row)}
                          disabled={readOnly}
                          title={readOnly ? 'Tabela sem chave primária' : 'Excluir linha'}
                          className="rounded p-1 text-[var(--ink-3)] transition-colors hover:bg-[color-mix(in_srgb,var(--alert)_15%,transparent)] hover:text-[var(--alert)] disabled:opacity-30"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>

                    {table.columns.map((column) => {
                      const editable = !readOnly && !column.isPrimaryKey

                      return (
                        <td
                          key={column.name}
                          onDoubleClick={() =>
                            editable && setCell({ rowIndex, column, value: row[column.name] })
                          }
                          title={
                            editable
                              ? 'Duplo clique para editar'
                              : column.isPrimaryKey
                                ? 'Chave primária, não editável'
                                : undefined
                          }
                          className={cn(
                            'max-w-72 truncate px-3 py-1.5 font-mono text-[11.5px]',
                            editable &&
                              'cursor-cell hover:bg-[color-mix(in_srgb,var(--signal)_9%,transparent)] hover:ring-1 hover:ring-inset hover:ring-[color-mix(in_srgb,var(--signal)_35%,transparent)]',
                          )}
                        >
                          <CellValue value={row[column.name]} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ─── Paginação ───────────────────────────────────────────────── */}
        {rows && rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-2.5">
            <span className="font-mono text-[11.5px] tabular-nums text-[var(--ink-4)]">
              {page * PAGE_SIZE + 1} a {page * PAGE_SIZE + rows.length}
              {total != null && ` de ${formatNumber(total)}`}
            </span>

            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              {totalPages && (
                <span className="px-2 font-mono text-[11.5px] tabular-nums text-[var(--ink-3)]">
                  {page + 1} / {totalPages}
                </span>
              )}

              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || rows.length < PAGE_SIZE}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>

              {loading && <Loader2 className="ml-1 h-3.5 w-3.5 spin text-[var(--ink-4)]" />}
            </div>
          </div>
        )}
      </Card>

      {/* ─── Editor de célula ──────────────────────────────────────────── */}
      {cell && (
        <CellEditor
          tableName={table.name}
          column={cell.column}
          value={cell.value}
          onClose={() => setCell(null)}
          onSave={async (raw, asNull) => {
            const ok = await saveCell(cell.rowIndex, cell.column, raw, asNull)
            if (ok) setCell(null)
            return ok
          }}
        />
      )}

      <RowEditor
        open={Boolean(editingRow) || creating}
        mode={creating ? 'create' : 'edit'}
        project={project}
        table={table}
        row={editingRow}
        onClose={() => {
          setEditingRow(null)
          setCreating(false)
        }}
        onSaved={() => {
          setEditingRow(null)
          setCreating(false)
          load()
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Excluir linha"
        confirmLabel="Excluir definitivamente"
        confirmPhrase="excluir"
        message={
          <>
            Esta linha será apagada do banco de{' '}
            <strong className="text-[var(--ink)]">{project.client?.name ?? project.name}</strong>.
            A ação é irreversível.
            <div className="mt-3 rounded-md bg-[var(--void)] p-2.5 font-mono text-[11px]">
              {toDelete &&
                table.primaryKeys.map((col) => (
                  <div key={col}>
                    {col}: {formatCell(toDelete[col], 60)}
                  </div>
                ))}
            </div>
          </>
        }
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Editor de célula, duplo clique

   Abre o valor por inteiro, porque na tabela ele aparece truncado. Resolve a
   maioria dos ajustes pontuais sem precisar escrever SQL.
   ═══════════════════════════════════════════════════════════════════════════ */

function CellEditor({
  tableName,
  column,
  value,
  onClose,
  onSave,
}: {
  tableName: string
  column: TableColumn
  value: unknown
  onClose: () => void
  onSave: (raw: string, asNull: boolean) => Promise<boolean>
}) {
  const original = stringifyValue(value)
  const wasNull = value === null || value === undefined

  const [draft, setDraft] = useState(original)
  const [isNull, setIsNull] = useState(wasNull)
  const [saving, setSaving] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const dirty = isNull !== wasNull || (!isNull && draft !== original)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.focus()
    area.select()
  }, [])

  const handleSave = useCallback(async () => {
    if (!dirty) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await onSave(draft, isNull)
    } finally {
      setSaving(false)
    }
  }, [dirty, draft, isNull, onSave, onClose])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSave()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleSave, onClose])

  const isJson = /json/i.test(column.format)
  const isLong = original.length > 60 || original.includes('\n') || isJson

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-2xl rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_32px_90px_-20px_rgba(0,0,0,0.9)] scale-in"
      >
        {/* Cabeçalho: deixa claro exatamente onde você está mexendo */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-5 py-3.5">
          <span className="font-mono text-[13px] text-[var(--ink-3)]">
            {tableName}.<span className="font-semibold text-[var(--ink)]">{column.name}</span>
          </span>
          <Badge mono>{column.format}</Badge>
          {column.required && <Badge tone="warn">obrigatório</Badge>}
        </div>

        <div className="px-5 py-4">
          <textarea
            ref={areaRef}
            value={isNull ? '' : draft}
            disabled={isNull}
            onChange={(e) => setDraft(e.target.value)}
            rows={isLong ? 12 : 3}
            spellCheck={false}
            className={cn(
              'w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--void)] p-3',
              'font-mono text-[12.5px] leading-relaxed text-[var(--ink)]',
              'focus:border-[var(--signal)] focus:shadow-[0_0_0_3px_var(--focus)] focus:outline-none',
              'disabled:opacity-40',
            )}
          />

          <div className="mt-3 flex flex-wrap items-center gap-4">
            {!column.required && (
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--ink-2)]">
                <input
                  type="checkbox"
                  checked={isNull}
                  onChange={(e) => setIsNull(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--signal)]"
                />
                Definir como <span className="font-mono text-[var(--ink-4)]">null</span>
              </label>
            )}

            {isJson && !isNull && (
              <button
                type="button"
                onClick={() => {
                  try {
                    setDraft(JSON.stringify(JSON.parse(draft), null, 2))
                  } catch {
                    // JSON inválido: mantém como está, o erro aparece ao salvar.
                  }
                }}
                className="text-[12px] text-[var(--signal)] hover:underline"
              >
                Formatar JSON
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--void)]/40 px-5 py-3">
          <span className="font-mono text-[10.5px] text-[var(--ink-4)]">
            ⌘/Ctrl + Enter salva · Esc cancela
          </span>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving} disabled={!dirty}>
              Salvar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Células
   ═══════════════════════════════════════════════════════════════════════════ */

function formatCell(value: unknown, max = 80): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object') return truncate(JSON.stringify(value), max)
  return truncate(String(value), max)
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-[var(--ink-4)]">null</span>
  }

  if (typeof value === 'boolean') {
    return <span style={{ color: value ? 'var(--signal)' : 'var(--alert)' }}>{String(value)}</span>
  }

  if (typeof value === 'object') {
    return <span className="text-[var(--info)]">{truncate(JSON.stringify(value), 60)}</span>
  }

  return <>{truncate(String(value), 80)}</>
}

/** Converte o texto do formulário de volta ao tipo esperado pela coluna. */
function parseValue(raw: string, column: TableColumn): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return column.required ? '' : null

  const format = column.format.toLowerCase()

  if (column.type === 'boolean' || format === 'boolean') {
    return trimmed.toLowerCase() === 'true' || trimmed === '1'
  }

  if (
    column.type === 'number' ||
    column.type === 'integer' ||
    /^(bigint|integer|smallint|numeric|real|double|decimal)/.test(format)
  ) {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : trimmed
  }

  if (format.includes('json') || column.type === 'object' || column.type === 'array') {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }

  return trimmed
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

/** Colunas geradas pelo banco não entram no formulário de inserção. */
function isAutoGenerated(column: TableColumn): boolean {
  return (
    column.isPrimaryKey &&
    (/^(bigint|integer|smallint)/.test(column.format.toLowerCase()) || column.format === 'uuid')
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Editor de linha inteira
   ═══════════════════════════════════════════════════════════════════════════ */

function RowEditor({
  open,
  mode,
  project,
  table,
  row,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: 'create' | 'edit'
  project: ProjectWithMeta
  table: TableInfo
  row: Record<string, unknown> | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const editorKey = `${mode}:${row ? JSON.stringify(table.primaryKeys.map((k) => row[k])) : 'new'}`

  if (open && loadedFor !== editorKey) {
    const initial: Record<string, string> = {}
    for (const column of table.columns) {
      initial[column.name] = mode === 'edit' && row ? stringifyValue(row[column.name]) : ''
    }
    setValues(initial)
    setLoadedFor(editorKey)
    setError(null)
  }

  function handleClose() {
    setLoadedFor(null)
    setError(null)
    onClose()
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {}

      for (const column of table.columns) {
        const raw = values[column.name] ?? ''

        if (mode === 'create') {
          if (raw.trim() === '' && isAutoGenerated(column)) continue
          if (raw.trim() === '' && !column.required) continue
          payload[column.name] = parseValue(raw, column)
        } else {
          const original = stringifyValue(row?.[column.name])
          if (raw !== original) payload[column.name] = parseValue(raw, column)
        }
      }

      if (!Object.keys(payload).length) {
        setError('Nenhum campo foi alterado.')
        return
      }

      const body =
        mode === 'create'
          ? { table: table.name, values: payload }
          : {
              table: table.name,
              pk: Object.fromEntries(table.primaryKeys.map((col) => [col, row?.[col]])),
              values: payload,
            }

      const res = await fetch(`/api/projects/${project.id}/rows`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.hint ? `${data.error} (${data.hint})` : data.error))
        return
      }

      toast.success(mode === 'create' ? 'Linha inserida' : 'Linha atualizada')
      setLoadedFor(null)
      onSaved()
    } catch {
      setError('Falha de conexão.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={mode === 'create' ? `Inserir em ${table.name}` : `Editar linha de ${table.name}`}
      description={
        mode === 'edit'
          ? 'Apenas os campos alterados são enviados.'
          : 'Campos vazios em colunas opcionais ficam com o padrão do banco.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {mode === 'create' ? 'Inserir' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="max-h-[55vh] space-y-3.5 overflow-y-auto pr-1">
        {table.columns.map((column) => {
          const longText = /text|json/i.test(column.format)
          const locked = mode === 'edit' && column.isPrimaryKey
          const hint = `${column.format}${locked ? ' · chave primária (não editável)' : ''}`

          return longText ? (
            <Textarea
              key={column.name}
              label={`${column.name}${column.required ? ' *' : ''}`}
              hint={hint}
              value={values[column.name] ?? ''}
              onChange={(e) => setValues((c) => ({ ...c, [column.name]: e.target.value }))}
              disabled={locked}
              rows={3}
              mono
            />
          ) : (
            <Input
              key={column.name}
              label={`${column.name}${column.required ? ' *' : ''}`}
              hint={hint}
              value={values[column.name] ?? ''}
              onChange={(e) => setValues((c) => ({ ...c, [column.name]: e.target.value }))}
              placeholder={mode === 'create' && isAutoGenerated(column) ? 'auto' : 'null'}
              disabled={locked}
              mono
            />
          )
        })}
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="alert">{error}</Alert>
        </div>
      )}
    </Modal>
  )
}
