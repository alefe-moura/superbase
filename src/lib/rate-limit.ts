import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { systemDb, systemDbReady } from './db'

/**
 * Rate limit em duas camadas.
 *
 * O problema de fundo é o mesmo que tirou o login próprio do sistema: na
 * Vercel cada instância é um processo novo, então um contador em memória
 * nasce zerado toda vez que uma sobe. Sozinho, ele não segura força bruta:
 * basta espalhar as tentativas. Ver DECISOES.md e a migration 0002.
 *
 * Camada 1, memória da instância. Sem ida ao banco, custo zero.
 * Camada 2, tabela `rate_limits` no banco do sistema, que é o número real
 * somando todas as instâncias.
 *
 * As duas usam o MESMO teto, e isso é de propósito. A contagem de uma
 * instância nunca é maior que a soma de todas, então o que a camada 1
 * recusa a camada 2 também recusaria. Ela não inventa bloqueio: só evita a
 * viagem ao banco quando a resposta já é conhecida, exatamente o caso de
 * uma enxurrada, quando o banco é o que menos queremos ocupar.
 */

/* ── Identificação do cliente ────────────────────────────────────────── */

/**
 * IP de quem chamou.
 *
 * Atrás de proxy, o IP do socket é sempre o do proxy, então o endereço real
 * vem em cabeçalho. Na Vercel quem manda é `x-forwarded-for`, e o PRIMEIRO
 * item é o cliente: os seguintes foram acrescentados pelos proxies do
 * caminho. Ler o último entregaria o balde para o atacante, que pode mandar
 * o cabeçalho que quiser.
 *
 * Sem nenhum cabeçalho (chamada local, teste), cai num balde compartilhado.
 * É o comportamento certo: melhor limitar demais um caso raro do que abrir
 * uma saída para quem souber omitir o cabeçalho.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return headers.get('x-real-ip')?.trim() || 'sem-ip'
}

/**
 * O balde vai para o banco como hash, nunca em texto.
 *
 * Um IP é dado pessoal e um e-mail identifica quem tentou entrar. Guardando
 * só o SHA-256, a tabela continua contando certo e não entrega nada a quem
 * conseguir lê-la. O escopo entra no hash para que o mesmo IP tenha baldes
 * separados no login e no MCP.
 */
function bucketKey(scope: string, identity: string): string {
  return crypto.createHash('sha256').update(`${scope}:${identity}`).digest('hex')
}

/* ── Camada 1: memória da instância ──────────────────────────────────── */

interface Janela {
  count: number
  expiresAt: number
}

const memoria = new Map<string, Janela>()

/**
 * Teto de chaves na memória. Sem ele, um ataque distribuído criaria uma
 * entrada por IP e o processo cresceria até morrer, trocando um ataque de
 * força bruta por um de memória.
 */
const MAX_CHAVES = 10_000

function baterNaMemoria(chave: string, limite: number, segundos: number): boolean {
  const agora = Date.now()
  const atual = memoria.get(chave)

  if (!atual || atual.expiresAt <= agora) {
    if (memoria.size >= MAX_CHAVES) limparMemoria(agora)
    memoria.set(chave, { count: 1, expiresAt: agora + segundos * 1000 })
    return true
  }

  atual.count += 1
  return atual.count <= limite
}

/** Tira as janelas vencidas; se ainda estiver cheio, esvazia tudo. */
function limparMemoria(agora: number): void {
  for (const [chave, janela] of memoria) {
    if (janela.expiresAt <= agora) memoria.delete(chave)
  }

  // Todas ainda válidas: o mapa está sob ataque distribuído. Zerar é a saída
  // segura, porque o pior efeito é uma rodada de contagem perdida e a camada
  // do banco continua contando certo, que é onde mora a verdade.
  if (memoria.size >= MAX_CHAVES) memoria.clear()
}

/* ── Camada 2: banco do sistema ──────────────────────────────────────── */

export interface RateLimitResult {
  ok: boolean
  /** Segundos até a janela virar. Vai no Retry-After. */
  retryAfter: number
  limit: number
  remaining: number
}

/**
 * Conta uma tentativa e diz se ela passa.
 *
 * Falha ABERTA quando o banco não responde, e registra no log. É uma escolha
 * com contrapartida: um banco fora do ar desliga o limite. O outro caminho,
 * falhar fechado, transformaria qualquer soluço do banco em queda total do
 * sistema, e o limite existe para manter o sistema de pé, não para derrubá-lo
 * sozinho. A camada 1 continua valendo nessa janela, e o caminho protegido
 * mais crítico (o login) depende do mesmo Supabase: se ele está fora, não há
 * o que forçar.
 */
