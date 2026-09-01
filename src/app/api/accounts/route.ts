import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { errorResponse, guard, parseBody } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { listProjects, pickKeys, getProjectKeys, validatePat } from '@/lib/gateway/management'
import type { Account } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lista as contas conectadas (nunca devolve o PAT). */
export async function GET() {
  const g = await guard()
  if (!g.ok) return g.response

  try {
    const { data, error } = await systemDb()
      .from('accounts')
      .select('id, login_email, alias, status, last_sync_at, last_error, created_at')
      .order('login_email')

    if (error) throw new Error(error.message)

    const { data: counts } = await systemDb()
      .from('projects')
      .select('account_id')
      .is('archived_at', null)

    const byAccount = new Map<string, number>()
    for (const row of counts ?? []) {
      if (row.account_id) byAccount.set(row.account_id, (byAccount.get(row.account_id) ?? 0) + 1)
    }

    return NextResponse.json({
      accounts: (data ?? []).map((a) => ({ ...a, project_count: byAccount.get(a.id) ?? 0 })),
    })
  } catch (err) {
    return errorResponse(err, 'Falha ao listar contas.')
  }
}

interface ConnectBody {
  login_email: string
  pat: string
  alias?: string
  /**
   * Quais projetos importar. Omitido = todos. Lista vazia = nenhum, que e o
   * caso de uma conta ainda sem projetos (ou de quem quer so guardar o token
   * para criar projetos depois).
   */
  refs?: string[]
  /** Apenas valida e lista, sem gravar nada. */
  previewOnly?: boolean
}

/**
 * Conecta uma conta via PAT: valida, lista os projetos e importa
 * (buscando as chaves de cada um automaticamente).
 */
export async function POST(request: Request) {
  const g = await guard()
  if (!g.ok) return g.response

  const body = await parseBody<ConnectBody>(request)
  if (!body?.pat || !body.login_email) {
    return NextResponse.json({ error: 'Informe o e-mail da conta e o token.' }, { status: 400 })
  }

  const pat = body.pat.trim()
  const loginEmail = body.login_email.trim().toLowerCase()

  try {
    // 1. Valida o token antes de qualquer escrita.
    const organizations = await validatePat(pat)
    const remoteProjects = await listProjects(pat)

    // Modo preview: so devolve a lista para o usuário escolher. As
    // organizacoes vao junto porque, numa conta sem projeto nenhum, sao elas
    // que mostram que o token e valido e que ha onde criar.
    if (body.previewOnly) {
      return NextResponse.json({
        preview: true,
        organizations: organizations.map((o) => ({ slug: o.slug, name: o.name })),
        projects: remoteProjects.map((p) => ({
          ref: p.ref,
          name: p.name,
          region: p.region,
          status: p.status,
          created_at: p.created_at,
        })),
      })
    }

    const db = systemDb()

    // 2. Grava (ou atualiza) a conta.
    const { data: existing } = await db
      .from('accounts')
      .select('id')
      .ilike('login_email', loginEmail)
      .maybeSingle<Pick<Account, 'id'>>()

    const accountPayload = {
      login_email: loginEmail,
      alias: body.alias?.trim() || null,
      pat_encrypted: encryptSecret(pat),
      status: 'active' as const,
      last_sync_at: new Date().toISOString(),
      last_error: null,
    }

    let accountId: string
    if (existing) {
      await db.from('accounts').update(accountPayload).eq('id', existing.id)
      accountId = existing.id
    } else {
      const { data: created, error } = await db
        .from('accounts')
        .insert(accountPayload)
        .select('id')
        .single<Pick<Account, 'id'>>()

      if (error || !created) throw new Error(error?.message ?? 'Falha ao salvar a conta.')
      accountId = created.id
    }

    // 3. Importa os projetos escolhidos, buscando as chaves de cada um.
    // `refs` ausente importa tudo; `refs` vazio importa nada: sao intencoes
    // diferentes, e a conta e salva do mesmo jeito nos dois casos.
    const wanted = body.refs
      ? remoteProjects.filter((p) => body.refs!.includes(p.ref!))
      : remoteProjects

    const imported: string[] = []
    const failed: Array<{ name: string; error: string }> = []

    for (const remote of wanted) {
      if (!remote.ref) continue

      try {
        const keys = await getProjectKeys(pat, remote.ref)
        const { anon, service, publishable } = pickKeys(keys)

        const payload = {
          account_id: accountId,
          ref: remote.ref,
          name: remote.name,
          url: `https://${remote.ref}.supabase.co`,
          account_email: loginEmail,
          anon_key_enc: anon ? encryptSecret(anon) : null,
          publishable_key_enc: publishable ? encryptSecret(publishable) : null,
          service_key_enc: service ? encryptSecret(service) : null,
          source: 'sync' as const,
          status: remote.status,
          region: remote.region,
          pg_version: remote.database?.version ?? null,
        }

        const { data: existingProject } = await db
          .from('projects')
          .select('id')
          .eq('ref', remote.ref)
          .maybeSingle<{ id: string }>()

        if (existingProject) {
          // Não sobrescreve o vinculo com cliente nem as notas ja preenchidas.
          await db
            .from('projects')
            .update({ ...payload, archived_at: null })
            .eq('id', existingProject.id)
        } else {
          await db.from('projects').insert(payload)
        }

        imported.push(remote.name)
      } catch (err) {
        failed.push({
          name: remote.name,
          error: err instanceof Error ? err.message : 'falha ao importar',
        })
      }
    }

    await audit({
      action: 'account.connected',
      detail: remoteProjects.length
        ? `${loginEmail}, ${imported.length} projeto(s) importado(s)`
        : `${loginEmail}, conta sem projetos`,
      actor: g.session.email,
      meta: { imported: imported.length, failed: failed.length },
    })

    return NextResponse.json({ ok: true, accountId, imported, failed })
  } catch (err) {
    return errorResponse(err, 'Falha ao conectar a conta.')
  }
}
