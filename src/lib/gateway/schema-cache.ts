import type { TableInfo } from '@/lib/types'

/**
 * Cache do schema (lista de tabelas e colunas) por projeto.
 *
 * Por que existe: descobrir o schema exige buscar o spec OpenAPI do PostgREST,
 * e a PRIMEIRA requisição a cada projeto paga conexão fria, medimos de 400ms
 * a 1,9s, contra 90 a 270ms depois de aquecida. Sem cache, esse custo era pago
 * toda vez que a aba Tabelas era aberta.
 *
 * O schema de um projeto muda raramente (migration), então segurar por alguns
 * minutos é seguro. Há invalidação manual para quando o usuário rodar um DDL
 * pelo SQL Runner.
 *
 * Vive na memória da instância. Em serverless isso significa que cada instância
 * tem o seu, e o cache morre com ela, ainda assim resolve o caso real, que é
 * navegar entre abas e projetos dentro de uma mesma sessão de trabalho.
 */

interface Entry {
  tables: TableInfo[]
  storedAt: number
}

const cache = new Map<string, Entry>()

const TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 40

export function getCachedSchema(projectId: string): TableInfo[] | null {
  const entry = cache.get(projectId)
  if (!entry) return null

  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(projectId)
    return null
  }

  return entry.tables
}

export function setCachedSchema(projectId: string, tables: TableInfo[]): void {
  // Descarta o mais antigo quando estoura, para não crescer sem limite.
  if (cache.size >= MAX_ENTRIES && !cache.has(projectId)) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0]
    if (oldest) cache.delete(oldest[0])
  }

  cache.set(projectId, { tables, storedAt: Date.now() })
}

/** Chamado após DDL (SQL Runner), o schema pode ter mudado. */
export function invalidateSchema(projectId: string): void {
  cache.delete(projectId)
}

export function schemaCacheAge(projectId: string): number | null {
  const entry = cache.get(projectId)
  return entry ? Date.now() - entry.storedAt : null
}
