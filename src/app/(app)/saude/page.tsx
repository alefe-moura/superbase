import { systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { listProjectsWithMeta } from '@/lib/projects'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Alert } from '@/components/ui/Primitives'
import { HealthClient } from './HealthClient'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  if (!systemDbReady() || !vaultReady()) {
    return (
      <>
        <PageHeader title="Saúde geral" />
        <PageBody>
          <Alert tone="warn" title="Sistema não configurado">
            Configure as variaveis de ambiente. Veja o{' '}
            <span className="font-mono text-[11px]">MANUAL.md</span>.
          </Alert>
        </PageBody>
      </>
    )
  }

  const projects = await listProjectsWithMeta()

  return <HealthClient projects={projects} />
}
