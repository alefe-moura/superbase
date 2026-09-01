import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { encryptSecret, randomToken } from '@/lib/crypto'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getAccountPat } from '@/lib/accounts'
import { createProject, getProjectKeys, pickKeys } from '@/lib/gateway/management'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface CreateBody {
  name: string
  organization_slug: string
  region?: string
  client_id?: string | null
  /** Se omitida, geramos uma senha forte, o caminho recomendado. */
  db_pass?: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Busca as chaves de um projeto recem-criado, com paciencia: nos primeiros
 * segundos o projeto ainda esta subindo e a API pode responder 404.
 *
 * Nao insistir muito e proposital: a requisicao nao pode ficar pendurada.
 * Sem as chaves agora, o "Ressincronizar" da conta as traz depois.
 */
async function fetchKeysWithRetry(pat: string, ref: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(4000)
    try {
      return pickKeys(await getProjectKeys(pat, ref))
    } catch {
      // segue tentando
    }
  }
  return null
}

/**
 * Cria um projeto novo dentro da conta, na Supabase, e ja o adiciona a
 * carteira. E o caminho para contas "vazias": conectar o token primeiro,
 * criar os projetos daqui depois.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const body = await parseBody<CreateBody>(request)

  if (!body?.name?.trim() || !body.organization_slug?.trim()) {
    return NextResponse.json(
      { error: 'Informe o nome do projeto e a organização onde ele vai nascer.' },
      { status: 400 },
    )
  }

  try {
    const found = await getAccountPat(id)
    if (!found) {
      return NextResponse.json(
        { error: 'Conta não encontrada ou sem token utilizável.' },
        { status: 404 },
      )
    }

    const { account, pat } = found
    const name = body.name.trim()

    // A senha do banco so existe nesta requisicao: a Supabase nao a devolve
    // depois. Por isso ela volta na resposta, para a tela mostrar uma vez.
    const dbPass = body.db_pass?.trim() || randomToken(24)

    const remote = await createProject(pat, {
      name,
      organizationSlug: body.organization_slug.trim(),
      dbPass,
      region: body.region?.trim() || undefined,
    })

    const ref = remote.ref
    if (!ref) throw new Error('A Supabase criou o projeto mas não devolveu o ref dele.')

    const url = `https://${ref}.supabase.co`
    const keys = await fetchKeysWithRetry(pat, ref)

    const db = systemDb()
    const { data: created, error } = await db
      .from('projects')
      .insert({
        account_id: id,
        client_id: body.client_id || null,
        ref,
        name,
        url,
        account_email: account.login_email,
        anon_key_enc: keys?.anon ? encryptSecret(keys.anon) : null,
        publishable_key_enc: keys?.publishable ? encryptSecret(keys.publishable) : null,
        service_key_enc: keys?.service ? encryptSecret(keys.service) : null,
        // A connection string direta, montada com a senha que acabamos de
        // gerar, a unica hora em que ela passa por aqui.
        db_url_enc: encryptSecret(
          `postgresql://postgres:${encodeURIComponent(dbPass)}@db.${ref}.supabase.co:5432/postgres`,
        ),
        source: 'sync' as const,
        status: remote.status,
        region: remote.region,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !created) {
      // O projeto existe na Supabase; so a carteira ficou para tras. Dizer
      // isso e melhor que um "falhou" que sugere que nada aconteceu.
      throw new Error(
        `O projeto ${name} foi criado na Supabase (${ref}), mas não entrou na carteira: ${
          error?.message ?? 'falha ao salvar'
        }. Use "Ressincronizar" na conta.`,
      )
    }

    await audit({
      action: 'project.provisioned',
      projectId: created.id,
      detail: `${name} criado em ${account.login_email} (${body.organization_slug.trim()})`,
      actor: g.session.email,
      meta: { ref, region: remote.region, keys_ready: Boolean(keys?.service) },
    })

    return NextResponse.json({
      ok: true,
      id: created.id,
      ref,
      url,
      name,
      status: remote.status,
      /** Só nesta resposta. Depois daqui, ninguém mais consegue lê-la. */
      db_pass: dbPass,
      keys_ready: Boolean(keys?.service),
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao criar o projeto na Supabase.')
  }
}
