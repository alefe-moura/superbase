'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Alert, Badge, Card, CardHeader, EmptyState, Modal, Skeleton } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatDateTime, timeAgo } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { ProjectWithMeta } from '@/lib/types'
import type { AuthUser } from '@/lib/gateway/project'

export function AuthTab({ project }: { project: ProjectWithMeta }) {
  const toast = useToast()

  const [users, setUsers] = useState<AuthUser[] | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<AuthUser | null>(null)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/projects/${project.id}/auth-users?page=${page}`)
      const data = await res.json()

      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao listar os usuários.'))
        setUsers([])
        return
      }

      setUsers(data.users)
    } catch {
      setError('Falha de conexão.')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [project.id, page])

  useEffect(() => {
    load()
  }, [load])

  function isBanned(user: AuthUser): boolean {
    if (!user.banned_until) return false
    return new Date(user.banned_until).getTime() > Date.now()
  }

  async function toggleBan(user: AuthUser) {
    const banned = isBanned(user)
    setWorking(user.id)

    try {
      const res = await fetch(`/api/projects/${project.id}/auth-users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          action: banned ? 'desbanir' : 'banir',
          // "none" remove o banimento; 100 anos e o equivalente pratico a permanente.
          payload: { ban_duration: banned ? 'none' : '876000h' },
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error('Falha ao alterar o usuário', humanizeShort(data.error))
        return
      }

      toast.success(banned ? 'Usuário desbanido' : 'Usuário banido')
      load()
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setWorking(null)
    }
  }

  async function sendRecovery(user: AuthUser) {
    if (!user.email) return
    setWorking(user.id)

    try {
      // Confirma o e-mail e devolve ao usuário a capacidade de redefinir a senha.
      const res = await fetch(`/api/projects/${project.id}/auth-users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          action: 'confirmar e-mail',
          payload: { email_confirm: true },
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error('Falha', humanizeShort(data.error))
        return
      }

      toast.success('E-mail confirmado', 'O usuário ja pode usar "esqueci minha senha" no app.')
      load()
    } catch {
      toast.error('Falha de conexão.')
    } finally {
      setWorking(null)
    }
  }

  async function handleDelete() {
    if (!toDelete) return

    const res = await fetch(`/api/projects/${project.id}/auth-users`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: toDelete.id, email: toDelete.email }),
    })

    const data = await res.json()
    if (!res.ok) {
      toast.error('Falha ao excluir', humanizeShort(data.error))
      return
    }

    toast.success('Usuário excluído')
    setToDelete(null)
    load()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Users className="h-4 w-4" />}
          title="Usuários do Auth"
          description={`Usuários cadastrados no projeto ${project.name}.`}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={load} loading={loading}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                <UserPlus className="h-3.5 w-3.5" />
                Novo usuário
              </Button>
            </div>
          }
        />

        {error ? (
          <div className="p-4">
            <Alert tone="alert">{error}</Alert>
          </div>
        ) : loading && users === null ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : users && users.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="Nenhum usuário"
            description={page > 1 ? 'Não ha mais usuários nesta pagina.' : 'Este projeto ainda não tem usuários cadastrados no Auth.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-2)]">
                  <th className="px-4 py-2.5 font-medium">Usuário</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Criado</th>
                  <th className="px-4 py-2.5 font-medium">Último acesso</th>
                  <th className="w-32 px-4 py-2.5" />
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--line)]">
                {(users ?? []).map((user) => {
                  const banned = isBanned(user)
                  return (
                    <tr key={user.id} className="group transition-colors hover:bg-[var(--surface-2)]">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{user.email ?? user.phone ?? '·'}</div>
                        <div className="font-mono text-[11px] text-[var(--ink-4)]">
                          {user.id}
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        {banned ? (
                          <Badge tone="alert">
                            <Ban className="h-3 w-3" />
                            Banido
                          </Badge>
                        ) : user.email_confirmed_at ? (
                          <Badge tone="signal">
                            <CheckCircle2 className="h-3 w-3" />
                            Confirmado
                          </Badge>
                        ) : (
                          <Badge tone="warn">Não confirmado</Badge>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-xs text-[var(--ink-2)]">
                        {formatDateTime(user.created_at)}
                      </td>

                      <td className="px-4 py-2.5 text-xs text-[var(--ink-2)]">
                        {user.last_sign_in_at ? timeAgo(user.last_sign_in_at) : 'nunca'}
                      </td>

                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {!user.email_confirmed_at && user.email && (
                            <button
                              type="button"
                              onClick={() => sendRecovery(user)}
                              disabled={working === user.id}
                              title="Confirmar e-mail"
                              className="rounded p-1.5 text-[var(--ink-2)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleBan(user)}
                            disabled={working === user.id}
                            title={banned ? 'Desbanir' : 'Banir'}
                            className="rounded p-1.5 text-[var(--ink-2)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setToDelete(user)}
                            title="Excluir usuário"
                            className="rounded p-1.5 text-[var(--ink-2)] hover:bg-[color-mix(in srgb, var(--alert) 14%, transparent)] hover:text-[var(--alert)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {users && users.length > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-2.5">
            <span className="text-xs text-[var(--ink-2)]">Pagina {page}</span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || users.length < 50}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CreateUserModal
        open={creating}
        project={project}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false)
          load()
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Excluir usuário"
        confirmLabel="Excluir definitivamente"
        confirmPhrase="excluir"
        message={
          <>
            O usuário <strong>{toDelete?.email ?? toDelete?.id}</strong> será removido do Auth de{' '}
            <strong>{project.name}</strong>. A ação e irreversível e pode quebrar registros que
            referenciam esse usuário.
          </>
        }
      />
    </div>
  )
}

function CreateUserModal({
  open,
  project,
  onClose,
  onCreated,
}: {
  open: boolean
  project: ProjectWithMeta
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setEmail('')
    setPassword('')
    setError(null)
    onClose()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`/api/projects/${project.id}/auth-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: password || undefined, email_confirm: true }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao criar o usuário.'))
        return
      }

      toast.success('Usuário criado', email)
      setEmail('')
      setPassword('')
      onCreated()
    } catch {
      setError('Falha de conexão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Novo usuário"
      description={`Será criado no Auth de ${project.name}, com e-mail ja confirmado.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={loading}>
            Criar usuário
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="usuário@cliente.com"
          required
          autoFocus
        />
        <Input
          label="Senha (opcional)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Deixe vazio para o usuário definir depois"
          hint="Sem senha, o usuário precisa usar magic link ou recuperação."
        />
        {error && <Alert tone="alert">{error}</Alert>}
      </form>
    </Modal>
  )
}
