/**
 * Traduz erros crus de Postgres, PostgREST e Management API para português.
 *
 * O que chegava na tela antes:
 *
 *   {"message":"Failed to run sql query: ERROR:  42P01: relation
 *   \"public.pedidos\" does not exist\nLINE 1: select * from public.pedid...
 *                                                              ^\n"}
 *
 * Ou seja: JSON, código SQLSTATE, escapes e um acento circunflexo apontando
 * para nada. Quem lê precisa saber o que fazer, não decifrar isso.
 *
 * A mensagem técnica não é jogada fora, vira detalhe secundário, porque em
 * algum momento ela vai ser o que resolve.
 */

export interface HumanError {
  /** Frase em português dizendo o que aconteceu e, quando dá, o que fazer. */
  message: string
  /** O texto original, para quando o detalhe importar. */
  detail?: string
}

/** Uma página HTML se anuncia nos primeiros bytes. */
function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html') || head.includes('<head>')
}

/** Tenta achar o título da página de erro: é onde costuma estar o essencial. */
function titleOfErrorPage(html: string): string | null {
  const title = /<title>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]
  if (!title) return null
  return title.replace(/\s+/g, ' ').trim() || null
}

/** Descasca as camadas de embrulho até sobrar a mensagem que interessa. */
function unwrap(raw: string): string {
  let text = raw.trim()

  // {"message":"..."}, às vezes aninhado
  for (let i = 0; i < 3; i++) {
    try {
      const parsed = JSON.parse(text)
      const inner =
        typeof parsed === 'string'
          ? parsed
          : (parsed?.message ?? parsed?.error ?? parsed?.msg ?? null)
      if (typeof inner !== 'string') break
      text = inner
    } catch {
      break
    }
  }

  // Página HTML no lugar de erro: acontece quando o Cloudflare responde por
  // um servidor fora do ar. Fica só o essencial do <title>.
  if (looksLikeHtml(text)) {
    const titulo = titleOfErrorPage(text)
    if (titulo) return titulo
    return 'O servidor respondeu com uma página de erro em vez de uma resposta.'
  }

  return text
    .replace(/^Failed to run sql query:\s*/i, '')
    .replace(/^ERROR:\s*/i, '')
    .replace(/^[0-9A-Z]{5}:\s*/, '') // SQLSTATE
    .replace(/\nLINE \d+:[\s\S]*$/, '') // trecho + acento circunflexo
    .replace(/\s*\^\s*$/, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extrai o nome entre aspas, sem o schema. */
function nameIn(text: string, pattern: RegExp): string | null {
  const m = pattern.exec(text)
  if (!m?.[1]) return null
  return m[1].replace(/^public\./, '').replace(/"/g, '')
}

type Rule = {
  match: RegExp
  build: (raw: string) => string
}

const RULES: Rule[] = [
  /* ── Estrutura ─────────────────────────────────────────────────────── */
  {
    match: /relation .* does not exist/i,
    build: (raw) => {
      const t = nameIn(raw, /relation "([^"]+)"/i)
      return t
        ? `A tabela “${t}” não existe neste banco. Ela pode ter sido renomeada ou apagada.`
        : 'A tabela referenciada não existe neste banco.'
    },
  },
  {
    match: /column .* does not exist/i,
    build: (raw) => {
      const c = nameIn(raw, /column "([^"]+)"/i)
      return c
        ? `A coluna “${c}” não existe. Se o schema mudou, use “Reler estrutura” na aba Tabelas.`
        : 'A coluna referenciada não existe nesta tabela.'
    },
  },
  {
    match: /schema .* does not exist/i,
    build: () => 'O schema referenciado não existe neste banco.',
  },
  {
    match: /function .* does not exist/i,
    build: () => 'A função chamada não existe neste banco.',
  },

  /* ── Restrições de integridade ─────────────────────────────────────── */
  {
    match: /duplicate key value violates unique constraint/i,
    build: (raw) => {
      const c = nameIn(raw, /constraint "([^"]+)"/i)
      return `Já existe um registro com esse valor${c ? ` (restrição “${c}”)` : ''}. Valores únicos não podem repetir.`
    },
  },
  {
    match: /violates foreign key constraint/i,
    build: () =>
      'O registro aponta para outro que não existe, ou está sendo referenciado por outros registros. Verifique as tabelas relacionadas antes de continuar.',
  },
  {
    match: /null value in column .* violates not-null/i,
    build: (raw) => {
      const c = nameIn(raw, /column "([^"]+)"/i)
      return c
        ? `A coluna “${c}” é obrigatória e não aceita ficar vazia.`
        : 'Uma coluna obrigatória ficou vazia.'
    },
  },
  {
    match: /violates check constraint/i,
    build: (raw) => {
      const c = nameIn(raw, /constraint "([^"]+)"/i)
      return `O valor não passou na regra de validação da tabela${c ? ` (“${c}”)` : ''}.`
    },
  },

  /* ── Tipos e formato ───────────────────────────────────────────────── */
  {
    match: /invalid input syntax for type (\w+)/i,
    build: (raw) => {
      const t = /invalid input syntax for type (\w+)/i.exec(raw)?.[1]
      const map: Record<string, string> = {
        integer: 'número inteiro',
        bigint: 'número inteiro',
        numeric: 'número',
        boolean: 'verdadeiro ou falso',
        date: 'data',
        timestamp: 'data e hora',
        uuid: 'identificador (UUID)',
        json: 'JSON',
        jsonb: 'JSON',
      }
      return `O valor informado não é um ${map[t ?? ''] ?? t ?? 'tipo'} válido.`
    },
  },
  {
    match: /value too long for type character varying\((\d+)\)/i,
    build: (raw) => {
      const n = /varying\((\d+)\)/i.exec(raw)?.[1]
      return `O texto é maior que o limite da coluna${n ? ` (${n} caracteres)` : ''}.`
    },
  },
  {
    match: /numeric field overflow/i,
    build: () => 'O número é grande demais para o formato desta coluna.',
  },

  /* ── Permissão e sessão ────────────────────────────────────────────── */
  {
    // Caso específico: função chamada em modo somente-leitura. Acontece quando
    // um agente faz `select alguma_funcao(...)` que na verdade escreve.
    match: /permission denied for function/i,
    build: (raw) => {
      const f = /permission denied for function (\w+)/i.exec(raw)?.[1]
      return `Sem permissão para executar a função${f ? ` “${f}”` : ''}. Se ela grava dados, o modo somente-leitura a bloqueia: agentes com token de leitura não conseguem chamá-la. Pelo painel, o SQL Runner executa com permissão total.`
    },
  },
  {
    match: /permission denied/i,
    build: () =>
      'Sem permissão para esta operação. A chave usada pode não ter alcance suficiente.',
  },
  {
    match: /new row violates row-level security/i,
    build: () =>
      'A política de segurança (RLS) da tabela bloqueou este registro. Normalmente só a service_role key passa.',
  },
  {
    match: /(jwt (expired|is invalid)|invalid (jwt|api key)|invalid signature)/i,
    build: () =>
      'A chave deste projeto foi recusada. Se ela foi rotacionada na Supabase, atualize-a em Visão geral → Configurações.',
  },
  {
    match: /unauthorized|401/i,
    build: () => 'Acesso negado pelo projeto. Confira se a chave salva ainda é válida.',
  },

  /* ── Servidor fora do ar ───────────────────────────────────────────── */
  {
    match: /(bad gateway|^502|\b502\b)/i,
    build: () =>
      'O servidor da Supabase está fora do ar no momento (erro 502). Costuma ser passageiro, tente de novo em alguns minutos.',
  },
  {
    match: /(service unavailable|\b503\b)/i,
    build: () =>
      'O serviço está indisponível no momento (erro 503). Pode ser manutenção da Supabase, ou o projeto estar pausado.',
  },
  {
    match: /(gateway time-?out|\b504\b)/i,
    build: () => 'O servidor não respondeu a tempo (erro 504). Tente de novo em instantes.',
  },
  {
    match: /respondeu com uma página de erro/i,
    build: () =>
      'A Supabase respondeu com uma página de erro em vez de dados. Normalmente é instabilidade momentânea do serviço.',
  },

  /* ── Limites e infraestrutura ──────────────────────────────────────── */
  {
    match: /request entity too large|payload too large|413/i,
    build: () =>
      'O conteúdo é grande demais para uma requisição. Divida em partes menores.',
  },
  {
    match: /canceling statement due to statement timeout|query timeout/i,
    build: () =>
      'A consulta demorou demais e foi cancelada pelo banco. Filtre mais ou reduza o intervalo.',
  },
  {
    match: /too many connections/i,
    build: () =>
      'O banco atingiu o limite de conexões simultâneas. Tente de novo em instantes.',
  },
  {
    match: /(econnrefused|enotfound|network|fetch failed|socket hang up)/i,
    build: () =>
      'Não foi possível alcançar o projeto. Ele pode estar pausado, ou houve falha de rede.',
  },
  {
    match: /tempo esgotado|timeout|aborted/i,
    build: () => 'A operação demorou demais e foi interrompida.',
  },
  {
    match: /(project is paused|project.*inactive)/i,
    build: () =>
      'Este projeto está pausado na Supabase. Restaure-o pelo painel oficial para voltar a operar.',
  },

  /* ── Rate limit ────────────────────────────────────────────────────── */
  {
    match: /(rate limit|too many requests|429)/i,
    build: () => 'Muitas requisições em pouco tempo. Aguarde alguns instantes.',
  },
]

