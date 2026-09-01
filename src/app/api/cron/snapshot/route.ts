import { NextResponse } from 'next/server'
import { systemDb, systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { collectAll } from '@/lib/gateway/collector'
import { autorizarCron } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Coletor de snapshots. Disparado pelo Vercel Cron (1x/dia, ver vercel.json),
 * pelo botão da tela Saúde geral, ou automaticamente quando essa tela abre com
 * dados vencidos.
 *
 * Autorizacao, teto de chamadas e comparacao do segredo ficam em
 * lib/cron-auth.ts, compartilhados com a rota de backup.
 */

export async function GET() {
  return runCollection()
}

export async function POST() {
  return runCollection()
}

async function runCollection() {
  const recusa = await autorizarCron()
  if (recusa) return recusa

  if (!systemDbReady() || !vaultReady()) {
    return NextResponse.json({ error: 'Sistema não configurado.' }, { status: 503 })
  }

  const startedAt = Date.now()

  try {
    const results = await collectAll()

    // Retencao: 30 dias. Falhar aqui não inválida a coleta.
    try {
      const days = Number(process.env.SNAPSHOT_RETENTION_DAYS) || 30
      await systemDb().rpc('prune_snapshots', { days })
    } catch (err) {
      console.error('[cron] falha ao limpar snapshots antigos:', err)
    }

    // Baldes de rate limit vencidos. Sem esta poda, um ataque distribuído
    // deixaria uma linha por endereço para sempre. Ver migration 0009.
    try {
      await systemDb().rpc('prune_rate_limits', { hours: 24 })
    } catch (err) {
      console.error('[cron] falha ao limpar baldes de rate limit:', err)
    }

    const failed = results.filter((r) => !r.ok)

    return NextResponse.json({
      ok: true,
      collected: results.length,
      failed: failed.length,
      durationMs: Date.now() - startedAt,
      results: results.map((r) => ({
        project: r.projectName,
        health: r.health,
        ok: r.ok,
        error: r.error,
      })),
    })
  } catch (err) {
    console.error('[cron] falha geral na coleta:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha na coleta.' },
      { status: 500 },
    )
  }
}
