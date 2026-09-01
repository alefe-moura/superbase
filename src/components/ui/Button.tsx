'use client'

import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

/**
 * O primário usa o mint da marca, e é o único lugar da interface que usa.
 * Isso mantém "a ação principal" e "sinal de vida" como a mesma linguagem.
 */
const VARIANTS: Record<Variant, string> = {
  primary: [
    'bg-[var(--signal)] text-[var(--signal-ink)] font-semibold',
    'hover:bg-[var(--signal-bright)]',
    'shadow-[0_0_0_1px_color-mix(in_srgb,var(--signal)_50%,transparent),0_6px_20px_-8px_color-mix(in_srgb,var(--signal)_60%,transparent)]',
    'hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--signal)_60%,transparent),0_8px_26px_-8px_color-mix(in_srgb,var(--signal)_75%,transparent)]',
  ].join(' '),

  secondary: [
    'bg-[var(--surface-2)] text-[var(--ink)] border border-[var(--line-strong)]',
    'hover:bg-[var(--surface-3)] hover:border-[var(--line-glow)]',
  ].join(' '),

  outline: [
    'bg-transparent text-[var(--ink)] border border-[var(--line-strong)]',
    'hover:bg-[var(--surface-2)] hover:border-[var(--line-glow)]',
  ].join(' '),

  ghost: 'bg-transparent text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',

  danger: [
    'bg-transparent text-[var(--alert)] font-medium',
    'border border-[color-mix(in_srgb,var(--alert)_38%,transparent)]',
    'hover:bg-[color-mix(in_srgb,var(--alert)_12%,transparent)]',
    'hover:border-[color-mix(in_srgb,var(--alert)_60%,transparent)]',
  ].join(' '),
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
  md: 'h-9.5 px-4 text-[13.5px] gap-2 rounded-lg',
  lg: 'h-11 px-6 text-sm gap-2 rounded-xl',
  icon: 'h-9.5 w-9.5 justify-center rounded-lg',
  'icon-sm': 'h-8 w-8 justify-center rounded-md',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'group relative inline-flex items-center whitespace-nowrap',
        'transition-all duration-150 ease-out',
        'active:scale-[0.985]',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 spin" />}
      {children}
    </button>
  )
})
