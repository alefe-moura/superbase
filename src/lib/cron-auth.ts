import crypto from 'node:crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from './session'
import { clientIp, rateLimit, tooManyRequests, LIMITES } from './rate-limit'

/**
 * Autorização das rotas de cron, num lugar só.
 *
 * As duas rotas (`/api/cron/snapshot` e `/api/cron/backup`) tinham a mesma
 * função copiada, e as duas ficam FORA do matcher do middleware: quem chega
 * nelas chega sem passar por mais nada. Vale ter o cuidado concentrado aqui.
 */

/**
 * Compara em tempo constante.
 *
 * `a === b` em JavaScript para no primeiro caractere diferente, então o tempo
 * de resposta vaza quantos caracteres do segredo foram acertados. Explorar
 * isso pela rede é difícil, mas a correção é uma linha e não custa nada.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho, senão lança. Comparamos o
 * hash dos dois lados: sempre 32 bytes, e o tamanho do segredo não vaza junto.
 */
function segredoConfere(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false

  const a = crypto.createHash('sha256').update(recebido).digest()
  const b = crypto.createHash('sha256').update(esperado).digest()

  return crypto.timingSafeEqual(a, b)
}

/**
 * Diz se a chamada pode rodar; devolve a resposta de recusa quando não pode.
 *
 * A ordem importa. O teto vem primeiro porque a verificação de sessão é uma
 * ida à rede, ao Supabase Auth: sem limite, repetir a chamada sem credencial
 * nenhuma fazia o sistema gastar uma requisição externa por tentativa. Quem
 * paga essa conta é o dono do sistema, não quem ataca.
 */
export async function autorizarCron(): Promise<NextResponse | null> {
  const h = await headers()

  const limite = await rateLimit({
    scope: 'cron',
    identity: clientIp(h),
    ...LIMITES.CRON,
  })

  if (!limite.ok) return tooManyRequests(limite)

  // 1. Segredo compartilhado, que é como a Vercel dispara o agendamento.
  const secret = process.env.CRON_SECRET
  if (secret && segredoConfere(h.get('authorization'), `Bearer ${secret}`)) return null

  // 2. Cabeçalho que a Vercel põe nos próprios disparos. A borda dela remove
  //    esse cabeçalho quando vem de fora, então ele não é falsificável em
  //    produção, mas ele sozinho não é uma credencial. Mantenha o CRON_SECRET
  //    configurado: é ele que protege a rota fora da Vercel.
  if (h.get('x-vercel-cron')) return null

  // 3. Sessão do app, para o botão "Coletar tudo agora" na interface.
  if (await getSession()) return null

  return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
}
