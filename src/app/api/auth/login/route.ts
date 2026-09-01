import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { systemDbReady } from '@/lib/db'
import { vaultReady } from '@/lib/crypto'
import { authClient, authReady } from '@/lib/auth/client'
import { allowedEmails, isAllowed } from '@/lib/session'
import { audit } from '@/lib/audit'
import { clientIp, rateLimit, tooManyRequests, LIMITES } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Login via Supabase Auth.
 *
 * O GoTrue tem rate limit próprio e centralizado, mas ele só vale para quem
 * chega até lá. E-mail fora da allowlist era recusado ANTES da chamada ao
 * Auth, gravando uma linha de auditoria por tentativa: um laço com e-mails
 * inventados inundava a tabela e consumia conexão do banco sem nunca esbarrar
 * em limite nenhum. O teto daqui fecha esse caminho.
 *
 * São dois baldes, e o segundo é o que importa contra varredura. Só por
 * IP+e-mail, bastaria trocar de e-mail a cada dez tentativas para nunca
 * atingir o limite; só por IP, uma senha errada de alguém legítimo gastaria
 * a cota do escritório inteiro. Juntos, cada um cobre o furo do outro.
 */
export async function POST(request: Request) {
  if (!systemDbReady() || !vaultReady() || !authReady()) {
    return NextResponse.json(
      { error: 'Sistema não configurado. Veja o MANUAL.md.' },
      { status: 503 },
    )
  }

  if (!allowedEmails().length) {
    return NextResponse.json(
      {
        error:
          'Nenhum e-mail autorizado configurado. Defina ALLOWED_EMAILS no ambiente antes de usar o sistema.',
      },
      { status: 503 },
    )
  }

  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const password = body.password

  if (!email || !password) {
    return NextResponse.json({ error: 'Informe e-mail e senha.' }, { status: 400 })
  }

  // O teto vem antes da allowlist e antes da auditoria, senão a própria
  // tentativa recusada continuaria custando uma escrita no banco.
  const ip = clientIp(await headers())

  const porIp = await rateLimit({
    scope: 'login:ip',
    identity: ip,
    ...LIMITES.LOGIN_IP,
  })

  if (!porIp.ok) {
    return tooManyRequests(porIp, 'Muitas tentativas de login. Aguarde e tente de novo.')
  }

  const porIdentidade = await rateLimit({
    scope: 'login:identidade',
    identity: `${ip}|${email}`,
    ...LIMITES.LOGIN_IDENTIDADE,
  })

  if (!porIdentidade.ok) {
    return tooManyRequests(porIdentidade, 'Muitas tentativas de login. Aguarde e tente de novo.')
  }

  // Barra antes de bater no Auth: e-mail fora da allowlist nem tenta.
  if (!isAllowed(email)) {
    await audit({ action: 'login.failure', detail: `${email} (fora da allowlist)`, actor: email })
    return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 })
  }

  try {
    const supabase = await authClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error || !data.user) {
      // O motivo real fica no log do servidor; o cliente recebe sempre a
      // mesma mensagem generica, para não revelar quais e-mails existem.
      console.warn(
        `[login] recusado para ${email}: code=${error?.code ?? '?'} status=${error?.status ?? '?'} msg=${error?.message ?? 'sem usuário'}`,
      )

      await audit({
        action: 'login.failure',
        detail: `${email}, ${error?.code ?? 'desconhecido'}`,
        actor: email,
      })

      // O GoTrue devolve 429 quando o rate limit dele dispara.
      if (error?.status === 429) {
        return NextResponse.json(
          { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
          { status: 429 },
        )
      }

      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 })
    }

    // Defesa em profundidade: confere a allowlist também no usuário retornado.
    if (!isAllowed(data.user.email)) {
      await supabase.auth.signOut()
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 })
    }

    await audit({ action: 'login.success', actor: data.user.email })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[login]', err)
    return NextResponse.json({ error: 'Falha ao autenticar.' }, { status: 500 })
  }
}
