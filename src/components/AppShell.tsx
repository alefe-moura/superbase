'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  Bot,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  ScrollText,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'
import { Logomark, Wordmark } from './Brand'
import { APP_VERSION } from '@/lib/version'

const NAV = [
  { href: '/', label: 'Carteira', icon: LayoutGrid, exact: true },
  { href: '/saude', label: 'Saúde geral', icon: Activity },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/conexoes', label: 'Conexões', icon: Plug },
  { href: '/agentes', label: 'Agentes', icon: Bot },
  { href: '/auditoria', label: 'Auditoria', icon: ScrollText },
]

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  // Fecha o menu ao navegar no celular
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  const nav = (
    <nav className="flex flex-col gap-1.5">
      {NAV.map((item) => {
        const Icon = item.icon
        const active = isActive(item)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2.5',
              'font-display text-[14px] tracking-[-0.01em] transition-all duration-150',
              active
                ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]'
                : 'font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
            )}
          >
            {/* Marcador do item ativo: um traço mint, como um LED aceso */}
            <span
              className={cn(
                'absolute left-0 top-1/2 h-[18px] w-[2.5px] -translate-y-1/2 rounded-r-full transition-all duration-200',
                active ? 'opacity-100' : 'opacity-0',
              )}
              style={{
                background: 'var(--signal)',
                boxShadow: active ? '0 0 10px var(--signal)' : undefined,
              }}
            />

            <Icon
              className={cn(
                'h-[18px] w-[18px] shrink-0 transition-colors',
                active ? 'text-[var(--signal)]' : 'text-[var(--ink-3)] group-hover:text-[var(--ink-2)]',
              )}
              strokeWidth={active ? 2.2 : 1.9}
            />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  const brandHeader = (
    <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-85">
      <Logomark size={24} />
      <Wordmark />
    </Link>
  )

  const footer = (
    <div className="border-t border-[var(--line)] p-3">
      <div className="mb-2.5 flex items-center gap-2 px-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }}
        />
        <p className="truncate font-mono text-[11px] text-[var(--ink-3)]" title={email}>
          {email}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className={cn(
            'flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[13px]',
            'text-[var(--ink-2)] transition-colors',
            'hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
            'disabled:opacity-50',
          )}
        >
          <LogOut className="h-4 w-4" strokeWidth={1.9} />
          {loggingOut ? 'Saindo…' : 'Sair'}
        </button>
        <ThemeToggle />
      </div>

      {/* Versão do sistema, ancorada no canto inferior esquerdo */}
      <p
        className="mt-2.5 px-3 font-mono text-[11px] leading-none text-[var(--ink-3)]"
        title={`Versão ${APP_VERSION}`}
      >
        v{APP_VERSION}
      </p>
    </div>
  )

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* ─── Barra lateral (desktop) ─────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface)]/70 backdrop-blur-xl lg:flex">
        <div className="flex h-[58px] items-center border-b border-[var(--line)] px-4">
          {brandHeader}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">{nav}</div>

        {footer}
      </aside>

      {/* ─── Barra lateral (celular) ─────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px] fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 flex h-full w-[264px] flex-col border-r border-[var(--line-strong)] bg-[var(--surface)] scale-in">
            <div className="flex h-[58px] items-center justify-between border-b border-[var(--line)] px-4">
              {brandHeader}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Fechar menu"
                className="rounded-md p-1.5 text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">{nav}</div>
            {footer}
          </aside>
        </div>
      )}

      {/* ─── Conteúdo ────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[58px] items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)]/80 px-4 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            className="rounded-lg p-2 text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
          {brandHeader}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cabeçalho de página
   ═══════════════════════════════════════════════════════════════════════════ */

export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
  meta,
  flush,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  breadcrumb?: React.ReactNode
  meta?: React.ReactNode
  /** Remove a borda inferior, para quando vier uma barra de abas logo abaixo */
  flush?: boolean
}) {
  return (
    <div
      className={cn(
        'relative bg-[var(--surface)]/40',
        !flush && 'border-b border-[var(--line)]',
      )}
    >
      <div className="mx-auto max-w-[1400px] px-5 pb-5 pt-6 sm:px-7">
        {breadcrumb && <div className="mb-3">{breadcrumb}</div>}

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[26px] font-bold leading-[1.1] tracking-[-0.04em] text-[var(--ink)]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--ink-2)]">
                {description}
              </p>
            )}
            {meta && <div className="mt-3">{meta}</div>}
          </div>

          {action && <div className="shrink-0">{action}</div>}
        </div>
      </div>
    </div>
  )
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mx-auto max-w-[1400px] px-5 py-6 sm:px-7', className)}>{children}</div>
  )
}
