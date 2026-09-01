'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Cpu,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  MemoryStick,
  Plug,
  RefreshCw,
  Save,
  Server,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Field'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CopyButton,
  HealthBadge,
  Meter,
  Skeleton,
  Stat,
} from '@/components/ui/Primitives'
import { useToast } from '@/components/ui/Toast'
import { cn, formatBytes, formatNumber, SERVICE_LABELS, timeAgo } from '@/lib/utils'
import { humanizeError, humanizeShort } from '@/lib/errors'
import type { Client, Health, ProjectWithMeta, ServiceHealth } from '@/lib/types'

interface Point {
  collected_at: string
  cpu_pct: number | null
  ram_pct: number | null
  disk_pct: number | null
  db_size_bytes: number | null
  active_connections: number | null
}

export function OverviewTab({
  project,
  clients,
}: {
  project: ProjectWithMeta
  clients: Client[]
}) {
  const router = useRouter()
  const toast = useToast()

  const [refreshing, setRefreshing] = useState(false)
  const [history, setHistory] = useState<Point[] | null>(null)
  const [range, setRange] = useState<'24h' | '7d'>('24h')

  const snap = project.latest_snapshot
  const health: Health = snap?.overall_health ?? 'unknown'
  const services = (snap?.health_json ?? []) as ServiceHealth[]

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/snapshot?range=${range}`)
      const data = await res.json()
      if (res.ok) setHistory(data.snapshots ?? [])
    } catch {
      setHistory([])
    }
  }, [project.id, range])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/snapshot`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error('Falha ao atualizar', humanizeShort(data.error))
        return
      }

      if (data.error) toast.warning('Coletado com avisos', humanizeShort(data.error))
      else toast.success('Métricas atualizadas')

      await loadHistory()
      router.refresh()
    } catch {
      toast.error('Falha de conexão ao coletar métricas.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-5 stagger">
      {!project.has_pat && (
        <Alert tone="info" title="Projeto sem token de conta">
          Saúde por serviço, tamanho do banco, SQL Runner e Cron Jobs exigem o token da conta.
          Conecte {project.account_email ? <strong>{project.account_email}</strong> : 'a conta de origem'} em{' '}
          <strong>Conexões</strong> para liberar tudo. Tabelas, Auth e Storage já funcionam.
        </Alert>
      )}

      {/* ─── Faixa de status ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <HealthBadge health={health} />
          <span className="text-[12px] text-[var(--ink-3)]">
            Última coleta {timeAgo(snap?.collected_at)}
          </span>
        </div>

        <Button size="sm" variant="secondary" onClick={handleRefresh} loading={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'spin')} />
          Atualizar agora
        </Button>
      </div>

      {snap?.error && (
        <Alert tone="warn" title="A última coleta teve avisos">
          <ul className="space-y-1.5">
            {snap.error.split(' | ').map((part, i) => {
              // O coletor prefixa a origem: "metricas: ...", "sql: ..."
              const [origem, ...resto] = part.split(': ')
              const bruto = resto.length ? resto.join(': ') : part
              const { message } = humanizeError(bruto)

              return (
                <li key={i} className="leading-relaxed">
                  {resto.length > 0 && (
                    <span className="mr-1.5 font-mono text-[10.5px] uppercase tracking-wider text-[var(--ink-4)]">
                      {origem}
                    </span>
                  )}
                  {message}
                </li>
              )
            })}
          </ul>
        </Alert>
      )}

      {/* ─── Recursos ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ResourceCard
          icon={<Cpu className="h-4 w-4" />}
          title="Processador"
          value={snap?.cpu_pct}
          detail={snap?.load1 != null ? `Carga média (1 min): ${snap.load1.toFixed(2)}` : undefined}
        />
        <ResourceCard
          icon={<MemoryStick className="h-4 w-4" />}
          title="Memória"
          value={snap?.ram_pct}
          detail={
            snap?.ram_total_bytes
              ? `${formatBytes(snap.ram_used_bytes)} de ${formatBytes(snap.ram_total_bytes)}`
              : undefined
          }
        />
        <ResourceCard
          icon={<HardDrive className="h-4 w-4" />}
          title="Disco"
          value={snap?.disk_pct}
          warnAt={80}
          detail={
            snap?.disk_total_bytes
              ? `${formatBytes(snap.disk_used_bytes)} de ${formatBytes(snap.disk_total_bytes)}`
              : undefined
          }
        />
      </div>

      {/* ─── Banco + serviços ──────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Database className="h-4 w-4" />} title="Banco de dados" />
          <div className="grid grid-cols-2 gap-5 px-5 py-4">
            <Stat label="Tamanho" value={formatBytes(snap?.db_size_bytes)} />
            <Stat
              label="Conexões ativas"
              value={
                snap?.active_connections != null
                  ? `${formatNumber(snap.active_connections)}${
                      snap.max_connections ? ` / ${formatNumber(snap.max_connections)}` : ''
                    }`
                  : '·'
              }
            />
            <Stat label="Versão do Postgres" value={project.pg_version ?? '·'} />
            <Stat label="Região" value={project.region ?? '·'} />
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Server className="h-4 w-4" />} title="Serviços" />
          {services.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12px] text-[var(--ink-4)]">
              {project.has_pat
                ? 'Nenhuma leitura de saúde ainda. Use “Atualizar agora”.'
                : 'Requer o token da conta.'}
            </p>
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {services.map((service) => (
                <div
                  key={service.name}
                  className="flex items-center justify-between px-5 py-2.5 text-[13px]"
                >
                  <span className="text-[var(--ink-2)]">
                    {SERVICE_LABELS[service.name] ?? service.name}
                  </span>
                  <Badge tone={service.healthy ? 'signal' : 'alert'}>
                    {service.healthy ? 'Operando' : (service.status ?? 'Falha')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ─── Histórico ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<Activity className="h-4 w-4" />}
          title="Histórico"
          description="A evolução dos recursos ao longo do tempo, algo que o painel oficial não guarda."
          action={
            <div className="flex rounded-lg border border-[var(--line-strong)] p-0.5">
              {(['24h', '7d'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11.5px] transition-colors',
                    range === option
                      ? 'bg-[var(--surface-3)] font-medium text-[var(--ink)]'
                      : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]',
                  )}
                >
                  {option === '24h' ? '24 horas' : '7 dias'}
                </button>
              ))}
            </div>
          }
        />

        <div className="px-5 py-5">
          {history === null ? (
            <Skeleton className="h-52 w-full" />
          ) : history.length < 2 ? (
            <p className="py-14 text-center text-[12.5px] leading-relaxed text-[var(--ink-4)]">
              Ainda não há pontos suficientes para desenhar o gráfico.
              <br />
              Abra a tela Saúde geral ou use “Atualizar agora” para coletar mais pontos.
            </p>
          ) : (
            <div className="space-y-7">
              <ResourceChart history={history} range={range} />
              <DbSizeChart history={history} range={range} />
            </div>
          )}
        </div>
      </Card>

      <KeysCard project={project} />
      <SettingsCard project={project} clients={clients} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cartão de recurso
   ═══════════════════════════════════════════════════════════════════════════ */

function ResourceCard({
  icon,
  title,
  value,
  detail,
  warnAt = 75,
}: {
  icon: React.ReactNode
  title: string
  value: number | null | undefined
  detail?: string
  warnAt?: number
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2 text-[var(--ink-3)]">
        {icon}
        <span className="label">{title}</span>
      </div>
      <Meter value={value} detail={detail} warnAt={warnAt} />
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Gráficos
   ═══════════════════════════════════════════════════════════════════════════ */

function chartLabel(iso: string, range: string): string {
  const date = new Date(iso)
  return range === '7d'
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
}

const AXIS = { fontSize: 10.5, fill: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }

const TOOLTIP = {
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderRadius: '10px',
  fontSize: '12px',
  color: 'var(--ink)',
  boxShadow: '0 12px 40px -12px rgba(0,0,0,0.8)',
  fontFamily: 'var(--font-sans)',
}

const SERIES = [
  { key: 'CPU', color: '#62B6FF' },
  { key: 'RAM', color: '#C08CFF' },
  { key: 'Disco', color: '#F2B544' },
]

function ResourceChart({ history, range }: { history: Point[]; range: string }) {
  const data = history.map((p) => ({
    time: chartLabel(p.collected_at, range),
    CPU: p.cpu_pct != null ? Number(p.cpu_pct.toFixed(1)) : null,
    RAM: p.ram_pct != null ? Number(p.ram_pct.toFixed(1)) : null,
    Disco: p.disk_pct != null ? Number(p.disk_pct.toFixed(1)) : null,
  }))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="label">Uso de recursos (%)</p>
        <div className="flex gap-4">
          {SERIES.map((s) => (
            <span
              key={s.key}
              className="flex items-center gap-1.5 text-[11px] text-[var(--ink-3)]"
            >
              <span className="h-[3px] w-3 rounded-full" style={{ background: s.color }} />
              {s.key}
            </span>
          ))}
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={false} minTickGap={44} />
            <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              contentStyle={TOOLTIP}
              cursor={{ stroke: 'var(--line-glow)', strokeWidth: 1 }}
              formatter={(value) => [`${value}%`, '']}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function DbSizeChart({ history, range }: { history: Point[]; range: string }) {
  const points = history.filter((p) => p.db_size_bytes != null)
  if (points.length < 2) return null

  const data = points.map((p) => ({
    time: chartLabel(p.collected_at, range),
    size: Number(((p.db_size_bytes ?? 0) / 1024 / 1024).toFixed(1)),
  }))

  return (
    <div>
      <p className="label mb-3">Tamanho do banco (MB)</p>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="dbGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--signal)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--signal)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={false} minTickGap={44} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={46} />
            <Tooltip
              contentStyle={TOOLTIP}
              cursor={{ stroke: 'var(--line-glow)', strokeWidth: 1 }}
              formatter={(value) => [`${value} MB`, 'Tamanho']}
            />
            <Area
              type="monotone"
              dataKey="size"
              stroke="var(--signal)"
              strokeWidth={1.75}
              fill="url(#dbGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Credenciais
   ═══════════════════════════════════════════════════════════════════════════ */

interface RevealedKeys {
  anon_key: string | null
  publishable_key: string | null
  service_key: string | null
  db_url: string | null
  url: string
  access_token: string | null
}

function KeysCard({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()
  const [keys, setKeys] = useState<RevealedKeys | null>(null)
  const [loading, setLoading] = useState(false)

  async function reveal() {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/keys`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error('Falha ao revelar as chaves', humanizeShort(data.error))
        return
      }

      setKeys(data)
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Plug className="h-4 w-4" />}
        title="Credenciais"
        description="Revelar uma chave é uma ação registrada na auditoria."
        action={
          keys ? (
            <Button size="sm" variant="ghost" onClick={() => setKeys(null)}>
              <EyeOff className="h-3.5 w-3.5" />
              Ocultar
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={reveal} loading={loading}>
              <Eye className="h-3.5 w-3.5" />
              Revelar chaves
            </Button>
          )
        }
      />

      <div className="divide-y divide-[var(--line)]">
        <SecretRow label="URL do projeto" value={project.url} visible />
        <SecretRow label="anon key" value={keys?.anon_key ?? null} visible={Boolean(keys)} />
        <SecretRow
          label="publishable key"
          value={keys?.publishable_key ?? null}
          visible={Boolean(keys)}
          missingHint="Este projeto ainda só tem as chaves legadas. Crie as novas no painel da Supabase, em Settings › API Keys."
        />
        <SecretRow
          label="service_role key"
          value={keys?.service_key ?? null}
          visible={Boolean(keys)}
          critical
        />
        <SecretRow
          label="Connection string"
          value={keys?.db_url ?? null}
          visible={Boolean(keys)}
          critical
        />
        <SecretRow
          label="access token"
          value={keys?.access_token ?? null}
          visible={Boolean(keys)}
          critical
          criticalHint="Vale para a conta inteira na Supabase, não só para este projeto."
          missingHint="Só existe em projetos vindos de uma conta conectada. Conecte a conta em Conexões."
        />
      </div>
    </Card>
  )
}

function SecretRow({
  label,
  value,
  visible,
  critical,
  criticalHint,
  missingHint,
}: {
  label: string
  value: string | null
  visible?: boolean
  critical?: boolean
  /** Texto do ponto vermelho, por que esta credencial é perigosa. */
  criticalHint?: string
  /** Explica a ausência quando a credencial foi revelada mas não existe. */
  missingHint?: string
}) {
  const empty = visible && !value

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="flex w-44 shrink-0 items-center gap-1.5">
        <span className="label">{label}</span>
        {critical && (
          <span
            className="h-1 w-1 shrink-0 rounded-full"
            style={{ background: 'var(--alert)' }}
            title={criticalHint ?? 'Credencial de acesso total'}
          />
        )}
      </span>

      {empty && missingHint ? (
        <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--ink-4)]">
          {missingHint}
        </span>
      ) : (
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded-md bg-[var(--void)] px-2.5 py-1.5 font-mono text-[11.5px]',
            visible && value ? 'text-[var(--ink-2)]' : 'text-[var(--ink-4)]',
          )}
        >
          {visible ? (value ?? '·') : '••••••••••••••••••••••••••••••••'}
        </code>
      )}

      {visible && value && <CopyButton value={value} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Configurações
   ═══════════════════════════════════════════════════════════════════════════ */

function SettingsCard({ project, clients }: { project: ProjectWithMeta; clients: Client[] }) {
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState(project.name)
  const [clientId, setClientId] = useState(project.client_id ?? '')
  const [accountEmail, setAccountEmail] = useState(project.account_email ?? '')
  const [notes, setNotes] = useState(project.notes ?? '')
  const [saving, setSaving] = useState(false)

  const dirty =
    name !== project.name ||
    clientId !== (project.client_id ?? '') ||
    accountEmail !== (project.account_email ?? '') ||
    notes !== (project.notes ?? '')

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          client_id: clientId || null,
          account_email: accountEmail || null,
          notes,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error('Falha ao salvar', humanizeShort(data.error))
        return
      }

      toast.success('Projeto atualizado')
      router.refresh()
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Configurações do projeto" />

      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Select label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label="E-mail da conta (etiqueta)"
          type="email"
          value={accountEmail}
          onChange={(e) => setAccountEmail(e.target.value)}
          hint="Aparece como etiqueta no cartão e no cabeçalho deste projeto."
        />

        <Textarea
          label="Notas"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Observações internas sobre este projeto…"
        />

        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!dirty}>
            <Save className="h-4 w-4" />
            Salvar alterações
          </Button>
        </div>
      </div>
    </Card>
  )
}
