'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  tone: Tone
  message: string
  detail?: string
}

interface ToastApi {
  success: (message: string, detail?: string) => void
  error: (message: string, detail?: string) => void
  info: (message: string, detail?: string) => void
  warning: (message: string, detail?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}

const CONFIG: Record<Tone, { icon: React.ReactNode; color: string }> = {
  success: { icon: <Check className="h-4 w-4" />, color: 'var(--signal)' },
  error: { icon: <XCircle className="h-4 w-4" />, color: 'var(--alert)' },
  warning: { icon: <AlertTriangle className="h-4 w-4" />, color: 'var(--warn)' },
  info: { icon: <Info className="h-4 w-4" />, color: 'var(--info)' },
}

const DURATION: Record<Tone, number> = {
  success: 4000,
  info: 4500,
  warning: 6500,
  error: 9000,
}

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((tone: Tone, message: string, detail?: string) => {
    setToasts((current) => [...current.slice(-3), { id: nextId++, tone, message, detail }])
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, d) => push('success', m, d),
      error: (m, d) => push('error', m, d),
      info: (m, d) => push('info', m, d),
      warning: (m, d) => push('warning', m, d),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-[22rem] flex-col gap-2.5">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const config = CONFIG[toast.tone]
  const duration = DURATION[toast.tone]

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), duration)
    return () => clearTimeout(timer)
  }, [toast.id, duration, onDismiss])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto relative overflow-hidden rounded-xl scale-in',
        'border border-[var(--line-strong)] bg-[var(--surface)]',
        'shadow-[0_18px_50px_-14px_rgba(0,0,0,0.85)]',
      )}
      style={{ borderColor: `color-mix(in srgb, ${config.color} 34%, var(--line-strong))` }}
    >
      {/* Barra de tempo restante: mostra que vai sumir sozinho */}
      <span
        className="absolute bottom-0 left-0 h-[2px] origin-left"
        style={{
          background: config.color,
          width: '100%',
          animation: `toast-countdown ${duration}ms linear forwards`,
        }}
      />

      <div className="flex gap-3 px-4 py-3.5">
        <span className="mt-px shrink-0" style={{ color: config.color }}>
          {config.icon}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-[13px] font-semibold leading-snug tracking-[-0.01em]">
            {toast.message}
          </p>
          {toast.detail && (
            <p className="mt-1 break-words text-[11.5px] leading-relaxed text-[var(--ink-3)]">
              {toast.detail}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Fechar aviso"
          className="-mr-1 -mt-1 shrink-0 self-start rounded-md p-1 text-[var(--ink-4)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
