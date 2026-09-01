import Link from 'next/link'
import { Plug } from 'lucide-react'
import { systemDb, systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { listProjectsWithMeta } from '@/lib/projects'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Alert, Badge, Card, EmptyState, HealthDot } from '@/components/ui/Primitives'
import { Button } from '@/components/ui/Button'
import { PortfolioGrid } from './PortfolioGrid'
import type { Client, Health } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  if (!systemDbReady() || !vaultReady()) {
    return (
      <>
        <PageHeader title="Carteira" />
        <PageBody>
          <Alert tone="warn" title="Sistema não configurado">
            Defina as variáveis de ambiente do banco do sistema e do cofre. Rode{' '}
            <code className="rounded bg-[var(--void)] px-1 py-0.5 font-mono text-[11px]">
              npm run check
            </code>{' '}
            para ver o que falta.
          </Alert>
        </PageBody>
      </>
    )
  }

  const [projects, { data: clients }] = await Promise.all([
    listProjectsWithMeta(),
    systemDb().from('clients').select('*').order('name').returns<Client[]>(),
  ])

  // Resumo da carteira exibido junto ao título
  const tally = projects.reduce<Record<Health, number>>(
    (acc, p) => {
      const h = p.latest_snapshot?.overall_health ?? 'unknown'
      acc[h] = (acc[h] ?? 0) + 1
      return acc
    },
    { healthy: 0, degraded: 0, down: 0, unknown: 0 },
  )

  const meta = projects.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="font-mono text-[12px] tabular-nums text-[var(--ink-2)]">
        <span className="text-[var(--ink)]">{projects.length}</span>{' '}
        {projects.length === 1 ? 'projeto' : 'projetos'}
      </span>

      <span className="h-3 w-px bg-[var(--line-strong)]" />

      {(
        [
          ['healthy', 'saudáveis'],
          ['degraded', 'degradados'],
          ['down', 'fora do ar'],
          ['unknown', 'sem dados'],
        ] as const
      )
        .filter(([key]) => tally[key] > 0)
        .map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5 text-[12px] text-[var(--ink-2)]">
            <HealthDot health={key} size={6} />
            <span className="font-mono tabular-nums text-[var(--ink)]">{tally[key]}</span>
            {label}
          </span>
        ))}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Carteira"
        description={
          projects.length === 0
            ? 'Nenhum projeto conectado ainda.'
            : 'Todos os projetos que você administra, em um lugar só.'
        }
        meta={meta}
        action={
          <Link href="/conexoes">
            <Button variant="primary">
              <Plug className="h-4 w-4" />
              Conectar projeto
            </Button>
          </Link>
        }
      />

      <PageBody>
        {projects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Plug className="h-5 w-5" />}
              title="Sua carteira está vazia"
              description="Conecte uma conta Supabase com o token pessoal para importar todos os projetos de uma vez, ou cadastre um projeto avulso informando URL e chaves."
              action={
                <Link href="/conexoes">
                  <Button variant="primary" size="lg">
                    Conectar o primeiro projeto
                  </Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <PortfolioGrid projects={projects} clients={clients ?? []} />
        )}
      </PageBody>
    </>
  )
}