export async function rateLimit(input: {
  scope: string
  identity: string
  limit: number
  seconds: number
}): Promise<RateLimitResult> {
  const { scope, identity, limit, seconds } = input
  const chave = bucketKey(scope, identity)

  const negar = (): RateLimitResult => ({
    ok: false,
    retryAfter: seconds,
    limit,
    remaining: 0,
  })

  // Camada 1: não vai ao banco quando a resposta já é não.
  if (!baterNaMemoria(chave, limit, seconds)) return negar()

  if (!systemDbReady()) {
    return { ok: true, retryAfter: 0, limit, remaining: limit }
  }

  try {
    const { data, error } = await systemDb()
      .rpc('rate_limit_hit', {
        p_bucket: chave,
        p_limit: limit,
        p_seconds: seconds,
      })
      .single<{ allowed: boolean; used: number; reset_at: string }>()

    if (error || !data) {
      // A função pode não existir ainda (migration 0009 não aplicada). Sem ela
      // o sistema volta a funcionar como antes, com a camada 1 só.
      console.error('[rate-limit] rate_limit_hit falhou:', error?.message ?? 'sem dados')
      return { ok: true, retryAfter: 0, limit, remaining: limit }
    }

    const resetAt = new Date(data.reset_at).getTime()
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))

    return {
      ok: data.allowed,
      retryAfter,
      limit,
      remaining: Math.max(0, limit - data.used),
    }
  } catch (err) {
    console.error('[rate-limit] falha ao consultar o banco:', err)
    return { ok: true, retryAfter: 0, limit, remaining: limit }
  }
}

/* ── Resposta ────────────────────────────────────────────────────────── */

/**
 * O 429 padrão.
 *
 * `Retry-After` é o que faz um cliente educado esperar em vez de repetir na
 * hora, e é o cabeçalho que os agentes de IA respeitam. A mensagem não conta
 * qual limite foi atingido nem quantas tentativas faltavam: isso ajudaria a
 * calibrar um ataque.
 */
export function tooManyRequests(
  result: RateLimitResult,
  mensagem = 'Muitas tentativas. Aguarde e tente de novo.',
): NextResponse {
  return NextResponse.json(
    { error: mensagem },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter),
        'RateLimit-Limit': String(result.limit),
        'RateLimit-Remaining': String(result.remaining),
        'RateLimit-Reset': String(result.retryAfter),
      },
    },
  )
}

/* ── Limites ─────────────────────────────────────────────────────────── */

/**
 * Os tetos, num lugar só.
 *
 * Calibrados para não incomodar uso real: um humano não tenta entrar 10 vezes
 * em 15 minutos, e um agente que dispara ferramentas em paralelo raramente
 * passa de 120 chamadas por minuto. Quem bate nesses números está fazendo
 * outra coisa.
 */
export const LIMITES = {
  /** Login, por IP e e-mail. Estreito: é a porta da frente. */
  LOGIN_IDENTIDADE: { limit: 10, seconds: 15 * 60 },

  /**
   * Login, por IP, independente do e-mail. Sem isto, alguém percorreria uma
   * lista de e-mails com poucas tentativas em cada e nunca bateria no teto
   * acima. É o limite que barra a varredura.
   */
  LOGIN_IP: { limit: 30, seconds: 15 * 60 },

  /** MCP por token. Generoso: agente legítimo trabalha em rajada. */
  MCP_TOKEN: { limit: 120, seconds: 60 },

  /**
   * MCP por IP, para quem apresentou algum token. Teto alto, porque vários
   * agentes podem sair do mesmo endereço. Serve contra um caso específico: o
   * balde do token é do token, então quem inventasse um token diferente a
   * cada chamada teria balde novo sempre. Este é o que segura a rotação.
   */
  MCP_IP: { limit: 300, seconds: 60 },

  /**
   * MCP sem token nenhum, por IP. Cada chamada anônima custa uma consulta ao
   * banco; é o que precisa de teto baixo. Força bruta de token é inviável por
   * entropia (32 bytes aleatórios), então o que se protege aqui é o banco.
   */
  MCP_ANONIMO: { limit: 20, seconds: 60 },

  /** Cron chamado com segredo errado. */
  CRON: { limit: 10, seconds: 60 },
} as const
