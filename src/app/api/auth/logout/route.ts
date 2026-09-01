import { NextResponse } from 'next/server'
import { getSession, signOut } from '@/lib/session'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getSession()
  await signOut()

  if (session) {
    await audit({ action: 'logout', actor: session.email })
  }

  return NextResponse.json({ ok: true })
}
