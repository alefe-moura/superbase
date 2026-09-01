import { requireSession } from '@/lib/session'
import { AppShell } from '@/components/AppShell'

export const dynamic = 'force-dynamic'

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  return <AppShell email={session.email}>{children}</AppShell>
}
