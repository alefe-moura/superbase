import { NextResponse } from 'next/server'
import { errorResponse, guard } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { ensurePublishableKey, getProjectCredentials } from '@/lib/projects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Revela as chaves de um projeto. Sempre sob ação explicita do usuário
 * e sempre auditado, nunca vem junto do carregamento da pagina.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params

  try {
    const creds = await getProjectCredentials(id)
    if (!creds) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

    const publishableKey = await ensurePublishableKey(creds)

    await audit({
      action: 'project.keys_revealed',
      projectId: id,
      detail: creds.project.name,
      actor: g.session.email,
    })

    return NextResponse.json({
      anon_key: creds.anonKey,
      publishable_key: publishableKey,
      service_key: creds.serviceKey,
      db_url: creds.dbUrl,
      url: creds.project.url,
      // PAT da conta de origem: e o que a CLI e o MCP oficial pedem como
      // SUPABASE_ACCESS_TOKEN. Vale para a conta inteira, nao so este projeto.
      access_token: creds.pat,
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao revelar as chaves.')
  }
}
