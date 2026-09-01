import { systemDb, systemDbReady } from '@/lib/db'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Alert } from '@/components/ui/Primitives'
import { AuditClient } from './AuditClient'
import type { AuditLog, Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  if (!systemDbReady()) {
    return (
      <>
        <PageHeader title="Auditoria" />
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

  const [{ data: logs }, { data: projects }] = await Promise.all([
    db
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
      .returns<AuditLog[]>(),
    db
      .from('projects')
      .select('id, name')
      .order('name')
      .returns<Array<Pick<Project, 'id' | 'name'>>>(),
  ])

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Toda ação sensivel sobre os projetos dos clientes fica registrada aqui."
      />
      <PageBody>
        <AuditClient logs={logs ?? []} projects={projects ?? []} />
      </PageBody>
    </>
  )
}
