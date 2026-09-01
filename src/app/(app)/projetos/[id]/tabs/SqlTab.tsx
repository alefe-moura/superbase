'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock, History, Play, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert, Badge, Card, CardHeader, EmptyState } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatNumber, isWriteQuery, timeAgo, truncate } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { ProjectWithMeta, QueryHistoryEntry } from '@/lib/types'

export function SqlTab({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()

  const [sql, setSql] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [history, setHistory] = useState<QueryHistoryEntry[]>([])
  const [confirmWrite, setConfirmWrite] = useState(false)

  const isWrite = isWriteQuery(sql)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/sql`)
      const data = await res.json()
      if (res.ok) setHistory(data.history ?? [])
    } catch {
      // Histórico e acessorio: falhar aqui não atrapalha executar SQL.
    }
  }, [project.id])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  async function execute() {
    setRunning(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(`/api/projects/${project.id}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      })

      const data = await res.json()
      setDuration(data.durationMs ?? null)

      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao executar.'))
        toast.error('SQL falhou', truncate(data.error ?? '', 120))
        return
      }

      setResult(data.rows ?? [])
      toast.success(
        `${formatNumber(data.rowCount)} linha(s)`,
        `Executado em ${data.durationMs} ms`,
      )
    } catch {
      setError('Falha de conexão ao executar o SQL.')
    } finally {
      setRunning(false)
      loadHistory()
    }
  }

  function handleRun() {
    if (!sql.trim()) return
    if (isWrite) setConfirmWrite(true)
    else execute()
  }

  if (!project.has_pat) {
    return (
      <Card>
        <EmptyState
          icon={<Terminal className="h-8 w-8" />}
          title="SQL Runner indisponível"
          description={`Executar SQL exige o token da conta ${project.account_email ?? 'de origem'}. Conecte essa conta na tela de Conexões para liberar esta aba.`}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Terminal className="h-4 w-4" />}
          title="SQL Runner"
          description={`Executa direto no banco de ${project.name}. Trate como produção.`}
          action={
            <Button variant="primary" onClick={handleRun} loading={running} disabled={!sql.trim()}>
              <Play className="h-3.5 w-3.5" />
              Executar
            </Button>
          }
        />

        <div className="p-4">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd + Enter executa, como no editor oficial.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleRun()
              }
            }}
            placeholder="select * from usuários limit 10;"
            spellCheck={false}
            rows={8}
            className="w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--void)] p-3 font-mono text-[13px] leading-relaxed placeholder:text-[var(--ink-4)] focus:border-[var(--signal)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          />

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--ink-4)]">
            <span>Ctrl/Cmd + Enter para executar</span>
            {isWrite && (
              <Badge tone="warn">
                <AlertTriangle className="h-3 w-3" />
                Comando de escrita detectado
              </Badge>
            )}
            {duration != null && (
              <span className="ml-auto flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {duration} ms
              </span>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <Alert tone="alert" title="Erro na execução">
          <span className="font-mono text-[11px] break-words">{error}</span>
        </Alert>
      )}

      {result && <ResultTable rows={result} />}

      {history.length > 0 && (
        <Card>
          <CardHeader icon={<History className="h-4 w-4" />} title="Histórico" />
          <div className="max-h-72 divide-y divide-[var(--line)] overflow-y-auto">
            {history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSql(entry.sql)}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: entry.success ? 'var(--signal)' : 'var(--alert)' }}
                />
                <div className="min-w-0 flex-1">
                  <code className="block truncate font-mono text-xs">
                    {truncate(entry.sql.replace(/\s+/g, ' '), 110)}
                  </code>
                  <span className="text-[11px] text-[var(--ink-4)]">
                    {timeAgo(entry.executed_at)}
                    {entry.duration_ms != null && ` · ${entry.duration_ms} ms`}
                    {entry.success && entry.row_count != null && ` · ${entry.row_count} linha(s)`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmWrite}
        onClose={() => setConfirmWrite(false)}
        onConfirm={async () => {
          setConfirmWrite(false)
          await execute()
        }}
        title="Comando de escrita"
        confirmLabel="Executar mesmo assim"
        message={
          <>
            Este SQL modifica dados ou estrutura no banco de{' '}
            <strong>{project.client?.name ?? project.name}</strong>. Não ha desfazer.
            <div className="mt-3 max-h-32 overflow-y-auto rounded-md bg-[var(--void)] p-2.5 font-mono text-[11px]">
              {sql}
            </div>
          </>
        }
      />
    </div>
  )
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <Card>
        <EmptyState title="Comando executado" description="A consulta não retornou linhas." />
      </Card>
    )
  }

  const columns = Object.keys(rows[0])

  return (
    <Card className="overflow-hidden">
      <CardHeader title={`Resultado, ${formatNumber(rows.length)} linha(s)`} />
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--surface)]">
            <tr className="border-b border-[var(--line)] text-left text-xs">
              {columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap px-3 py-2 font-medium text-[var(--ink-2)]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {rows.map((row, index) => (
              <tr key={index} className="transition-colors hover:bg-[var(--surface-2)]">
                {columns.map((column) => {
                  const value = row[column]
                  return (
                    <td
                      key={column}
                      className="max-w-72 truncate px-3 py-1.5 font-mono text-xs"
                      title={value === null ? 'null' : String(value)}
                    >
                      {value === null || value === undefined ? (
                        <span className="italic text-[var(--ink-4)]">null</span>
                      ) : typeof value === 'object' ? (
                        <span className="text-[var(--info)]">
                          {truncate(JSON.stringify(value), 60)}
                        </span>
                      ) : (
                        truncate(String(value), 80)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
