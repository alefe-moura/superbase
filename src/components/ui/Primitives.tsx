'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Copy, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Health } from '@/lib/types'

/* ═══════════════════════════════════════════════════════════════════════════
   Superfícies
   ═══════════════════════════════════════════════════════════════════════════ */

export function Card({
  className,
  interactive,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'surface rounded-xl',
        interactive &&
          'transition-all duration-200 hover:border-[var(--line-glow)] hover:shadow-[0_10px_40px_-16px_rgba(0,0,0,0.7)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-px shrink-0 text-[var(--ink-3)]">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate font-display text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink-3)]">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Etiquetas
   ═══════════════════════════════════════════════════════════════════════════ */

type Tone = 'neutral' | 'signal' | 'warn' | 'alert' | 'info'

const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: {
    fg: 'var(--ink-2)',
    bg: 'var(--surface-2)',
    border: 'var(--line-strong)',
  },
  signal: {
    fg: 'var(--signal)',
    bg: 'color-mix(in srgb, var(--signal) 10%, transparent)',
    border: 'color-mix(in srgb, var(--signal) 32%, transparent)',
  },
  warn: {
    fg: 'var(--warn)',
    bg: 'color-mix(in srgb, var(--warn) 11%, transparent)',
    border: 'color-mix(in srgb, var(--warn) 32%, transparent)',
  },
  alert: {
    fg: 'var(--alert)',
    bg: 'color-mix(in srgb, var(--alert) 11%, transparent)',
    border: 'color-mix(in srgb, var(--alert) 32%, transparent)',
  },
  info: {
    fg: 'var(--info)',
    bg: 'color-mix(in srgb, var(--info) 11%, transparent)',
    border: 'color-mix(in srgb, var(--info) 32%, transparent)',
  },
}

export function Badge({
  tone = 'neutral',
  mono,
  className,
  children,
  ...props
}: {
  tone?: Tone
  mono?: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'className' | 'children'>) {
  const t = TONES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-[3px]',
        'text-[10.5px] font-medium leading-none',
        mono && 'font-mono tracking-tight',
        className,
      )}
      style={{ color: t.fg, background: t.bg, borderColor: t.border }}
      {...props}
    >
      {children}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Saúde, a linguagem de sinal do sistema

   Não é um badge colorido: é um indicador de telemetria. Saudável pulsa
   devagar (batimento). Fora do ar emite halo (alarme). Sem dados fica inerte.
   ═══════════════════════════════════════════════════════════════════════════ */

const HEALTH: Record<Health, { color: string; label: string; tone: Tone }> = {
  healthy: { color: 'var(--signal)', label: 'Saudável', tone: 'signal' },
  degraded: { color: 'var(--warn)', label: 'Degradado', tone: 'warn' },
  down: { color: 'var(--alert)', label: 'Fora do ar', tone: 'alert' },
  unknown: { color: 'var(--ink-4)', label: 'Sem dados', tone: 'neutral' },
}

export function HealthDot({ health, size = 7 }: { health: Health; size?: number }) {
  const h = HEALTH[health] ?? HEALTH.unknown

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-label={h.label}
    >
      {health === 'down' && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: h.color, animation: 'halo 1.8s ease-out infinite' }}
        />
      )}
      <span
        className="relative rounded-full"
        style={{
          width: size,
          height: size,
          background: h.color,
          boxShadow: health !== 'unknown' ? `0 0 8px ${h.color}` : undefined,
          animation: health === 'healthy' ? 'signal-pulse 2.8s ease-in-out infinite' : undefined,
        }}
      />
    </span>
  )
}

export function HealthBadge({ health }: { health: Health }) {
  const h = HEALTH[health] ?? HEALTH.unknown
  return (
    <Badge tone={h.tone}>
      <HealthDot health={health} size={6} />
      {h.label}
    </Badge>
  )
}

/**
 * Barras de sinal (estilo intensidade de rede). Dá para ler a saúde da
 * carteira inteira de relance, sem precisar processar cor + texto.
 */
export function SignalBars({ health, className }: { health: Health; className?: string }) {
  const h = HEALTH[health] ?? HEALTH.unknown
  const active = health === 'healthy' ? 3 : health === 'degraded' ? 2 : health === 'down' ? 1 : 0

  return (
    <span className={cn('inline-flex items-end gap-[2px]', className)} aria-label={h.label}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px] transition-all duration-300"
          style={{
            height: 5 + i * 3,
            background: i < active ? h.color : 'var(--line-strong)',
            boxShadow: i < active && health !== 'unknown' ? `0 0 6px ${h.color}` : undefined,
          }}
        />
      ))}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Avisos
   ═══════════════════════════════════════════════════════════════════════════ */

type AlertTone = 'info' | 'warn' | 'alert' | 'signal'

const ALERT_ICON: Record<AlertTone, React.ReactNode> = {
  info: <Info className="h-4 w-4" />,
  warn: <AlertTriangle className="h-4 w-4" />,
  alert: <XCircle className="h-4 w-4" />,
  signal: <Check className="h-4 w-4" />,
}

