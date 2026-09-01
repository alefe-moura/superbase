import { NextResponse } from 'next/server'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectCredentials } from '@/lib/projects'
import { deleteObject, listBuckets, listObjects, signedUrl } from '@/lib/gateway/project'

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

/** Sem `bucket`: lista os buckets. Com `bucket`: lista os arquivos. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const searchParams = new URL(request.url).searchParams
  const bucket = searchParams.get('bucket')

  try {
    const result = await credentials(id)
    if (result.error) return result.error
    const { creds } = result

    if (!bucket) {
      const buckets = await listBuckets(creds.project.url, creds.serviceKey!)
      return NextResponse.json({ buckets })
    }

    const objects = await listObjects(
      creds.project.url,
      creds.serviceKey!,
      bucket,
      searchParams.get('prefix') ?? '',
    )

    return NextResponse.json({ objects })
  } catch (err) {
    return errorResponse(err, 'Falha ao acessar o Storage.')
  }
}

/** Gera uma URL assinada temporaria para download. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ bucket: string; path: string }>(request)

  if (!body?.bucket || !body.path) {
    return NextResponse.json({ error: 'Informe o bucket e o caminho.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error

    const url = await signedUrl(
      result.creds.project.url,
      result.creds.serviceKey!,
      body.bucket,
      body.path,
    )

    return NextResponse.json({ url })
  } catch (err) {
    return errorResponse(err, 'Falha ao gerar o link.')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<{ bucket: string; path: string }>(request)

  if (!body?.bucket || !body.path) {
    return NextResponse.json({ error: 'Informe o bucket e o caminho.' }, { status: 400 })
  }

  try {
    const result = await credentials(id)
    if (result.error) return result.error

    await deleteObject(
      result.creds.project.url,
      result.creds.serviceKey!,
      body.bucket,
      body.path,
    )

    await audit({
      action: 'storage.file_deleted',
      projectId: id,
      detail: `${result.creds.project.name} · ${body.bucket}/${body.path}`,
      actor: g.session.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'Falha ao excluir o arquivo.')
  }
}
