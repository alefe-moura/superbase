import { redirect } from 'next/navigation'
import { getSession, allowedEmails } from '@/lib/session'
import { systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { authReady } from '@/lib/auth/client'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await getSession()
  if (session) redirect('/')

  const configured = systemDbReady() && vaultReady() && authReady() && allowedEmails().length > 0

  return <LoginForm configured={configured} />
}
