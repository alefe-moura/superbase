import { systemDb, systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { PageBody, PageHeader } from '@/components/AppShell'
import { Alert } from '@/components/ui/Primitives'
import { ConnectionsClient } from './ConnectionsClient'
import type { Client } from '@/lib/types'

export const dynamic = 'force-dynamic'

export interface AccountRow {
  id: string
  login_email: string
  alias: string | null
  status: string
  last_sync_at: string | null
  last_error: string | null
  project_count: number
}

export default async function ConnectionsPage() {
  if (!systemDbReady() || !vaultReady()) {
    return (
      <>
        <PageHeader title="Conexões" />
        <PageBody>
          <Alert tone="warn" title="Sistema não configurado">
            Configure as variaveis de ambiente antes de conectar projetos. Passo a passo no{' '}
            <span className="font-mono text-[11px]">MANUAL.md</span>.
          </Alert>
        </PageBody>
      </>
    )
  }

  const db = systemDb()

  const [{ data: accounts }, { data: clients }, { data: projectCounts }, { data: manualProjects }] =
    await Promise.all([
      db
        .from('accounts')
        .select('id, login_email, alias, status, last_sync_at, last_error')
        .order('login_email'),
      db.from('clients').select('*').order('name').returns<Client[]>(),
      db.from('projects').select('account_id').is('archived_at', null),
      db
        .from('projects')
        .select('id, name, url, account_email, created_at')
        .eq('source', 'manual')
        .is('archived_at', null)
        .order('name'),
    ])

  const countByAccount = new Map<string, number>()
  for (const row of projectCounts ?? []) {
    if (row.account_id) {
      countByAccount.set(row.account_id, (countByAccount.get(row.account_id) ?? 0) + 1)
    }
  }

  const accountRows: AccountRow[] = (accounts ?? []).map((a) => ({
    ...a,
    project_count: countByAccount.get(a.id) ?? 0,
  }))

  return (
    <>
      <PageHeader
        title="Conexões"
        description="Conecte contas inteiras via token ou cadastre projetos avulsos com URL e chaves."
      />
      <PageBody>
        <ConnectionsClient
          accounts={accountRows}
          clients={clients ?? []}
          manualProjects={manualProjects ?? []}
        />
      </PageBody>
    </>
  )
}