/**
 * Recebe qualquer erro e devolve mensagem legível + detalhe técnico.
 * Nunca lança: erro dentro do tratador de erro é o pior lugar para falhar.
 */
export function humanizeError(input: unknown): HumanError {
  let raw: string

  try {
    if (typeof input === 'string') raw = input
    else if (input instanceof Error) raw = input.message
    else if (input && typeof input === 'object' && 'message' in input) {
      raw = String((input as { message: unknown }).message)
    } else raw = String(input ?? '')
  } catch {
    return { message: 'Ocorreu um erro inesperado.' }
  }

  if (!raw.trim()) return { message: 'Ocorreu um erro inesperado.' }

  const clean = unwrap(raw)

  for (const rule of RULES) {
    if (rule.match.test(clean)) {
      const message = rule.build(clean)
      // Só mostra o detalhe se ele acrescentar algo à frase amigável.
      return { message, detail: clean !== message ? clean : undefined }
    }
  }

  // Sem regra: devolve o texto já descascado, que ao menos está legível.
  return { message: clean }
}

/** Versão curta, para toasts e outros espaços apertados. */
export function humanizeShort(input: unknown, max = 130): string {
  const { message } = humanizeError(input)
  return message.length <= max ? message : `${message.slice(0, max - 1)}…`
}
