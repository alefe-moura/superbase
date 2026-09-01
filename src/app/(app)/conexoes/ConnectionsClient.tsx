'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  Modal,
} from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, DEFAULT_REGION, SUPABASE_REGIONS, timeAgo } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { Client } from '@/lib/types'
import type { AccountRow } from './page'

interface ManualProject {
  id: string
  name: string
  url: string
  account_email: string | null
  created_at: string
}

interface PreviewProject {
  ref: string
  name: string
  region: string
  status: string
}

interface Organization {
  slug: string
  name: string
}

export function ConnectionsClient({
  accounts,
  clients,
  manualProjects,
}: {
  accounts: AccountRow[]
  clients: Client[]
  manualProjects: ManualProject[]
}) {
  const [accountModal, setAccountModal] = useState(false)
  const [manualModal, setManualModal] = useState(false)

  return (
    <div className="space-y-5 stagger">
      {/* ─── Os dois caminhos ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PathCard
          onClick={() => setAccountModal(true)}
          icon={<KeyRound className="h-5 w-5" />}
          title="Conectar uma conta"
          description="Cole o token pessoal (PAT) e importe todos os projetos daquela conta de uma vez, com as chaves buscadas automaticamente."
          cta="Conectar conta"
          recommended
        />

        <PathCard
          onClick={() => setManualModal(true)}
          icon={<Link2 className="h-5 w-5" />}
          title="Conectar projeto avulso"
          description="Cadastre um projeto individualmente com URL e chaves. Use quando não tiver o token da conta."
          cta="Cadastrar manualmente"
        />
      </div>

      <AccountsList accounts={accounts} clients={clients} />
      <ManualList projects={manualProjects} />

      <ConnectAccountModal open={accountModal} onClose={() => setAccountModal(false)} />
      <ManualProjectModal
        open={manualModal}
        onClose={() => setManualModal(false)}
        clients={clients}
      />
    </div>
  )
}

function PathCard({
  onClick,
  icon,
  title,
  description,
  cta,
  recommended,
}: {
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
  cta: string
  recommended?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl border p-6 text-left transition-all duration-200',
        recommended
          ? 'border-[color-mix(in_srgb,var(--signal)_32%,transparent)] bg-[color-mix(in_srgb,var(--signal)_5%,var(--surface))] hover:border-[var(--signal)]'
          : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-glow)]',
      )}
    >
      {recommended && (
        <span className="absolute right-4 top-4">
          <Badge tone="signal">Recomendado</Badge>
        </span>
      )}

      <div
        className={cn(
          'mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors',
          recommended
            ? 'border-[color-mix(in_srgb,var(--signal)_35%,transparent)] bg-[color-mix(in_srgb,var(--signal)_12%,transparent)] text-[var(--signal)]'
            : 'border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--ink-3)] group-hover:text-[var(--ink-2)]',
        )}
      >
        {icon}
      </div>

      <h3 className="font-display text-[16px] font-semibold tracking-[-0.025em]">{title}</h3>

      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--ink-3)]">{description}</p>

      <span
        className={cn(
          'mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium',
          recommended ? 'text-[var(--signal)]' : 'text-[var(--ink-2)]',
        )}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
      </span>
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Contas conectadas
   ═══════════════════════════════════════════════════════════════════════════ */

function AccountsList({ accounts, clients }: { accounts: AccountRow[]; clients: Client[] }) {
  const router = useRouter()
  const toast = useToast()
  const [syncing, setSyncing] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<AccountRow | null>(null)
  const [toCreateIn, setToCreateIn] = useState<AccountRow | null>(null)

  async function handleSync(account: AccountRow) {
    setSyncing(account.id)
    try {
      const res = await fetch(`/api/accounts/${account.id}/sync`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error('Falha ao ressincronizar', humanizeShort(data.error))
        return
      }

      const parts: string[] = []
      if (data.added?.length) parts.push(`${data.added.length} novo(s)`)
      if (data.updated?.length) parts.push(`${data.updated.length} atualizado(s)`)
      if (data.missing?.length) parts.push(`${data.missing.length} sumiu(ram) da conta`)

      toast.success('Conta ressincronizada', parts.join(' · ') || 'Nada mudou.')
      router.refresh()
    } catch {
      toast.error('Falha de conexão ao ressincronizar.')
    } finally {
      setSyncing(null)
    }
  }

  async function handleDelete() {
    if (!toDelete) return

    const res = await fetch(`/api/accounts/${toDelete.id}`, { method: 'DELETE' })
    const data = await res.json()

    if (!res.ok) {
      toast.error('Falha ao remover', humanizeShort(data.error))
      return
    }

    toast.success('Conta removida', 'Os projetos dela continuam conectados pelas chaves.')
    setToDelete(null)
    router.refresh()
  }

  return (
    <>
      <Card>
        <CardHeader
          icon={<UserRound className="h-4 w-4" />}
          title="Contas conectadas"
          description={
            accounts.length > 0
              ? 'O token permite sincronizar projetos, criar projetos novos, rodar SQL, agendar Cron Jobs e ler a saúde.'
              : undefined
          }
        />

        {accounts.length === 0 ? (
          <EmptyState
            compact
            icon={<KeyRound className="h-5 w-5" />}
            title="Nenhuma conta conectada"
            description="Conecte uma conta com o token pessoal para importar os projetos automaticamente."
          />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {accounts.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-[13px] font-medium">
                      {account.login_email}
                    </span>
                    {account.alias && <Badge>{account.alias}</Badge>}
                    {account.status === 'invalid' ? (
                      <Badge tone="alert">
                        <AlertCircle className="h-3 w-3" />
                        Token inválido
                      </Badge>
                    ) : (
                      <Badge tone="signal">
                        <Check className="h-3 w-3" />
                        Ativa
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1.5 text-[11.5px] text-[var(--ink-3)]">
                    <span className="font-mono tabular-nums text-[var(--ink-2)]">
                      {account.project_count}
                    </span>{' '}
                    {account.project_count === 1 ? 'projeto' : 'projetos'} · sincronizada{' '}
                    {timeAgo(account.last_sync_at)}
                    {account.last_error && (
                      <span className="text-[var(--alert)]"> · {account.last_error}</span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setToCreateIn(account)}>
                    <Plus className="h-3.5 w-3.5" />
                    Criar projeto
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleSync(account)}
                    loading={syncing === account.id}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', syncing === account.id && 'spin')} />
                    Ressincronizar
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setToDelete(account)}
                    title="Remover conta"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <CreateProjectModal
        account={toCreateIn}
        clients={clients}
        onClose={() => setToCreateIn(null)}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Remover conta"
        confirmLabel="Remover conta"
        message={
          <>
            O token de <strong className="text-[var(--ink)]">{toDelete?.login_email}</strong> será
            apagado do cofre.
            <br />
            <br />
            Os {toDelete?.project_count}{' '}
            {toDelete?.project_count === 1 ? 'projeto importado continua' : 'projetos importados continuam'}{' '}
            na carteira e seguem funcionando pelas chaves salvas, mas perdem SQL Runner, Cron Jobs,
            saúde e ressincronização até você reconectar a conta.
          </>
        }
      />
    </>
  )
}

function ManualList({ projects }: { projects: ManualProject[] }) {
  if (!projects.length) return null

  return (
    <Card>
      <CardHeader
        icon={<Link2 className="h-4 w-4" />}
        title="Projetos avulsos"
        description="Cadastrados manualmente, sem token de conta."
      />
      <div className="divide-y divide-[var(--line)]">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/projetos/${project.id}`}
            className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--surface-2)]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium transition-colors group-hover:text-[var(--signal)]">
                {project.name}
              </p>
              <p className="truncate font-mono text-[11px] text-[var(--ink-4)]">{project.url}</p>
            </div>
            {project.account_email && <Badge mono>{project.account_email}</Badge>}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-4)] transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Modal: conectar conta via PAT
   ═══════════════════════════════════════════════════════════════════════════ */

function ConnectAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [alias, setAlias] = useState('')
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewProject[] | null>(null)
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function reset() {
    setEmail('')
    setAlias('')
    setPat('')
    setPreview(null)
    setOrgs([])
    setSelected(new Set())
    setError(null)
    onClose()
  }

  async function handlePreview(event?: React.FormEvent) {
    event?.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_email: email, pat, alias, previewOnly: true }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Não foi possível validar o token.'))
        return
      }

      setPreview(data.projects)
      setOrgs(data.organizations ?? [])
      setSelected(new Set(data.projects.map((p: PreviewProject) => p.ref)))
    } catch {
      setError('Falha de conexão ao validar o token.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_email: email, pat, alias, refs: Array.from(selected) }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao importar os projetos.'))
        return
      }

      if (data.imported.length === 0) {
        toast.success(
          'Conta conectada',
          'Nenhum projeto importado. Use “Criar projeto” para abrir o primeiro.',
        )
      } else {
        toast.success(
          `${data.imported.length} ${data.imported.length === 1 ? 'projeto conectado' : 'projetos conectados'}`,
          data.failed?.length ? `${data.failed.length} falhou(aram).` : undefined,
        )
      }
      reset()
      router.refresh()
    } catch {
      setError('Falha de conexão ao importar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="Conectar uma conta Supabase"
      description={
        preview
          ? preview.length
            ? 'Escolha quais projetos importar para a carteira.'
            : 'Conta sem projetos. Conecte assim mesmo e crie o primeiro daqui.'
          : 'O token é criptografado antes de ser salvo e nunca sai do servidor.'
      }
      size="lg"
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={loading}>
              Voltar
            </Button>
            <Button variant="primary" onClick={handleImport} loading={loading}>
              {selected.size === 0
                ? 'Conectar conta'
                : `Importar ${selected.size} ${selected.size === 1 ? 'projeto' : 'projetos'}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={reset} disabled={loading}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => handlePreview()} loading={loading}>
              Validar e listar projetos
            </Button>
          </>
        )
      }
    >
      {preview && preview.length === 0 ? (
        <div className="space-y-3">
          <Alert tone="info" title="Token válido, conta sem nenhum projeto">
            Nada para importar agora. A conta entra na carteira do mesmo jeito e o token fica
            guardado, depois é só usar <strong>Criar projeto</strong> na linha dela para abrir o
            primeiro projeto direto daqui.
          </Alert>

          {orgs.length > 0 && (
            <div className="rounded-lg border border-[var(--line)] px-4 py-3">
              <p className="label mb-2">
                {orgs.length === 1 ? 'Organização encontrada' : 'Organizações encontradas'}
              </p>
              <ul className="space-y-1">
                {orgs.map((org) => (
                  <li
                    key={org.slug}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <span className="truncate text-[var(--ink-2)]">{org.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--ink-4)]">
                      {org.slug}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {orgs.length === 0 && (
            <Alert tone="warn">
              Nenhuma organização nesta conta. Crie uma no painel da Supabase antes, um projeto
              precisa nascer dentro de uma.
            </Alert>
          )}

          {error && <Alert tone="alert">{error}</Alert>}
        </div>
      ) : preview ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[var(--ink-3)]">
              <span className="font-mono tabular-nums text-[var(--ink)]">{preview.length}</span>{' '}
              {preview.length === 1 ? 'projeto encontrado' : 'projetos encontrados'} em{' '}
              <span className="font-mono">{email}</span>
            </p>

            <button
              type="button"
              onClick={() =>
                setSelected(
                  selected.size === preview.length
                    ? new Set()
                    : new Set(preview.map((p) => p.ref)),
                )
              }
              className="text-[12px] font-medium text-[var(--signal)] hover:underline"
            >
              {selected.size === preview.length ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          </div>

          <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
            {preview.map((project) => (
              <Checkbox
                key={project.ref}
                checked={selected.has(project.ref)}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(project.ref)) next.delete(project.ref)
                    else next.add(project.ref)
                    return next
                  })
                }
                label={
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{project.name}</span>
                    <Badge tone={project.status === 'ACTIVE_HEALTHY' ? 'signal' : 'neutral'}>
                      {project.status === 'ACTIVE_HEALTHY' ? 'Ativo' : project.status}
                    </Badge>
                  </span>
                }
                description={
                  <span className="font-mono">
                    {project.ref} · {project.region}
                  </span>
                }
              />
            ))}
          </div>

          {error && <Alert tone="alert">{error}</Alert>}
        </div>
      ) : (
        <form onSubmit={handlePreview} className="space-y-4">
          <Input
            label="E-mail do login desta conta"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cliente@gmail.com"
            hint="Vira a etiqueta de origem exibida em cada projeto importado."
            required
            autoFocus
          />

          <Input
            label="Apelido (opcional)"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="Conta do cliente X"
          />

          <Input
            label="Personal Access Token"
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="sbp_…"
            mono
            required
          />

          <Alert tone="info">
            Gere o token em{' '}
            <a
              href="https://supabase.com/dashboard/account/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded bg-[var(--void)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--signal)] underline decoration-[color-mix(in_srgb,var(--signal)_45%,transparent)] underline-offset-2 transition-colors hover:decoration-[var(--signal)]"
            >
              supabase.com/dashboard/account/tokens
              <ExternalLink className="h-3 w-3" />
            </a>{' '}
            logado nesta conta. Ele dá acesso a listagem de projetos, chaves, saúde e SQL.
          </Alert>

          {error && <Alert tone="alert">{error}</Alert>}
        </form>
      )}
    </Modal>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Modal: projeto avulso
   ═══════════════════════════════════════════════════════════════════════════ */

function ManualProjectModal({
  open,
  onClose,
  clients,
}: {
  open: boolean
  onClose: () => void
  clients: Client[]
}) {
  const router = useRouter()
  const toast = useToast()

  const empty = {
    name: '',
    url: '',
    service_key: '',
    anon_key: '',
    publishable_key: '',
    db_url: '',
    account_email: '',
    client_id: '',
    notes: '',
  }

  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  function reset() {
    setForm(empty)
    setError(null)
    onClose()
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, client_id: form.client_id || null }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao conectar o projeto.'))
        return
      }

      toast.success('Projeto conectado', 'Credenciais validadas e salvas no cofre.')
      reset()
      router.push(`/projetos/${data.id}`)
    } catch {
      setError('Falha de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="Conectar projeto avulso"
      description="As credenciais são testadas de verdade antes de salvar."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={reset} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => handleSubmit()} loading={loading}>
            Validar e conectar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome do projeto"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="App do Cliente X"
          required
          autoFocus
        />

        <Input
          label="URL do projeto"
          value={form.url}
          onChange={(e) => set('url', e.target.value)}
          placeholder="https://abcdefghijklm.supabase.co"
          mono
          required
        />

        <Input
          label="service_role key"
          type="password"
          value={form.service_key}
          onChange={(e) => set('service_key', e.target.value)}
          placeholder="eyJhbGciOi…"
          hint="Dá acesso total ao banco. É criptografada antes de sair da requisição."
          mono
          required
        />

        <Input
          label="anon key (opcional)"
          type="password"
          value={form.anon_key}
          onChange={(e) => set('anon_key', e.target.value)}
          placeholder="eyJhbGciOi…"
          mono
        />

        <Input
          label="publishable key (opcional)"
          type="password"
          value={form.publishable_key}
          onChange={(e) => set('publishable_key', e.target.value)}
          placeholder="sb_publishable_…"
          hint="A chave nova do cliente, que substitui a anon. Fica em Settings › API Keys."
          mono
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="E-mail da conta (etiqueta)"
            type="email"
            value={form.account_email}
            onChange={(e) => set('account_email', e.target.value)}
            placeholder="cliente@gmail.com"
          />

          <Select
            label="Cliente"
            value={form.client_id}
            onChange={(e) => set('client_id', e.target.value)}
          >
            <option value="">Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label="Connection string do Postgres (opcional)"
          type="password"
          value={form.db_url}
          onChange={(e) => set('db_url', e.target.value)}
          placeholder="postgresql://postgres:…@db.xxx.supabase.co:5432/postgres"
          mono
        />

        <Textarea
          label="Notas (opcional)"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Observações sobre este projeto…"
          rows={2}
        />

        <Alert tone="warn">
          Sem o token da conta, este projeto não terá SQL Runner, Cron Jobs nem monitoramento de
          saúde por serviço, apenas tabelas, Auth, Storage e métricas de recurso.
        </Alert>

        {error && <Alert tone="alert">{error}</Alert>}
      </form>
    </Modal>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Criar projeto novo dentro de uma conta
   ═══════════════════════════════════════════════════════════════════════════ */

interface CreatedProject {
  id: string
  ref: string
  url: string
  name: string
  db_pass: string
  keys_ready: boolean
}

function CreateProjectModal({
  account,
  clients,
  onClose,
}: {
  account: AccountRow | null
  clients: Client[]
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [region, setRegion] = useState(DEFAULT_REGION)
  const [clientId, setClientId] = useState('')
  const [dbPass, setDbPass] = useState('')
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedProject | null>(null)

  const accountId = account?.id ?? null

  // As organizações vêm da Supabase na hora de abrir: é dentro de uma delas
  // que o projeto nasce, e elas mudam de nome e de plano fora daqui.
  useEffect(() => {
    if (!accountId) return

    let alive = true
    setOrgs(null)

    fetch(`/api/accounts/${accountId}/organizations`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!alive) return

        if (!ok) {
          setError(humanizeShort(data.error ?? 'Falha ao carregar as organizações.'))
          setOrgs([])
          return
        }

        setOrgs(data.organizations ?? [])
        setOrgSlug((current) => current || (data.organizations?.[0]?.slug ?? ''))
      })
      .catch(() => {
        if (!alive) return
        setError('Falha de conexão ao carregar as organizações.')
        setOrgs([])
      })

    return () => {
      alive = false
    }
  }, [accountId])

  function close() {
    setName('')
    setOrgSlug('')
    setRegion(DEFAULT_REGION)
    setClientId('')
    setDbPass('')
    setOrgs(null)
    setError(null)
    setCreated(null)
    onClose()
  }

  async function handleCreate(event?: React.FormEvent) {
    event?.preventDefault()
    if (!account) return

    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/accounts/${account.id}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          organization_slug: orgSlug,
          region,
          client_id: clientId || null,
          db_pass: dbPass.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao criar o projeto.'))
        return
      }

      setCreated(data)
      toast.success(
        'Projeto criado na Supabase',
        data.keys_ready
          ? 'Chaves já guardadas no cofre.'
          : 'As chaves entram assim que ele terminar de subir.',
      )
      router.refresh()
    } catch {
      setError('Falha de conexão ao criar o projeto.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={Boolean(account)}
      onClose={close}
      title={created ? 'Projeto criado' : 'Criar projeto na Supabase'}
      description={
        created
          ? 'Guarde a senha do banco agora, ela não aparece de novo.'
          : `O projeto nasce dentro de uma organização de ${account?.login_email ?? 'conta'} e já entra na carteira.`
      }
      size="lg"
      footer={
        created ? (
          <>
            <Button variant="ghost" onClick={close}>
              Fechar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const id = created.id
                close()
                router.push(`/projetos/${id}`)
              }}
            >
              Abrir projeto
              <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={loading}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => handleCreate()}
              loading={loading}
              disabled={!name.trim() || !orgSlug}
            >
              Criar projeto
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <Alert tone="signal" title={created.name}>
            <span className="font-mono text-[11.5px]">{created.url}</span>
          </Alert>

          <div>
            <p className="label mb-1.5">Senha do banco</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-[var(--void)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--ink-2)]">
                {created.db_pass}
              </code>
              <CopyButton value={created.db_pass} />
            </div>
          </div>

          <Alert tone="warn" title="Esta é a única vez que ela aparece">
            Nem a Supabase nem este painel conseguem mostrar a senha de novo, o que existe daqui
            para frente é a connection string guardada no cofre, em Credenciais. Perdendo as duas, o
            caminho é resetar a senha no painel da Supabase.
          </Alert>

          {!created.keys_ready && (
            <Alert tone="info" title="O projeto ainda está subindo">
              As chaves ainda não existiam quando perguntamos. Elas entram no cofre no próximo{' '}
              <strong>Ressincronizar</strong> da conta, normalmente um ou dois minutos depois.
            </Alert>
          )}
        </div>
      ) : (
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Nome do projeto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="App do Cliente X"
            required
            autoFocus
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Organização"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              disabled={orgs === null || orgs.length === 0}
              hint={
                orgs === null
                  ? 'Carregando as organizações da conta…'
                  : orgs.length === 0
                    ? 'Nenhuma organização nesta conta.'
                    : undefined
              }
            >
              {orgs === null ? (
                <option value="">Carregando…</option>
              ) : orgs.length === 0 ? (
                <option value="">Nenhuma organização</option>
              ) : (
                orgs.map((org) => (
                  <option key={org.slug} value={org.slug}>
                    {org.name}
                  </option>
                ))
              )}
            </Select>

            <Select label="Região" value={region} onChange={(e) => setRegion(e.target.value)}>
              {SUPABASE_REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>

          <Select label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          <Input
            label="Senha do banco (opcional)"
            type="password"
            value={dbPass}
            onChange={(e) => setDbPass(e.target.value)}
            placeholder="deixe em branco para gerar uma forte"
            hint="Em branco, geramos uma senha aleatória e mostramos uma vez ao final."
            mono
          />

          <Alert tone="warn" title="Isto cria um projeto de verdade">
            O projeto nasce na Supabase e passa a contar nos limites e na fatura da organização
            escolhida. Em organização do plano gratuito, o terceiro projeto é recusado; em
            organização paga, ele gera custo.
          </Alert>

          {error && <Alert tone="alert">{error}</Alert>}
        </form>
      )}
    </Modal>
  )
}
