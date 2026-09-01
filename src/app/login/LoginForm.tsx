'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Alert } from '@/components/ui/Primitives'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Logomark } from '@/components/Brand'

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Não foi possível entrar.')
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('Falha de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <div className="flex justify-end p-5">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-5 pb-28">
        <div className="w-full max-w-[380px] stagger">
          {/* ─── Marca ─────────────────────────────────────────────────── */}
          <div className="mb-9 flex flex-col items-center text-center">
            <Logomark size={52} />

            <h1 className="mt-6 font-display text-[30px] font-bold leading-none tracking-[-0.045em] text-[var(--ink)]">
              SuperBase
            </h1>

            <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
              Seus projetos Supabase, em um lugar só.
            </p>
          </div>

          {!configured && (
            <Alert tone="warn" title="Sistema não configurado" className="mb-5">
              Faltam variáveis de ambiente. Rode{' '}
              <code className="rounded bg-[var(--void)] px-1 py-0.5 font-mono text-[11px] text-[var(--ink)]">
                npm run check
              </code>{' '}
              para ver o que falta.
            </Alert>
          )}

          {/* ─── Formulário ────────────────────────────────────────────── */}
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)]/80 p-6 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
          >
            <Input
              label="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="você@exemplo.com"
              autoComplete="username"
              required
              autoFocus
            />

            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
            />

            {error && <Alert tone="alert">{error}</Alert>}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center"
              loading={loading}
              disabled={!configured}
            >
              {!loading && (
                <>
                  Entrar
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </>
              )}
              {loading && 'Entrando…'}
            </Button>
          </form>

          <p className="mt-6 flex items-center justify-center gap-2 text-center text-[11.5px] text-[var(--ink-4)]">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.9} />
            Credenciais dos clientes criptografadas em repouso
          </p>
        </div>
      </div>
    </div>
  )
}
