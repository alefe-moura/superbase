import { systemDb, systemDbReady } from '@/lib/db'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Alert } from '@/components/ui/Primitives'
import { ClientsClient } from './ClientsClient'
import type { Client, Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

export interface ClientWithProjects extends Client {
  projects: Array<Pick<Project, 'id' | 'name' | 'status'>>
}

export default async function ClientsPage() {
  if (!systemDbReady()) {
    return (
      <>
        <PageHeader title="Clientes" />
        <PageBody>
          <Alert tone="warn" title="Sistema não configurado">
            Configure as variaveis de ambiente. Veja o{' '}
            <span className="font-mono text-[11px]">MANUAL.md</span>.
          </Alert>
        </PageBody>
      </>
    )
  }

  const db = systemDb()

  const [{ data: clients }, { data: projects }] = await Promise.all([
    db.from('clients').select('*').order('name').returns<Client[]>(),
    db
      .from('projects')
      .select('id, name, status, client_id')
      .is('archived_at', null)
      .order('name')
      .returns<Array<Pick<Project, 'id' | 'name' | 'status' | 'client_id'>>>(),
  ])

  const byClient = new Map<string, Array<Pick<Project, 'id' | 'name' | 'status'>>>()
  const orphans: Array<Pick<Project, 'id' | 'name' | 'status'>> = []

  for (const project of projects ?? []) {
    const entry = { id: project.id, name: project.name, status: project.status }
    if (project.client_id) {
      if (!byClient.has(project.client_id)) byClient.set(project.client_id, [])
      byClient.get(project.client_id)!.push(entry)
    } else {
      orphans.push(entry)
    }
  }

  const enriched: ClientWithProjects[] = (clients ?? []).map((client) => ({
    ...client,
    projects: byClient.get(client.id) ?? [],
  }))

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Agrupe os projetos por cliente, um cliente pode ter projetos em contas diferentes."
      />
      <PageBody>
        <ClientsClient clients={enriched} orphanProjects={orphans} />
      </PageBody>
    </>
  )
}
