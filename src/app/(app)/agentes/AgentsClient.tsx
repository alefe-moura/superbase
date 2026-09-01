'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Bot,
  Check,
  Copy,
  Database,
  FolderPlus,
  KeyRound,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Textarea } from '@/components/ui/Field'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  Modal,
  Skeleton,
} from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { cn, formatNumber, timeAgo } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { Project } from '@/lib/types'

interface AgentToken {
  id: string
  name: string
  token_prefix: string
  project_ids: string[]
  can_write: boolean
  can_ddl: boolean
  can_manage_projects: boolean
  last_used_at: string | null
  call_count: number
  can_read_secrets: boolean
  revoked_at: string | null
  created_at: string
  notes: string | null
  uso_24h: { total: number; erros: number }
}

type ProjectRef = Pick<Project, 'id' | 'name'>

export function AgentsClient({ projects }: { projects: ProjectRef[] }) {
  const toast = useToast()

  const [tokens, setTokens] = useState<AgentToken[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AgentToken | null>(null)
  const [toRevoke, setToRevoke] = useState<AgentToken | null>(null)
  const [novoToken, setNovoToken] = useState<{ nome: string; token: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      if (res.ok) setTokens(data.tokens)
      else setTokens([])
    } catch {
      setTokens([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function revoke() {
    if (!toRevoke) return

    const res = await fetch('/api/agents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: toRevoke.id }),
    })
    const data = await res.json()

    if (!res.ok) {
      toast.error('Falha ao revogar', humanizeShort(data.error))
      return
    }

    toast.success('Agente revogado', 'O token para de funcionar imediatamente.')
    setToRevoke(null)
    load()
  }

  const ativos = (tokens ?? []).filter((t) => !t.revoked_at)
  const revogados = (tokens ?? []).filter((t) => t.revoked_at)

  return (
    <div className="space-y-5">
      <ConnectionCard hasTokens={ativos.length > 0} />

      <Card>
        <CardHeader
          icon={<Bot className="h-4 w-4" />}
          title="Agentes conectados"
          description="Cada agente tem seu próprio token, com escopo e permissão independentes."
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              Novo agente
            </Button>
          }
        />

        {!tokens ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : ativos.length === 0 ? (
          <EmptyState
            compact
            icon={<Bot className="h-5 w-5" />}
            title="Nenhum agente conectado"
            description="Crie um token para dar aos seus agentes acesso controlado aos projetos."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Criar o primeiro agente
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {ativos.map((t) => (
              <div key={t.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[14px] font-semibold tracking-[-0.02em]">
                      {t.name}
                    </span>

                    {t.can_ddl ? (
                      <Badge tone="alert">
                        <Database className="h-2.5 w-2.5" />
                        Altera estrutura
                      </Badge>
                    ) : t.can_write ? (
                      <Badge tone="warn">
                        <Pencil className="h-2.5 w-2.5" />
                        Leitura e escrita
                      </Badge>
                    ) : (
                      <Badge tone="signal">Somente leitura</Badge>
                    )}

                    {t.can_manage_projects && (
                      <Badge tone="alert">
                        <FolderPlus className="h-2.5 w-2.5" />
                        Gerencia projetos
                      </Badge>
                    )}

                    {t.can_read_secrets && (
                      <Badge tone="alert">
                        <ShieldAlert className="h-2.5 w-2.5" />
                        Lê credenciais
                      </Badge>
                    )}

                    <Badge mono>{t.token_prefix}…</Badge>
                  </div>

                  <p className="mt-1.5 text-[12px] text-[var(--ink-3)]">
                    {t.project_ids.length === 0 ? (
                      <span className="text-[var(--warn)]">Alcança todos os projetos</span>
                    ) : (
                      <>
                        {t.project_ids.length} projeto(s):{' '}
                        {t.project_ids
                          .map((id) => projects.find((p) => p.id === id)?.name ?? '?')
                          .join(', ')}
                      </>
                    )}
                  </p>

                  <p className="mt-1 font-mono text-[11px] text-[var(--ink-4)]">
                    {t.last_used_at ? `usado ${timeAgo(t.last_used_at)}` : 'nunca usado'}
                    {t.uso_24h.total > 0 && (
                      <>
                        {' · '}
                        {formatNumber(t.uso_24h.total)} chamadas em 24h
                        {t.uso_24h.erros > 0 && (
                          <span className="text-[var(--warn)]"> ({t.uso_24h.erros} com erro)</span>
                        )}
                      </>
                    )}
                  </p>

                  {t.notes && (
                    <p className="mt-1.5 text-[11.5px] text-[var(--ink-3)]">{t.notes}</p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Escopo
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setToRevoke(t)} title="Revogar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {revogados.length > 0 && (
          <div className="border-t border-[var(--line)] px-5 py-3">
            <p className="label mb-2">Revogados</p>
            <div className="flex flex-wrap gap-1.5">
              {revogados.map((t) => (
                <Badge key={t.id} className="opacity-60">
                  {t.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Alert tone="warn" title="O que continua valendo, mesmo para um agente com tudo ligado">
        Operações que apagam (<code className="font-mono text-[11px]">DROP</code>,{' '}
        <code className="font-mono text-[11px]">TRUNCATE</code>,{' '}
        <code className="font-mono text-[11px]">DELETE</code> ou{' '}
        <code className="font-mono text-[11px]">UPDATE</code> sem{' '}
        <code className="font-mono text-[11px]">WHERE</code>, apagar arquivo ou usuário) só passam
        quando a própria chamada traz <code className="font-mono text-[11px]">confirmar: true</code>
        . Um agente sequestrado por um texto gravado numa linha não atravessa essa porta sem
        declarar, ali mesmo, que está apagando de propósito.
        <br />
        <br />
        Comandos que saem do banco e alcançam o servidor, ler arquivo, executar programa,{' '}
        <code className="font-mono text-[11px]">ALTER SYSTEM</code>: são bloqueados sempre, e
        nenhuma permissão libera. Tudo que altera fica na auditoria com o nome do agente.
      </Alert>

      <CreateModal
        open={creating}
        projects={projects}
        onClose={() => setCreating(false)}
        onCreated={(nome, token) => {
          setCreating(false)
          setNovoToken({ nome, token })
          load()
        }}
      />

      <ScopeModal
        token={editing}
        projects={projects}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />

      <TokenRevealModal token={novoToken} onClose={() => setNovoToken(null)} />

      <ConfirmDialog
        open={Boolean(toRevoke)}
        onClose={() => setToRevoke(null)}
        onConfirm={revoke}
        title="Revogar agente"
        confirmLabel="Revogar"
        message={
          <>
            O token de <strong className="text-[var(--ink)]">{toRevoke?.name}</strong> para de
            funcionar imediatamente, e qualquer agente usando ele perde o acesso na próxima chamada.
            <br />
            <br />
            O histórico de chamadas é preservado, para você conseguir revisar o que ele fez.
          </>
        }
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Como conectar
   ═══════════════════════════════════════════════════════════════════════════ */

/** O formato exato que o campo de cabeçalho espera. O espaço depois de Bearer é obrigatório. */
const VALOR_DO_CABECALHO = 'Bearer SEU_TOKEN_AQUI'

function ConnectionCard({ hasTokens }: { hasTokens: boolean }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    setUrl(`${window.location.origin}/api/mcp`)
  }, [])

  const base = url || 'https://SEU-DOMINIO/api/mcp'


  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<KeyRound className="h-4 w-4" />}
        title="Como conectar um agente"
        description="Um endereço só, para todos os projetos da carteira."
      />

      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="label mb-2">Endereço do servidor</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-[var(--void)] px-3 py-2 font-mono text-[12px] text-[var(--signal)]">
              {url || '…'}
            </code>
            {url && <CopyButton value={url} label="Copiar" />}
          </div>
        </div>

        {/*
          O passo a passo do conector personalizado do claude.ai.

          A ordem aqui e a ordem da tela do Claude, para a pessoa conferir
          campo por campo sem traduzir nada. O passo do cabecalho vem com o
          valor pronto para copiar porque o erro mais comum e colar o token
          sem o "Bearer " na frente: o servidor casa contra /^Bearer\s+(.+)$/i
          e devolve 401, e o painel do Claude nunca reexibe o valor guardado,
          entao nao ha como conferir depois.
        */}
        <div>
          <p className="label mb-2">Conectar no Claude</p>

          <ol className="space-y-2 text-[12px] leading-relaxed text-[var(--ink-3)]">
            <li>
              <strong className="text-[var(--ink-2)]">1.</strong> No Claude, abra{' '}
              <strong className="text-[var(--ink-2)]">Personalizar</strong>, aba{' '}
              <strong className="text-[var(--ink-2)]">Conectores</strong>, botão{' '}
              <strong className="text-[var(--ink-2)]">Adicionar</strong>, depois{' '}
              <strong className="text-[var(--ink-2)]">Adicionar conector personalizado</strong>.
            </li>
            <li>
              <strong className="text-[var(--ink-2)]">2.</strong> Dê um nome e cole o endereço
              acima no campo de URL. Clique em <strong className="text-[var(--ink-2)]">Continuar</strong>.
            </li>
            <li>
              <strong className="text-[var(--ink-2)]">3.</strong> Em Autenticação, deixe{' '}
              <strong className="text-[var(--ink-2)]">Nenhum</strong>, que já vem marcado. Este
              servidor não usa OAuth, ele espera a chave num cabeçalho.
            </li>
            <li>
              <strong className="text-[var(--ink-2)]">4.</strong> Em Cabeçalhos de requisição,
              use <code className="font-mono text-[11px] text-[var(--signal)]">Authorization</code>{' '}
              como nome e cole o valor abaixo, trocando pelo seu token.
            </li>
          </ol>

          <div className="relative mt-3">
            <pre className="overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--void)] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[var(--ink-2)]">
              {VALOR_DO_CABECALHO}
            </pre>
            <div className="absolute right-2 top-2">
              <CopyButton value={VALOR_DO_CABECALHO} />
            </div>
          </div>

          <p className="mt-2 text-[11.5px] text-[var(--ink-4)]">
            O valor precisa começar com <strong>Bearer</strong> e um espaço. Token colado sozinho
            devolve 401, e o Claude não mostra o valor de novo para você conferir.
          </p>
        </div>

        <div>
          <p className="label mb-2">Recortes na própria URL</p>
          <ul className="space-y-1.5 text-[12px] text-[var(--ink-3)]">
            <li>
              <code className="font-mono text-[11px] text-[var(--signal)]">?read_only=true</code>{' '}
              desliga escrita, estrutura e gestão de projetos nesta conexão, seja qual for o token.
            </li>
            <li>
              <code className="font-mono text-[11px] text-[var(--signal)]">?projeto=Loja Norte</code>{' '}
              prende a conexão a um projeto só.
            </li>
            <li>
              <code className="font-mono text-[11px] text-[var(--signal)]">?features=banco,dados</code>{' '}
              entrega só esses grupos de ferramentas, deixando o prompt do agente menor.
            </li>
          </ul>
          <p className="mt-2 text-[11.5px] text-[var(--ink-4)]">
            Os parâmetros só apertam: nenhum deles liga o que o token não tem.
          </p>
        </div>

        {!hasTokens && (
          <Alert tone="info">
            Crie um agente abaixo para receber o token. Ele aparece{' '}
            <strong>uma única vez</strong>, o sistema guarda só o hash, então não há como
            recuperá-lo depois.
          </Alert>
        )}
      </div>
    </Card>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Permissões

   Três níveis para o banco, em escada, mais dois interruptores que valem
   por fora dela. Ficam num componente só porque a criação e o ajuste de
   escopo precisam mostrar exatamente as mesmas opções, quando divergem, a
   pessoa acha que ajustar depois não dá o mesmo resultado que criar.
   ═══════════════════════════════════════════════════════════════════════════ */

type Nivel = 'leitura' | 'escrita' | 'estrutura'

function nivelDe(canWrite: boolean, canDdl: boolean): Nivel {
  if (canDdl) return 'estrutura'
  if (canWrite) return 'escrita'
  return 'leitura'
}

const NIVEIS: Array<{ valor: Nivel; label: string; descricao: string }> = [
  {
    valor: 'leitura',
    label: 'Somente leitura',
    descricao: 'Consultar dados, métricas, backups, logs e recomendações.',
  },
  {
    valor: 'escrita',
    label: 'Leitura e escrita',
    descricao: 'Também insere, atualiza e apaga linhas, e mexe em usuários do Auth.',
  },
  {
    valor: 'estrutura',
    label: 'Escrita e estrutura',
    descricao:
      'Também cria tabela, índice, policy e bucket, aplica migrações e publica edge functions.',
  },
]

function PermissionPicker({
  nivel,
  onNivel,
  canManageProjects,
  onCanManageProjects,
  canReadSecrets,
  onCanReadSecrets,
}: {
  nivel: Nivel
  onNivel: (n: Nivel) => void
  canManageProjects: boolean
  onCanManageProjects: (v: boolean) => void
  canReadSecrets: boolean
  onCanReadSecrets: (v: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="label mb-2">O que ele faz no banco</p>
        <div className="space-y-1.5">
          {NIVEIS.map((n) => (
            <Checkbox
              key={n.valor}
              checked={nivel === n.valor}
              onChange={() => onNivel(n.valor)}
              label={n.label}
              description={n.descricao}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="label mb-2">Fora do banco</p>
        <div className="space-y-1.5">
          <Checkbox
            checked={canManageProjects}
            onChange={onCanManageProjects}
            label="Pode criar, pausar e restaurar projetos"
            description="Cria projeto novo dentro das contas conectadas e organiza a carteira. Sem isto, ele só enxerga o que já existe."
          />
          <Checkbox
            checked={canReadSecrets}
            onChange={onCanReadSecrets}
            label="Pode ler a service_role key e a connection string"
            description="A URL, a anon key e a publishable key ele sempre recebe: são públicas. Marque isto só se ele precisar mesmo da chave secreta."
          />
        </div>
      </div>

      {nivel === 'estrutura' && (
        <Alert tone="warn" title="Este agente muda o schema sozinho">
          Ele pode criar e alterar tabelas, policies e funções nos projetos que alcança. O que
          apaga ainda exige confirmação explícita na chamada, e toda migração fica registrada com
          o nome dele. Ainda assim, restrinja os projetos abaixo.
        </Alert>
      )}

      {canReadSecrets && (
        <Alert tone="alert" title="Isto contorna todas as proteções do sistema">
          Um agente com a service_role key acessa o banco <strong>diretamente</strong>, sem passar
          por aqui, então as confirmações e os bloqueios deste servidor deixam de valer para ele.
          <br />
          <br />
          A chave também passa a existir no histórico da conversa do agente e nos registros do
          provedor do modelo. Se um dia vazar, rotacione-a na Supabase.
        </Alert>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Criação
   ═══════════════════════════════════════════════════════════════════════════ */

function CreateModal({
  open,
  projects,
  onClose,
  onCreated,
}: {
  open: boolean
  projects: ProjectRef[]
  onClose: () => void
  onCreated: (nome: string, token: string) => void
}) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [nivel, setNivel] = useState<Nivel>('leitura')
  const [canManageProjects, setCanManageProjects] = useState(false)
  const [canReadSecrets, setCanReadSecrets] = useState(false)
  const [todos, setTodos] = useState(true)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setNotes('')
    setNivel('leitura')
    setCanManageProjects(false)
    setCanReadSecrets(false)
    setTodos(true)
    setSelecionados(new Set())
    setError(null)
    onClose()
  }

  async function submit() {
    if (!name.trim()) {
      setError('Dê um nome ao agente.')
      return
    }
    if (!todos && selecionados.size === 0) {
      setError('Escolha ao menos um projeto, ou marque "todos".')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          notes,
          can_write: nivel !== 'leitura',
          can_ddl: nivel === 'estrutura',
          can_manage_projects: canManageProjects,
          can_read_secrets: canReadSecrets,
          project_ids: todos ? [] : [...selecionados],
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error))
        return
      }

      const nome = name
      reset()
      onCreated(nome, data.token)
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
      title="Novo agente"
      description="O token aparece uma única vez, na criação."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={reset} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            Criar agente
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agente de relatórios"
          hint="Aparece na auditoria como autor das ações."
          required
          autoFocus
        />

        <PermissionPicker
          nivel={nivel}
          onNivel={setNivel}
          canManageProjects={canManageProjects}
          onCanManageProjects={setCanManageProjects}
          canReadSecrets={canReadSecrets}
          onCanReadSecrets={setCanReadSecrets}
        />

        <div>
          <p className="label mb-2">Projetos que este agente alcança</p>

          <Checkbox
            checked={todos}
            onChange={setTodos}
            label="Todos os projetos"
            description="Inclusive os que você conectar no futuro."
            className="mb-2"
          />

          {!todos && (
            <div className="max-h-52 space-y-1.5 overflow-y-auto">
              {projects.map((p) => (
                <Checkbox
                  key={p.id}
                  checked={selecionados.has(p.id)}
                  onChange={(marcado) =>
                    setSelecionados((atual) => {
                      const proximo = new Set(atual)
                      if (marcado) proximo.add(p.id)
                      else proximo.delete(p.id)
                      return proximo
                    })
                  }
                  label={p.name}
                />
              ))}
            </div>
          )}
        </div>

        <Textarea
          label="Notas (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Para que serve este agente…"
          rows={2}
        />

        {error && <Alert tone="alert">{error}</Alert>}
      </div>
    </Modal>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Revelação do token, a única vez que ele existe
   ═══════════════════════════════════════════════════════════════════════════ */

function TokenRevealModal({
  token,
  onClose,
}: {
  token: { nome: string; token: string } | null
  onClose: () => void
}) {
  const [copiado, setCopiado] = useState(false)

  return (
    <Modal
      open={Boolean(token)}
      onClose={onClose}
      title={`Token de ${token?.nome ?? ''}`}
      description="Guarde agora. Esta é a única vez que ele aparece."
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose} disabled={!copiado}>
          {copiado ? 'Já guardei' : 'Copie o token antes de fechar'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--signal) 40%, transparent)',
            background: 'color-mix(in srgb, var(--signal) 7%, transparent)',
          }}
        >
          <code className="block break-all font-mono text-[12px] leading-relaxed text-[var(--ink)]">
            {token?.token}
          </code>
        </div>

        <button
          type="button"
          onClick={async () => {
            if (!token) return
            try {
              await navigator.clipboard.writeText(token.token)
              setCopiado(true)
            } catch {
              setCopiado(true) // sem permissão: libera para não travar o fluxo
            }
          }}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-[13px] transition-colors',
            copiado
              ? 'border-[color-mix(in_srgb,var(--signal)_40%,transparent)] text-[var(--signal)]'
              : 'border-[var(--line-strong)] text-[var(--ink)] hover:bg-[var(--surface-2)]',
          )}
        >
          {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiado ? 'Copiado' : 'Copiar token'}
        </button>

        <Alert tone="warn" title="Não há como recuperar depois">
          O sistema guarda apenas o hash do token. Se você perder, terá que revogar este agente e
          criar outro.
        </Alert>
      </div>
    </Modal>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ajuste de escopo
   ═══════════════════════════════════════════════════════════════════════════ */

function ScopeModal({
  token,
  projects,
  onClose,
  onSaved,
}: {
  token: AgentToken | null
  projects: ProjectRef[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [nivel, setNivel] = useState<Nivel>('leitura')
  const [canManageProjects, setCanManageProjects] = useState(false)
  const [canReadSecrets, setCanReadSecrets] = useState(false)
  const [todos, setTodos] = useState(true)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [pronto, setPronto] = useState(false)

  if (token && !pronto) {
    setNivel(nivelDe(token.can_write, token.can_ddl))
    setCanManageProjects(token.can_manage_projects)
    setCanReadSecrets(token.can_read_secrets)
    setTodos(token.project_ids.length === 0)
    setSelecionados(new Set(token.project_ids))
    setPronto(true)
  }

  function fechar() {
    setPronto(false)
    onClose()
  }

  async function salvar() {
    if (!token) return
    setLoading(true)

    try {
      const res = await fetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: token.id,
          can_write: nivel !== 'leitura',
          can_ddl: nivel === 'estrutura',
          can_manage_projects: canManageProjects,
          can_read_secrets: canReadSecrets,
          project_ids: todos ? [] : [...selecionados],
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error('Falha ao salvar', humanizeShort(data.error))
        return
      }

      toast.success('Escopo atualizado', 'Vale já na próxima chamada do agente.')
      setPronto(false)
      onSaved()
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={Boolean(token)}
      onClose={fechar}
      title={`Escopo de ${token?.name ?? ''}`}
      description="Vale imediatamente, sem precisar gerar token novo."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={salvar} loading={loading}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <PermissionPicker
          nivel={nivel}
          onNivel={setNivel}
          canManageProjects={canManageProjects}
          onCanManageProjects={setCanManageProjects}
          canReadSecrets={canReadSecrets}
          onCanReadSecrets={setCanReadSecrets}
        />

        <div>
          <p className="label mb-2">Projetos</p>
          <Checkbox
            checked={todos}
            onChange={setTodos}
            label="Todos os projetos"
            className="mb-2"
          />

          {!todos && (
            <div className="max-h-52 space-y-1.5 overflow-y-auto">
              {projects.map((p) => (
                <Checkbox
                  key={p.id}
                  checked={selecionados.has(p.id)}
                  onChange={(marcado) =>
                    setSelecionados((atual) => {
                      const proximo = new Set(atual)
                      if (marcado) proximo.add(p.id)
                      else proximo.delete(p.id)
                      return proximo
                    })
                  }
                  label={p.name}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
