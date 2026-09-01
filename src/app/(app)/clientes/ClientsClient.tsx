'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FolderOpen, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Field'
import { Alert, Card, CardHeader, EmptyState, Modal } from '@/components/ui/Primitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { clientColor } from '@/lib/utils'
import { humanizeShort } from '@/lib/errors'
import type { Project } from '@/lib/types'
import type { ClientWithProjects } from './page'

type Orphan = Pick<Project, 'id' | 'name' | 'status'>

export function ClientsClient({
  clients,
  orphanProjects,
}: {
  clients: ClientWithProjects[]
  orphanProjects: Orphan[]
}) {
  const router = useRouter()
  const toast = useToast()

  const [editing, setEditing] = useState<ClientWithProjects | null>(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<ClientWithProjects | null>(null)

  async function handleDelete() {
    if (!toDelete) return

    const res = await fetch(`/api/clients/${toDelete.id}`, { method: 'DELETE' })
    const data = await res.json()

    if (!res.ok) {
      toast.error('Falha ao remover', humanizeShort(data.error))
      return
    }

    toast.success('Cliente removido', 'Os projetos dele ficaram sem cliente.')
    setToDelete(null)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Novo cliente
        </Button>
      </div>

      {clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="Nenhum cliente cadastrado"
            description="Crie clientes para agrupar os projetos da carteira e achar tudo de um cliente em uma tela só, mesmo que os projetos estejam em contas Supabase diferentes."
            action={
              <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
                Criar o primeiro cliente
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 stagger md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => {
            const color = clientColor(client.name, client.color)

            return (
              <Card key={client.id} className="group relative flex flex-col overflow-hidden p-5">
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />

                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-[15px] font-semibold tracking-[-0.025em]">
                      {client.name}
                    </h3>
                    {client.contact && (
                      <p className="mt-1 truncate font-mono text-[11.5px] text-[var(--ink-3)]">
                        {client.contact}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing(client)} title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => setToDelete(client)} title="Remover">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {client.notes && (
                  <p className="mb-3 line-clamp-3 text-[12px] leading-relaxed text-[var(--ink-3)]">
                    {client.notes}
                  </p>
                )}

                <div className="mt-auto border-t border-[var(--line)] pt-3">
                  {client.projects.length === 0 ? (
                    <p className="text-[11.5px] text-[var(--ink-4)]">Nenhum projeto vinculado.</p>
                  ) : (
                    <>
                      <p className="label mb-2">
                        {client.projects.length}{' '}
                        {client.projects.length === 1 ? 'projeto' : 'projetos'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {client.projects.map((p) => (
                          <Link
                            key={p.id}
                            href={`/projetos/${p.id}`}
                            className="rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--line-glow)] hover:text-[var(--ink)]"
                          >
                            {p.name}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {orphanProjects.length > 0 && (
        <Card>
          <CardHeader
            icon={<FolderOpen className="h-4 w-4" />}
            title="Projetos sem cliente"
            description="Abra cada projeto e escolha o cliente na aba Visão geral."
          />
          <div className="flex flex-wrap gap-1.5 px-5 py-4">
            {orphanProjects.map((p) => (
              <Link
                key={p.id}
                href={`/projetos/${p.id}`}
                className="rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--line-glow)] hover:text-[var(--ink)]"
              >
                {p.name}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <ClientModal
        open={creating || Boolean(editing)}
        client={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Remover cliente"
        confirmLabel="Remover"
        message={
          <>
            O cliente <strong className="text-[var(--ink)]">{toDelete?.name}</strong> será apagado.
            {toDelete?.projects.length ? (
              <>
                <br />
                <br />
                Os {toDelete.projects.length}{' '}
                {toDelete.projects.length === 1 ? 'projeto vinculado continua' : 'projetos vinculados continuam'}{' '}
                na carteira, apenas ficam sem cliente.
              </>
            ) : null}
          </>
        }
      />
    </div>
  )
}

function ClientModal({
  open,
  client,
  onClose,
}: {
  open: boolean
  client: ClientWithProjects | null
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Carrega os valores ao abrir
  if (open && !ready) {
    setName(client?.name ?? '')
    setContact(client?.contact ?? '')
    setNotes(client?.notes ?? '')
    setReady(true)
  }

  function handleClose() {
    setReady(false)
    setError(null)
    onClose()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(client ? `/api/clients/${client.id}` : '/api/clients', {
        method: client ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, contact, notes }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(humanizeShort(data.error ?? 'Falha ao salvar.'))
        return
      }

      toast.success(client ? 'Cliente atualizado' : 'Cliente criado')
      handleClose()
      router.refresh()
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
      title={client ? 'Editar cliente' : 'Novo cliente'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={loading}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Empresa do cliente"
          required
          autoFocus
        />
        <Input
          label="Contato"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="email@cliente.com · (11) 99999-0000"
        />
        <Textarea
          label="Notas"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observações sobre o cliente…"
          rows={3}
        />
        {error && <Alert tone="alert">{error}</Alert>}
      </form>
    </Modal>
  )
}
