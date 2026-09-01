import { systemDb, systemDbReady } from '@/lib/db'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Alert } from '@/components/ui/Primitives'
import { AgentsClient } from './AgentsClient'
import type { Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  if (!systemDbReady()) {
    return (
      <>
        <PageHeader title="Agentes" />
        <PageBody>
          <Alert tone="warn" title="Sistema não configurado">
            Configure as variáveis de ambiente. Veja o{' '}
            <span className="font-mono text-[11px]">MANUAL.md</span>.
          </Alert>
        </PageBody>
      </>
    )
  }

  const { data: projects } = await systemDb()
    .from('projects')
    .select('id, name')
    .is('archived_at', null)
    .order('name')
    .returns<Array<Pick<Project, 'id' | 'name'>>>()

  return (
    <>
      <PageHeader
        title="Agentes"
        description="Conecte seus agentes de IA a todos os projetos por um único MCP, sem que eles precisem saber em qual conta cada projeto está, e sem nunca verem uma chave."
      />
      <PageBody>
        <AgentsClient projects={projects ?? []} />
      </PageBody>
    </>
  )
}
