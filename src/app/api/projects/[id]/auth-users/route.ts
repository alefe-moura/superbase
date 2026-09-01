import { NextResponse } from 'next/server'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import {
  createAuthUser,
  deleteAuthUser,
  listAuthUsers,
  updateAuthUser,
} from '@/lib/gateway/project'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function credentials(id: string) {
  const creds = await getProjectCredentials(id)
  if (!creds) {
    return { error: NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 }) }
  }
  if (!creds.serviceKey) {
    return {
      error: NextResponse.json(
        { error: 'Este projeto não tem service_role key salva.' },
        { status: 422 },
      ),
    }
  }
  return { creds }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const page = Number(new URL(request.url).searchParams.get('page')) || 1

  try {
    const result = await credentials(id)
    if (result.error) return result.error

    const { users, total } = await listAuthUsers(
      result.creds.project.url,
      result.creds.serviceKey!,
      page,
      50,
    )

    return NextResponse.json({ users, total, page })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar os usuários.')
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ email: string; password?: string; email_confirm?: boolean }>(
    request,
  )

  if (!body?.email?.trim()) {
    return NextResponse.json({ error: 'Informe o e-mail.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error

    const user = await createAuthUser(result.creds.project.url, result.creds.serviceKey!, {
      email: body.email.trim(),
      password: body.password,
      email_confirm: body.email_confirm ?? true,
    })

    await audit({
      action: 'auth.user_created',
      projectId: id,
      detail: `${result.creds.project.name} · ${body.email.trim()}`,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true, user })
  } catch (err) {
    return errorResponse(err, 'Falha ao criar o usuário.')
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{
    userId: string
    payload: Record<string, unknown>
    action?: string
  }>(request)

  if (!body?.userId || !body.payload) {
    return NextResponse.json({ error: 'Informe o usuário e os dados.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error

    const user = await updateAuthUser(
      result.creds.project.url,
      result.creds.serviceKey!,
      body.userId,
      body.payload,
    )

    await audit({
      action: 'auth.user_updated',
      projectId: id,
      detail: `${result.creds.project.name} · ${body.action ?? 'alteração'} · ${user.email ?? body.userId}`,
      actor: g.session.email,
      meta: { fields: Object.keys(body.payload) },
    })

    return NextResponse.json({ ok: true, user })
  } catch (err) {
    return errorResponse(err, 'Falha ao atualizar o usuário.')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ userId: string; email?: string }>(request)

  if (!body?.userId) {
    return NextResponse.json({ error: 'Informe o usuário.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error

    await deleteAuthUser(result.creds.project.url, result.creds.serviceKey!, body.userId)

    await audit({
      action: 'auth.user_deleted',
      projectId: id,
      detail: `${result.creds.project.name} · ${body.email ?? body.userId}`,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao excluir o usuário.')
  }
}
