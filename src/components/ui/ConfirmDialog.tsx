'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Primitives'
import { Input } from './Field'

/**
 * Confirmação de ação destrutiva.
 *
 * Quando `confirmPhrase` é informada, o botão só libera se o texto bater,
 * reservado para o que não tem volta (excluir linha, excluir usuário do Auth).
 * O atrito é proposital: são bancos de produção de clientes.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  confirmPhrase,
  destructive = true,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  message: React.ReactNode
  confirmLabel?: string
  confirmPhrase?: string
  destructive?: boolean
  loading?: boolean
}) {
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)

  const canConfirm = !confirmPhrase || typed.trim().toLowerCase() === confirmPhrase.toLowerCase()
  const busy = loading || working

  function handleClose() {
    if (busy) return
    setTyped('')
    onClose()
  }

  async function handleConfirm() {
    if (!canConfirm) return
    setWorking(true)
    try {
      await onConfirm()
      setTyped('')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={!canConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3.5">
        {destructive && (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: 'color-mix(in srgb, var(--alert) 12%, transparent)',
              color: 'var(--alert)',
            }}
          >
            <AlertTriangle className="h-4.5 w-4.5" />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-4">
          <div className="text-[13px] leading-relaxed text-[var(--ink-2)]">{message}</div>

          {confirmPhrase && (
            <Input
              label={`Digite “${confirmPhrase}” para confirmar`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPhrase}
              autoFocus
              mono
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
