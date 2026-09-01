import { NextResponse } from 'next/server'
import { systemDb } from '@/lib/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { errorResponse, guard } from '@/lib/api-helpers'
import { audit } from '@/lib/audit'
import { getProjectKeys, listProjects, pickKeys } from '@/lib/gateway/management'
import type { Account, Project } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Ressincroniza a conta: detecta projetos novos, atualiza metadados/chaves
 * dos existentes e marca como sumidos os que não vieram mais na listagem.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (!g.ok) return g.response

  const { id } = await params
  const db = systemDb()

  try {
    const { data: account } = await db
      .from('accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle<Account>()

    if (!account) {
      return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
    }

    const pat = decryptSecret(account.pat_encrypted)
    const remoteProjects = await listProjects(pat)
    const remoteRefs = new Set(remoteProjects.map((p) => p.ref))

    const { data: localProjects } = await db
      .from('projects')
      .select('id, ref, name')
      .eq('account_id', id)
      .is('archived_at', null)
      .returns<Pick<Project, 'id' | 'ref' | 'name'>[]>()

    const localRefs = new Set((localProjects ?? []).map((p) => p.ref))

    const added: string[] = []
    const updated: string[] = []
    const failed: Array<{ name: string; error: string }> = []

    for (const remote of remoteProjects) {
      if (!remote.ref) continue

      try {
        const keys = await getProjectKeys(pat, remote.ref)
        const { anon, service, publishable } = pickKeys(keys)

        const payload = {
          account_id: id,
          ref: remote.ref,
          name: remote.name,
          url: `https://${remote.ref}.supabase.co`,
          account_email: account.login_email,
          anon_key_enc: anon ? encryptSecret(anon) : null,
          publishable_key_enc: publishable ? encryptSecret(publishable) : null,
          service_key_enc: service ? encryptSecret(service) : null,
          source: 'sync' as const,
          status: remote.status,
          region: remote.region,
          pg_version: remote.database?.version ?? null,
        }

        const { data: existing } = await db
          .from('projects')
          .select('id')
          .eq('ref', remote.ref)
          .maybeSingle<{ id: string }>()

        if (existing) {
          await db
            .from('projects')
            .update({ ...payload, archived_at: null })
            .eq('id', existing.id)
          if (localRefs.has(remote.ref)) updated.push(remote.name)
          else added.push(remote.name)
        } else {
          await db.from('projects').insert(payload)
          added.push(remote.name)
        }
      } catch (err) {
        failed.push({
          name: remote.name,
          error: err instanceof Error ? err.message : 'falha',
        })
      }
    }

    // Projetos que sumiram da conta: sinalizados, nunca apagados em silencio.
    const missing = (localProjects ?? []).filter((p) => p.ref && !remoteRefs.has(p.ref))
    for (const project of missing) {
      await db.from('projects').update({ status: 'REMOVED' }).eq('id', project.id)
    }

    await db
      .from('accounts')
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: failed.length ? `${failed.length} projeto(s) com erro` : null,
        status: 'active',
      })
      .eq('id', id)

    await audit({
      action: 'account.synced',
      detail: `${account.login_email}: ${added.length} novo(s), ${updated.length} atualizado(s)`,
      actor: g.session.email,
      meta: { added: added.length, updated: updated.length, missing: missing.length },
    })

    return NextResponse.json({
      ok: true,
      added,
      updated,
      missing: missing.map((p) => p.name),
      failed,
    })
  } catch (err) {
    await db
      .from('accounts')
      .update({
        status: 'invalid',
        last_error: err instanceof Error ? err.message : 'falha na sincronização',
      })
      .eq('id', id)

    return errorResponse(err, 'Falha ao ressincronizar a conta.')
  }
}
