import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '·'
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

export function formatPct(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '·'
  return `${value.toFixed(decimals)}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '·'
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '·'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return '·'
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '·'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return '·'
  }
}

/** "há 5 min", "há 2 h", "ontem", usado em "última verificação". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'nunca'

  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'nunca'

  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 0) return 'agora'
  if (seconds < 60) return 'agora mesmo'
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`
  if (seconds < 172800) return 'ontem'
  if (seconds < 2592000) return `há ${Math.floor(seconds / 86400)} dias`
  return formatDate(iso)
}

/** Rótulos amigáveis para os status crus da Management API. */
export const STATUS_LABELS: Record<string, string> = {
  ACTIVE_HEALTHY: 'Ativo',
  ACTIVE_UNHEALTHY: 'Ativo (instável)',
  COMING_UP: 'Subindo',
  GOING_DOWN: 'Desligando',
  INACTIVE: 'Inativo',
  INIT_FAILED: 'Falha na criação',
  REMOVED: 'Removido',
  RESTORING: 'Restaurando',
  UPGRADING: 'Atualizando',
  PAUSING: 'Pausando',
  PAUSED: 'Pausado',
  RESTARTING: 'Reiniciando',
  RESIZING: 'Redimensionando',
  UNKNOWN: 'Desconhecido',
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Desconhecido'
  return STATUS_LABELS[status] ?? status
}

export const HEALTH_LABELS: Record<string, string> = {
  healthy: 'Saudável',
  degraded: 'Degradado',
  down: 'Fora do ar',
  unknown: 'Sem dados',
}

export const SERVICE_LABELS: Record<string, string> = {
  db: 'Banco de dados',
  auth: 'Autenticação',
  rest: 'API REST',
  storage: 'Storage',
  realtime: 'Realtime',
  pooler: 'Pooler',
}

/**
 * Regioes onde a Supabase aceita criar um projeto, com os nomes que uma
 * pessoa reconhece. A lista vem do enum da Management API; o padrao e Sao
 * Paulo, que e onde a latencia faz sentido para os projetos daqui.
 */
export const SUPABASE_REGIONS: Array<{ value: string; label: string }> = [
  { value: 'sa-east-1', label: 'São Paulo (sa-east-1)' },
  { value: 'us-east-1', label: 'Norte da Virgínia (us-east-1)' },
  { value: 'us-east-2', label: 'Ohio (us-east-2)' },
  { value: 'us-west-1', label: 'Norte da Califórnia (us-west-1)' },
  { value: 'us-west-2', label: 'Oregon (us-west-2)' },
  { value: 'ca-central-1', label: 'Canadá Central (ca-central-1)' },
  { value: 'eu-west-1', label: 'Irlanda (eu-west-1)' },
  { value: 'eu-west-2', label: 'Londres (eu-west-2)' },
  { value: 'eu-west-3', label: 'Paris (eu-west-3)' },
  { value: 'eu-central-1', label: 'Frankfurt (eu-central-1)' },
  { value: 'eu-central-2', label: 'Zurique (eu-central-2)' },
  { value: 'eu-north-1', label: 'Estocolmo (eu-north-1)' },
  { value: 'ap-south-1', label: 'Mumbai (ap-south-1)' },
  { value: 'ap-southeast-1', label: 'Singapura (ap-southeast-1)' },
  { value: 'ap-southeast-2', label: 'Sydney (ap-southeast-2)' },
  { value: 'ap-northeast-1', label: 'Tóquio (ap-northeast-1)' },
  { value: 'ap-northeast-2', label: 'Seul (ap-northeast-2)' },
  { value: 'ap-east-1', label: 'Hong Kong (ap-east-1)' },
]

export const DEFAULT_REGION = 'sa-east-1'

/**
 * Detecta comandos que escrevem, para o aviso do SQL Runner.
 *
 * Serve só para AVISAR. Não dá para saber por análise de texto se uma função
 * escreve: `select vault.create_secret(...)` parece leitura e grava uma linha.
 * Por isso o SQL Runner não roda em modo somente-leitura, ver o comentário
 * em src/app/api/projects/[id]/sql/route.ts.
 */
export function isWriteQuery(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .toLowerCase()

  const comandos =
    /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|replace|comment|vacuum|reindex|refresh)\b/

  // Funções conhecidas que gravam apesar de serem chamadas com SELECT. O `\b`
  // do padrão acima não as pega, porque o underscore conta como letra e
  // "create_secret" nunca casa com `\bcreate\b`.
  const funcoesQueEscrevem =
    /\b(create_secret|update_secret|delete_secret|cron\.schedule|cron\.unschedule|cron\.alter_job|setval|nextval|pg_create_|pg_drop_|pg_terminate_backend|pg_cancel_backend|graphql\.rebuild|net\.http_)/

  return comandos.test(stripped) || funcoesQueEscrevem.test(stripped)
}

export function truncate(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Cor determinística para o cliente, quando ele não definiu uma. */
const CLIENT_COLORS = [
  '#5FE6D4',
  '#62B6FF',
  '#C08CFF',
  '#F2B544',
  '#FF8A7A',
  '#4FD8A8',
  '#FF9F5A',
  '#A8E063',
]

export function clientColor(name: string, override?: string | null): string {
  if (override) return override
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return CLIENT_COLORS[hash % CLIENT_COLORS.length]
}

/* ═══════════════════════════════════════════════════════════════════════════
   Expressões cron em português

   Traduz o que dá para traduzir com clareza; quando a expressão é complexa
   demais, diz isso em vez de inventar uma descrição errada.
   ═══════════════════════════════════════════════════════════════════════════ */

const WEEKDAYS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
]

function everyN(field: string): number | null {
  const match = /^\*\/(\d+)$/.exec(field)
  return match ? Number(match[1]) : null
}

export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return 'Expressão inválida, use 5 campos: minuto hora dia mês dia-da-semana'

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // A cada N minutos
  const everyMinutes = everyN(minute)
  if (everyMinutes && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return everyMinutes === 1 ? 'A cada minuto' : `A cada ${everyMinutes} minutos`
  }

  // A cada N horas
  const everyHours = everyN(hour)
  if (everyHours && /^\d+$/.test(minute) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `A cada ${everyHours} horas, no minuto ${minute}`
  }

  // Todo minuto de toda hora
  if (minute === '*' && hour === '*') return 'A cada minuto'

  // Horário fixo
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const time = `${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`

    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Todo dia às ${time}`
    }

    if (dayOfWeek !== '*' && dayOfMonth === '*') {
      const days = dayOfWeek
        .split(',')
        .map((d) => WEEKDAYS[Number(d) % 7])
        .filter(Boolean)

      if (days.length === 1) return `Toda ${days[0]} às ${time}`
      if (days.length > 1) return `${days.join(', ')} às ${time}`
    }

    if (dayOfMonth !== '*' && month === '*' && /^\d+$/.test(dayOfMonth)) {
      return `Todo dia ${dayOfMonth} do mês, às ${time}`
    }

    return `Às ${time}, conforme a expressão`
  }

  // A cada hora, em um minuto fixo
  if (/^\d+$/.test(minute) && hour === '*') {
    return `A cada hora, no minuto ${minute}`
  }

  return 'Agendamento personalizado'
}
