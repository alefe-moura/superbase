'use client'

import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Campos de formulário. O foco acende a borda com o mint e um halo suave,
 * mesmo gesto visual do "sinal de vida" usado no resto do sistema.
 */
const CONTROL = [
  'w-full rounded-lg bg-[var(--void)] px-3',
  'border border-[var(--line-strong)]',
  'text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-4)]',
  'transition-all duration-150',
  'hover:border-[var(--line-glow)]',
  'focus:border-[var(--signal)] focus:outline-none',
  'focus:shadow-[0_0_0_3px_var(--focus)]',
  'disabled:opacity-45 disabled:cursor-not-allowed',
].join(' ')

function Label({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="label block">
      {children}
      {required && <span className="ml-1 text-[var(--signal)]">*</span>}
    </label>
  )
}

function Helper({ error, hint }: { error?: string; hint?: React.ReactNode }) {
  if (error) return <p className="text-[11.5px] leading-snug text-[var(--alert)]">{error}</p>
  if (hint) return <p className="text-[11.5px] leading-relaxed text-[var(--ink-3)]">{hint}</p>
  return null
}

// `prefix` existe como atributo HTML nativo (string), então o omitimos para
// poder aceitar um nó React no lugar.
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string
  hint?: React.ReactNode
  error?: string
  mono?: boolean
  prefix?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, mono, className, id, prefix, ...props },
  ref,
) {
  const generated = useId()
  const inputId = id ?? generated

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={inputId} required={props.required}>
          {label}
        </Label>
      )}

      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-4)]">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            CONTROL,
            'h-9.5',
            prefix && 'pl-9',
            mono && 'font-mono text-xs tracking-tight',
            error && 'border-[var(--alert)] focus:border-[var(--alert)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--alert)_22%,transparent)]',
            className,
          )}
          {...props}
        />
      </div>

      <Helper error={error} hint={hint} />
    </div>
  )
})

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: React.ReactNode
  error?: string
  mono?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, mono, className, id, ...props },
  ref,
) {
  const generated = useId()
  const areaId = id ?? generated

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={areaId} required={props.required}>
          {label}
        </Label>
      )}
      <textarea
        ref={ref}
        id={areaId}
        className={cn(
          CONTROL,
          'min-h-20 resize-y py-2.5 leading-relaxed',
          mono && 'font-mono text-xs',
          error && 'border-[var(--alert)]',
          className,
        )}
        {...props}
      />
      <Helper error={error} hint={hint} />
    </div>
  )
})

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: React.ReactNode
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%235a706d' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, className, children, id, ...props },
  ref,
) {
  const generated = useId()
  const selectId = id ?? generated

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={selectId}>{label}</Label>}
      <select
        ref={ref}
        id={selectId}
        className={cn(CONTROL, 'h-9.5 cursor-pointer appearance-none pr-9', className)}
        style={{
          backgroundImage: CHEVRON,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.7rem center',
        }}
        {...props}
      >
        {children}
      </select>
      {hint && <p className="text-[11.5px] text-[var(--ink-3)]">{hint}</p>}
    </div>
  )
})

/** Caixa de seleção com o mesmo vocabulário visual dos demais campos. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  description?: React.ReactNode
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all duration-150',
        checked
          ? 'border-[color-mix(in_srgb,var(--signal)_45%,transparent)] bg-[color-mix(in_srgb,var(--signal)_7%,transparent)]'
          : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-all',
          checked
            ? 'border-[var(--signal)] bg-[var(--signal)]'
            : 'border-[var(--line-strong)] bg-[var(--void)]',
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
            <path
              d="M2.5 6.2 4.7 8.4 9.5 3.6"
              stroke="var(--signal-ink)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>

      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug text-[var(--ink)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--ink-3)]">
            {description}
          </span>
        )}
      </span>
    </label>
  )
}

/** Campo de busca com ícone embutido, usado nas listagens. */
export const SearchField = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function SearchField({ className, ...props }, ref) {
    return (
      <div className={cn('relative', className)}>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-4)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input ref={ref} className={cn(CONTROL, 'h-9.5 pl-9')} {...props} />
      </div>
    )
  },
)