const ALERT_COLOR: Record<AlertTone, string> = {
  info: 'var(--info)',
  warn: 'var(--warn)',
  alert: 'var(--alert)',
  signal: 'var(--signal)',
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone
  title?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  const color = ALERT_COLOR[tone]

  return (
    <div
      className={cn('relative overflow-hidden rounded-lg border pl-4 pr-4 py-3 text-sm fade-in', className)}
      style={{
        background: `color-mix(in srgb, ${color} 6%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 26%, transparent)`,
      }}
    >
      {/* Faixa lateral: reforça a severidade sem depender só da cor de fundo */}
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />

      <div className="flex gap-3">
        <span className="mt-px shrink-0" style={{ color }}>
          {ALERT_ICON[tone]}
        </span>
        <div className="min-w-0 flex-1">
          {title && (
            <p className="text-[13px] font-semibold leading-snug" style={{ color }}>
              {title}
            </p>
          )}
          {children && (
            <div
              className={cn(
                'text-[12.5px] leading-relaxed text-[var(--ink-2)]',
                title && 'mt-1',
              )}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Copiar
   ═══════════════════════════════════════════════════════════════════════════ */

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      title={copied ? 'Copiado' : 'Copiar'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          // Sem permissão de área de transferência: falha em silêncio.
        }
      }}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px]',
        'text-[var(--ink-3)] transition-all duration-150',
        'hover:bg-[var(--surface-3)] hover:text-[var(--ink)]',
        copied && 'text-[var(--signal)]',
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span>{copied ? 'Copiado' : label}</span>}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Modal
   ═══════════════════════════════════════════════════════════════════════════ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  // O portal só existe depois da hidratação: no servidor não há `document`.
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open || !montado) return null

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  /**
   * Duas camadas IRMÃS, e não uma dentro da outra.
   *
   * O escurecimento já foi filho do container que rola. Num modal mais alto
   * que a tela, rolar o formulário levava o escurecimento junto e descobria a
   * parte de baixo da página. Fora do container, ele fica preso à janela e
   * cobre tudo, com o formulário rolando por cima.
   *
   * O conjunto vai num portal para o `body`, para que nenhum ancestral com
   * `transform`, `filter` ou `overflow` consiga recortar o que precisa cobrir
   * a tela inteira.
   */
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px] fade-in"
        onClick={onClose}
        aria-hidden
      />

      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
        // Clique na área vazia ao redor do painel fecha, como no escurecimento.
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            'relative z-10 my-auto w-full rounded-xl scale-in',
            'border border-[var(--line-strong)] bg-[var(--surface)]',
            'shadow-[0_32px_90px_-20px_rgba(0,0,0,0.9)]',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-semibold tracking-[-0.02em]">{title}</h2>
              {description && (
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-3)]">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 rounded-md p-1.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4">{children}</div>

          {footer && (
            <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--void)]/40 px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Estado vazio
   ═══════════════════════════════════════════════════════════════════════════ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-10' : 'py-16',
      )}
    >
      {icon && (
        <div className="relative mb-4">
          {/* Grade esmaecida atrás do ícone: dá a impressão de "espaço à espera" */}
          <div
            className="hairline-grid absolute -inset-8 opacity-40"
            style={{
              maskImage: 'radial-gradient(circle, black 0%, transparent 72%)',
              WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 72%)',
            }}
          />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--ink-3)]">
            {icon}
          </div>
        </div>
      )}

      <h3 className="font-display text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</h3>

      {description && (
        <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-[var(--ink-3)]">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Medidor de recurso
   ═══════════════════════════════════════════════════════════════════════════ */

export function meterColor(value: number | null | undefined, warnAt = 75, dangerAt = 90): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'var(--ink-4)'
  if (value >= dangerAt) return 'var(--alert)'
  if (value >= warnAt) return 'var(--warn)'
  return 'var(--signal)'
}

export function Meter({
  value,
  label,
  detail,
  warnAt = 75,
  dangerAt = 90,
  size = 'md',
}: {
  value: number | null | undefined
  label?: React.ReactNode
  detail?: React.ReactNode
  warnAt?: number
  dangerAt?: number
  size?: 'sm' | 'md'
}) {
  const has = value !== null && value !== undefined && Number.isFinite(value)
  const pct = has ? Math.max(0, Math.min(100, value)) : 0
  const color = meterColor(value, warnAt, dangerAt)

  return (
    <div>
      {(label || has) && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          {label && <span className="label">{label}</span>}
          <span
            className={cn(
              'font-mono font-semibold tabular-nums leading-none tracking-tight',
              size === 'sm' ? 'text-[13px]' : 'text-lg',
            )}
            style={{ color }}
          >
            {has ? pct.toFixed(0) : '·'}
            {has && <span className="ml-0.5 text-[0.6em] opacity-70">%</span>}
          </span>
        </div>
      )}

      <div
        className={cn(
          'w-full overflow-hidden rounded-full bg-[var(--void)]',
          size === 'sm' ? 'h-1' : 'h-1.5',
        )}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: color,
            boxShadow: has ? `0 0 10px ${color}` : undefined,
          }}
        />
      </div>

      {detail && <p className="mt-1.5 text-[11px] text-[var(--ink-4)]">{detail}</p>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Carregamento
   ═══════════════════════════════════════════════════════════════════════════ */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('sweeping rounded-md bg-[var(--surface-2)]', className)}
      aria-hidden
    />
  )
}

/** Par rótulo/valor, a unidade de leitura de dados do painel. */
export function Stat({
  label,
  value,
  mono = true,
  tone,
}: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  tone?: string
}) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p
        className={cn(
          'mt-1.5 truncate text-[13.5px] leading-none',
          mono && 'font-mono tabular-nums',
        )}
        style={{ color: tone ?? 'var(--ink)' }}
      >
        {value}
      </p>
    </div>
  )
}
