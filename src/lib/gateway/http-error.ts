/**
 * Extrai uma mensagem de erro utilizável do corpo de uma resposta HTTP.
 *
 * O problema que isto resolve: quando a Supabase (ou o Cloudflare na frente
 * dela) devolve erro, nem sempre vem JSON. Vem uma PÁGINA HTML inteira. Sem
 * tratamento, esse HTML virava a "mensagem de erro", era gravado no snapshot
 * e despejado na tela, quilobytes de doctype, comentários condicionais de
 * Internet Explorer e CSS, no lugar de "o servidor da Supabase caiu".
 *
 * Regra: se o corpo não for JSON com mensagem, a mensagem vem do STATUS, que
 * é a informação que de fato importa.
 */

const MAX_MESSAGE = 300

/** Uma página HTML se anuncia logo nos primeiros bytes. */
function isHtml(text: string): boolean {
  const head = text.slice(0, 400).toLowerCase()
  return (
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('<head>') ||
    /^\s*</.test(text)
  )
}

/** O que cada status significa para quem está usando o sistema. */
function fromStatus(status: number, origem: string): string {
  const mapa: Record<number, string> = {
    400: `Requisição recusada por ${origem}.`,
    401: `Credencial recusada por ${origem}. A chave pode ter sido rotacionada.`,
    403: `Sem permissão em ${origem} para esta operação.`,
    404: `Recurso não encontrado em ${origem}.`,
    408: `${origem} demorou demais para responder.`,
    413: 'O conteúdo enviado é grande demais.',
    429: `${origem} recebeu requisições demais. Aguarde alguns instantes.`,
    500: `${origem} teve um erro interno.`,
    502: `${origem} está fora do ar no momento (502). Costuma ser passageiro, tente de novo em alguns minutos.`,
    503: `${origem} está indisponível no momento (503). Pode ser manutenção ou o projeto estar pausado.`,
    504: `${origem} não respondeu a tempo (504).`,
  }

  return mapa[status] ?? `${origem} respondeu com erro ${status}.`
}

/**
 * Decide a mensagem final a partir do corpo bruto e do status.
 *
 * @param parsed  corpo já interpretado (objeto se era JSON, string se não)
 * @param status  código HTTP
 * @param origem  quem respondeu, para a frase fazer sentido
 */
export function messageFromResponse(parsed: unknown, status: number, origem: string): string {
  // JSON com mensagem: é o caminho bom, o servidor explicou o que houve.
  if (parsed && typeof parsed === 'object') {
    const body = parsed as { message?: string; error?: string; msg?: string; hint?: string }
    const msg = body.message ?? body.error ?? body.msg

    if (typeof msg === 'string' && msg.trim() && !isHtml(msg)) {
      return msg.length > MAX_MESSAGE ? `${msg.slice(0, MAX_MESSAGE - 1)}…` : msg
    }
  }

  // Texto puro: só serve se for curto e não for uma página.
  if (typeof parsed === 'string') {
    const text = parsed.trim()
    if (text && !isHtml(text) && text.length <= MAX_MESSAGE) return text
  }

  // Página HTML, corpo vazio ou texto gigante: o status é o que informa.
  return fromStatus(status, origem)
}
