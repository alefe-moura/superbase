'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Alert } from './Primitives'
import { humanizeError } from '@/lib/errors'
import { cn } from '@/lib/utils'

/**
 * Mostra um erro em português, com o texto técnico escondido atrás de um
 * clique, presente para quando fizer diferença, sem poluir a leitura.
 */
export function ErrorNote({
  error,
  title,
  tone = 'alert',
  className,
}: {
  error: unknown
  title?: string
  tone?: 'alert' | 'warn' | 'info'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const { message, detail } = humanizeError(error)

  return (
    <Alert tone={tone} title={title} className={className}>
      <p className="leading-relaxed">{message}</p>

      {detail && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
          >
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
            />
            {open ? 'Ocultar detalhe técnico' : 'Ver detalhe técnico'}
          </button>

          {open && (
            <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--void)] px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-[var(--ink-3)]">
              {detail}
            </pre>
          )}
        </>
      )}
    </Alert>
  )
}
