import { systemDb } from '@/lib/db'
import { audit } from '@/lib/audit'
import { encryptSecret, randomToken } from '@/lib/crypto'
import { getAccountPat } from '@/lib/accounts'
import { ensurePublishableKey, getProjectCredentials, listProjectsWithMeta } from '@/lib/projects'
import {
  createProject,
  deployEdgeFunction,
  generateTypescriptTypes,
  getAdvisors,
  getEdgeFunction,
  getEdgeFunctionBody,
  getProjectKeys,
  listEdgeFunctions,
  listOrganizations,
  pauseProject,
  pickKeys,
  queryLogs,
  restoreProject,
  runQuery,
} from '@/lib/gateway/management'
import {
  createAuthUser,
  createBucket,
  deleteAuthUser,
  deleteObject,
  deleteRow,
  insertRow,
  listAuthUsers,
  listBuckets,
  listObjects,
  listRows,
  listTables,
  signedUrl,
  updateAuthUser,
  updateRow,
} from '@/lib/gateway/project'
import { runBackup } from '@/lib/gateway/backup'
import { getCachedSchema, invalidateSchema, setCachedSchema } from '@/lib/gateway/schema-cache'
import { humanizeShort } from '@/lib/errors'
import { guardSql } from './guard'
import { tokenReachesProject, type ResolvedToken } from './tokens'
import type { Account, Project } from '@/lib/types'

/**
 * Ferramentas que os agentes de IA enxergam.
 *
 * A diferença para o MCP oficial da Supabase: lá um servidor fala com UMA
 * conta, e o projeto é escolhido na URL de conexão. Aqui o agente diz
 * "Loja Norte" e o sistema descobre em qual conta o projeto está,
 * descriptografa a credencial certa e executa. O agente nunca vê chave
 * nenhuma, elas não saem do servidor.
 *
 * Cada ferramenta declara o que exige do token. O que altera dados, estrutura
 * ou projetos só aparece na lista quando a permissão correspondente está
 * ligada: o agente não perde tempo tentando o que não pode, e o prompt dele
 * fica menor.
 */

/** Grupos, para o cliente poder pedir só uma parte via ?features= na URL. */
export type ToolGroup =
  | 'projetos'
  | 'banco'
  | 'dados'
  | 'auth'
  | 'storage'
  | 'funcoes'
  | 'monitoramento'
  | 'desenvolvimento'

export const GRUPOS: ToolGroup[] = [
  'projetos',
  'banco',
  'dados',
  'auth',
  'storage',
  'funcoes',
  'monitoramento',
  'desenvolvimento',
]

/** Permissão mínima do token para a ferramenta sequer aparecer. */
export type ToolRequires = 'leitura' | 'escrita' | 'ddl' | 'projetos'

export interface ToolContext {
  token: ResolvedToken
  /** Preenchido pela resolução de projeto, para o registro da chamada. */
  projectId?: string | null
}

export interface ToolDef {
  name: string
  group: ToolGroup
  description: string
  inputSchema: Record<string, unknown>
  requires: ToolRequires
  /** Pode apagar coisa que o backup não desfaz sozinho. Exige `confirmar`. */
  destructive?: boolean
  /** Só lê: nada muda no projeto. Vira `readOnlyHint` no catálogo. */
  readOnly?: boolean
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

/* ═══════════════════════════════════════════════════════════════════════════
   Apoio
   ═══════════════════════════════════════════════════════════════════════════ */

export function tokenAllows(token: ResolvedToken, requires: ToolRequires): boolean {
  if (requires === 'escrita') return token.canWrite
  if (requires === 'ddl') return token.canDdl
  if (requires === 'projetos') return token.canManageProjects
  return true
}

/**
 * Resolução de projeto.
 *
 * O agente refere projetos por NOME, que é como uma pessoa fala. Aceitamos
 * também o ref e o id, para quando ele já tiver visto na listagem. Quando a
 * conexão está presa a um projeto (?projeto= na URL), esse é o único que
 * responde, mesmo que o token alcance outros.
 */
async function resolveProject(identificador: unknown, ctx: ToolContext): Promise<Project> {
  const preso = ctx.token.connection?.project?.trim() || ''
  const termo = String(identificador ?? '').trim() || preso

  if (!termo) throw new Error('Informe o projeto (nome, ref ou id).')

  const { data: projetos } = await systemDb()
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .returns<Project[]>()

  const lista = projetos ?? []
  const alcancaveis = lista.filter((p) => tokenReachesProject(ctx.token, p.id))

  const casa = (p: Project, t: string) =>
    p.id === t || p.ref === t || p.name.toLowerCase() === t.toLowerCase()

  const achado =
    alcancaveis.find((p) => casa(p, termo)) ??
    alcancaveis.find((p) => p.name.toLowerCase().includes(termo.toLowerCase()))

  if (!achado) {
    // Existe, mas está fora do escopo deste token: dizer isso é mais útil que
    // "não encontrado", e não vaza nada além do nome que ele já tentou.
    const foraDoEscopo = lista.find((p) => casa(p, termo))

    if (foraDoEscopo) {
      throw new Error(
        `O projeto "${foraDoEscopo.name}" existe, mas este token não tem permissão para acessá-lo.`,
      )
    }

    const nomes = alcancaveis.map((p) => p.name).join(', ')
    throw new Error(
      `Projeto "${termo}" não encontrado. Disponíveis para este token: ${nomes || 'nenhum'}.`,
    )
  }

  if (preso && !casa(achado, preso)) {
    throw new Error(
      `Esta conexão está presa ao projeto "${preso}". Para alcançar outros, conecte o MCP sem o parâmetro projeto na URL.`,
    )
  }

  ctx.projectId = achado.id
  return achado
}

async function credenciais(projeto: Project) {
  const creds = await getProjectCredentials(projeto.id)
  if (!creds) throw new Error('Não foi possível carregar as credenciais do projeto.')
  return creds
}

/** Service key do projeto, com a mensagem certa quando ela falta. */
async function serviceKey(projeto: Project): Promise<{ url: string; key: string }> {
  const creds = await credenciais(projeto)
  if (!creds.serviceKey) {
    throw new Error(
      `O projeto "${projeto.name}" não tem service_role key salva. Ressincronize a conta dele em Conexões.`,
    )
  }
  return { url: projeto.url, key: creds.serviceKey }
}

/** PAT da conta do projeto, para tudo que passa pela Management API. */
async function comPat(projeto: Project): Promise<{ pat: string; ref: string }> {
  const creds = await credenciais(projeto)
  if (!creds.pat || !projeto.ref) {
    throw new Error(
      `Esta operação exige o token da conta de "${projeto.name}". Conecte a conta em Conexões.`,
    )
  }
  return { pat: creds.pat, ref: projeto.ref }
}

function exigeConfirmacao(args: Record<string, unknown>, oQueApaga: string): void {
  if (args.confirmar === true) return
  throw new Error(
    `${oQueApaga} Repita a chamada com confirmar: true se é isso mesmo, e antes disso diga ao usuário, em palavras, o que vai sumir.`,
  )
}

const texto = (valor: unknown) => JSON.stringify(valor, null, 2)

/** Versão no formato que o CLI da Supabase usa: 20250827143000. */
function versaoMigracao(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

function slug(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'migracao'
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Projetos, contas e clientes
   ═══════════════════════════════════════════════════════════════════════════ */

const FERRAMENTAS_PROJETOS: ToolDef[] = [
  {
    name: 'listar_projetos',
    group: 'projetos',
    requires: 'leitura',
    readOnly: true,
    description:
      'Lista os projetos Supabase que este token alcança, com cliente, estado e uso de CPU, memória e disco da última coleta. Use para descobrir o que existe antes de qualquer outra chamada.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { token }) => {
      const todos = await listProjectsWithMeta()
      const meus = todos.filter((p) => tokenReachesProject(token, p.id))

      return meus.map((p) => ({
        nome: p.name,
        ref: p.ref,
        cliente: p.client?.name ?? null,
        estado: p.status,
        regiao: p.region,
        saude: p.latest_snapshot?.overall_health ?? 'sem dados',
        cpu_pct: p.latest_snapshot?.cpu_pct ?? null,
        memoria_pct: p.latest_snapshot?.ram_pct ?? null,
        disco_pct: p.latest_snapshot?.disk_pct ?? null,
        tamanho_banco_bytes: p.latest_snapshot?.db_size_bytes ?? null,
        ultima_coleta: p.latest_snapshot?.collected_at ?? null,
      }))
    },
  },

  {
    name: 'listar_clientes',
    group: 'projetos',
    requires: 'leitura',
    readOnly: true,
    description:
      'Clientes cadastrados e quais projetos pertencem a cada um. Útil quando a pergunta é sobre um cliente e não sobre um projeto.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { token }) => {
      const db = systemDb()
      const [{ data: clientes }, projetos] = await Promise.all([
        db.from('clients').select('id, name, contact, notes').order('name'),
        listProjectsWithMeta(),
      ])

      const meus = projetos.filter((p) => tokenReachesProject(token, p.id))

      return (clientes ?? []).map((c) => ({
        id: c.id,
        cliente: c.name,
        contato: c.contact,
        notas: c.notes,
        projetos: meus.filter((p) => p.client_id === c.id).map((p) => p.name),
      }))
    },
  },

  {
    name: 'listar_contas',
    group: 'projetos',
    requires: 'projetos',
    readOnly: true,
    description:
      'Contas Supabase conectadas e as organizações de cada uma. É daqui que sai o par conta + organização que criar_projeto pede, um projeto nasce sempre dentro de uma organização.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { data: contas } = await systemDb()
        .from('accounts')
        .select('id, login_email, alias, status')
        .neq('status', 'disabled')
        .order('login_email')
        .returns<Pick<Account, 'id' | 'login_email' | 'alias' | 'status'>[]>()

      const resultado = []

      for (const conta of contas ?? []) {
        const aberta = await getAccountPat(conta.id)

        if (!aberta) {
          resultado.push({
            conta: conta.login_email,
            apelido: conta.alias,
            organizacoes: [],
            aviso: 'Token da conta indisponível. Reconecte em Conexões.',
          })
          continue
        }

        try {
          const orgs = await listOrganizations(aberta.pat)
          resultado.push({
            conta: conta.login_email,
            apelido: conta.alias,
            organizacoes: orgs.map((o) => ({ slug: o.slug, nome: o.name })),
          })
        } catch (err) {
          resultado.push({
            conta: conta.login_email,
            apelido: conta.alias,
            organizacoes: [],
            aviso: humanizeShort(err instanceof Error ? err.message : String(err)),
          })
        }
      }

      return resultado
    },
  },

  {
    name: 'criar_projeto',
    group: 'projetos',
    requires: 'projetos',
    description:
      'Cria um projeto Supabase novo dentro de uma conta conectada e já o adiciona à carteira, com as chaves guardadas no cofre. Chame listar_contas antes, para saber a conta e a organização. O projeto leva alguns minutos para ficar de pé: logo após a criação ele responde COMING_UP.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do projeto na Supabase' },
        conta: { type: 'string', description: 'E-mail, apelido ou id da conta onde ele nasce' },
        organizacao: {
          type: 'string',
          description: 'Slug da organização. Se a conta tiver só uma, pode omitir.',
        },
        regiao: {
          type: 'string',
          description: 'Ex: sa-east-1 (São Paulo), us-east-1. Padrão da Supabase se omitida.',
        },
        cliente: { type: 'string', description: 'Nome de um cliente já cadastrado, opcional' },
      },
      required: ['nome', 'conta'],
      additionalProperties: false,
    },
    handler: async (args, { token }) => {
      const nome = String(args.nome ?? '').trim()
      const termoConta = String(args.conta ?? '').trim()
      if (!nome) throw new Error('Informe o nome do projeto.')

      const db = systemDb()

      const { data: contas } = await db
        .from('accounts')
        .select('id, login_email, alias, status')
        .neq('status', 'disabled')
        .returns<Pick<Account, 'id' | 'login_email' | 'alias' | 'status'>[]>()

      const conta = (contas ?? []).find(
        (c) =>
          c.id === termoConta ||
          c.login_email.toLowerCase() === termoConta.toLowerCase() ||
          (c.alias ?? '').toLowerCase() === termoConta.toLowerCase(),
      )

      if (!conta) {
        const nomes = (contas ?? []).map((c) => c.login_email).join(', ')
        throw new Error(`Conta "${termoConta}" não encontrada. Conectadas: ${nomes || 'nenhuma'}.`)
      }

      const aberta = await getAccountPat(conta.id)
      if (!aberta) throw new Error('A conta existe mas o token dela não está utilizável.')

      let orgSlug = String(args.organizacao ?? '').trim()
      if (!orgSlug) {
        const orgs = await listOrganizations(aberta.pat)
        if (orgs.length !== 1) {
          throw new Error(
            `Esta conta tem ${orgs.length} organizações (${orgs
              .map((o) => o.slug)
              .join(', ')}). Diga em qual o projeto deve nascer.`,
          )
        }
        orgSlug = orgs[0].slug
      }

      let clientId: string | null = null
      if (args.cliente) {
        const { data: cliente } = await db
          .from('clients')
          .select('id, name')
          .ilike('name', String(args.cliente))
          .maybeSingle<{ id: string; name: string }>()

        if (!cliente) {
          throw new Error(
            `Cliente "${args.cliente}" não está cadastrado. Crie com criar_cliente ou omita o campo.`,
          )
        }
        clientId = cliente.id
      }

      // A senha do banco só existe nesta requisição: a Supabase não a devolve
      // depois, nem no painel. Ela vai para o cofre dentro da connection
      // string e NÃO volta para o agente.
      const dbPass = randomToken(24)

      const remoto = await createProject(aberta.pat, {
        name: nome,
        organizationSlug: orgSlug,
        dbPass,
        region: String(args.regiao ?? '').trim() || undefined,
      })

      const ref = remoto.ref
      if (!ref) throw new Error('A Supabase criou o projeto mas não devolveu o ref dele.')

      const url = `https://${ref}.supabase.co`

      // Nos primeiros segundos o projeto ainda está subindo e a API responde
      // 404 nas chaves. Uma tentativa só, sem insistir: o "Ressincronizar" da
      // conta as traz depois, e a chamada do agente não pode ficar pendurada.
      let chaves: ReturnType<typeof pickKeys> | null = null
      try {
        chaves = pickKeys(await getProjectKeys(aberta.pat, ref))
      } catch {
        chaves = null
      }

      const { data: criado, error } = await db
        .from('projects')
        .insert({
          account_id: conta.id,
          client_id: clientId,
          ref,
          name: nome,
          url,
          account_email: conta.login_email,
          anon_key_enc: chaves?.anon ? encryptSecret(chaves.anon) : null,
          publishable_key_enc: chaves?.publishable ? encryptSecret(chaves.publishable) : null,
          service_key_enc: chaves?.service ? encryptSecret(chaves.service) : null,
          db_url_enc: encryptSecret(
            `postgresql://postgres:${encodeURIComponent(dbPass)}@db.${ref}.supabase.co:5432/postgres`,
          ),
          source: 'sync' as const,
          status: remoto.status,
          region: remoto.region,
        })
        .select('id')
        .single<{ id: string }>()

      if (error || !criado) {
        throw new Error(
          `O projeto ${nome} foi criado na Supabase (${ref}), mas não entrou na carteira: ${
            error?.message ?? 'falha ao salvar'
          }. Peça para usar "Ressincronizar" na conta.`,
        )
      }

      await audit({
        action: 'project.provisioned',
        projectId: criado.id,
        detail: `[agente ${token.name}] ${nome} criado em ${conta.login_email} (${orgSlug})`,
        actor: `agente:${token.name}`,
        meta: { via: 'mcp', ref, region: remoto.region, keys_ready: Boolean(chaves?.service) },
      })

      return {
        criado: true,
        nome,
        ref,
        url,
        estado: remoto.status,
        regiao: remoto.region,
        chaves_prontas: Boolean(chaves?.service),
        observacao:
          'O projeto leva de um a três minutos para aceitar conexões. Se as chaves ainda não vieram, chame obter_credenciais daqui a pouco. A senha do banco foi gerada e guardada no cofre; ela não é devolvida a agentes.',
      }
    },
  },

  {
    name: 'atualizar_projeto',
    group: 'projetos',
    requires: 'projetos',
    description:
      'Altera os dados do projeto na carteira: nome exibido, cliente dono e notas. Não mexe no projeto lá na Supabase: é organização interna.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        nome: { type: 'string' },
        cliente: { type: 'string', description: 'Nome de um cliente cadastrado' },
        notas: { type: 'string' },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const db = systemDb()
      const patch: Record<string, unknown> = {}

      if (typeof args.nome === 'string' && args.nome.trim()) patch.name = args.nome.trim()
      if (typeof args.notas === 'string') patch.notes = args.notas.trim() || null

      if (typeof args.cliente === 'string') {
        const { data: cliente } = await db
          .from('clients')
          .select('id')
          .ilike('name', args.cliente)
          .maybeSingle<{ id: string }>()

        if (!cliente) throw new Error(`Cliente "${args.cliente}" não está cadastrado.`)
        patch.client_id = cliente.id
      }

      if (!Object.keys(patch).length) throw new Error('Nada para alterar.')

      const { error } = await db.from('projects').update(patch).eq('id', projeto.id)
      if (error) throw new Error(error.message)

      await audit({
        action: 'project.updated',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${Object.keys(patch).join(', ')}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', patch },
      })

      return { atualizado: true, campos: Object.keys(patch) }
    },
  },

  {
    name: 'pausar_projeto',
    group: 'projetos',
    requires: 'projetos',
    destructive: true,
    description:
      'Pausa o projeto na Supabase. O banco para de responder e a aplicação que depende dele sai do ar até alguém restaurar. Só faz sentido em projeto parado, nunca em produção ativa.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        confirmar: { type: 'boolean', description: 'Obrigatório: true para pausar de verdade' },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      exigeConfirmacao(
        args,
        `Pausar "${projeto.name}" derruba tudo que depende desse banco, na hora.`,
      )

      const { pat, ref } = await comPat(projeto)
      await pauseProject(pat, ref)

      await audit({
        action: 'project.paused',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp' },
      })

      return { pausado: true, projeto: projeto.name }
    },
  },

  {
    name: 'restaurar_projeto',
    group: 'projetos',
    requires: 'projetos',
    description:
      'Tira o projeto da pausa. Leva alguns minutos até o banco voltar a aceitar conexões.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)
      await restoreProject(pat, ref)

      await audit({
        action: 'project.restored',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp' },
      })

      return { restaurando: true, projeto: projeto.name }
    },
  },

  {
    name: 'criar_cliente',
    group: 'projetos',
    requires: 'projetos',
    description:
      'Cadastra um cliente na carteira, para depois ligar projetos a ele em criar_projeto ou atualizar_projeto.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        contato: { type: 'string' },
        notas: { type: 'string' },
      },
      required: ['nome'],
      additionalProperties: false,
    },
    handler: async (args, { token }) => {
      const nome = String(args.nome ?? '').trim()
      if (!nome) throw new Error('Informe o nome do cliente.')

      const { data, error } = await systemDb()
        .from('clients')
        .insert({
          name: nome,
          contact: args.contato ? String(args.contato) : null,
          notes: args.notas ? String(args.notas) : null,
        })
        .select('id')
        .single<{ id: string }>()

      if (error || !data) throw new Error(error?.message ?? 'Falha ao criar o cliente.')

      await audit({
        action: 'client.created',
        detail: `[agente ${token.name}] ${nome}`,
        actor: `agente:${token.name}`,
        meta: { via: 'mcp' },
      })

      return { criado: true, id: data.id, cliente: nome }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Banco: estrutura, SQL e migrations
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Roda SQL pela Management API, decidindo o modo de execução.
 *
 * Leitura vai em modo somente-leitura, que é a barreira real contra um agente
 * sequestrado. A exceção é quando um SELECT chama uma função que escreve: a
 * role somente-leitura não tem permissão em várias funções da Supabase, e o
 * erro que volta ("permission denied for function") não tem nada a ver com o
 * problema. Nesse caso repetimos com a role normal, mas só se o token pode
 * escrever, porque aí a operação estava autorizada desde o começo.
 */
async function executar(
  pat: string,
  ref: string,
  sql: string,
  leitura: boolean,
  podeReexecutar: boolean,
): Promise<Record<string, unknown>[]> {
  try {
    return await runQuery(pat, ref, sql, leitura)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (leitura && podeReexecutar && /permission denied|read-only|somente leitura/i.test(msg)) {
      return runQuery(pat, ref, sql, false)
    }
    throw err
  }
}

const FERRAMENTAS_BANCO: ToolDef[] = [
  {
    name: 'listar_tabelas',
    group: 'banco',
    requires: 'leitura',
    readOnly: true,
    description:
      'Lista as tabelas de um projeto, com colunas, tipos e chaves primárias. Chame antes de consultar ou escrever, para saber os nomes exatos.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'Nome, ref ou id do projeto' },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const cache = getCachedSchema(projeto.id)
      const tabelas = cache ?? (await listTables(url, key))
      if (!cache) setCachedSchema(projeto.id, tabelas)

      return tabelas.map((t) => ({
        tabela: t.name,
        chaves_primarias: t.primaryKeys,
        colunas: t.columns.map((c) => ({
          nome: c.name,
          tipo: c.format,
          obrigatoria: c.required,
        })),
      }))
    },
  },

  {
    name: 'listar_extensoes',
    group: 'banco',
    requires: 'leitura',
    readOnly: true,
    description:
      'Extensões do Postgres disponíveis e quais estão instaladas no projeto (pgvector, pg_cron, postgis e as demais).',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      const linhas = await runQuery(
        pat,
        ref,
        `select name, default_version, installed_version, comment
           from pg_available_extensions
          where installed_version is not null
             or name in ('pgvector','vector','pg_cron','postgis','pg_net','pgjwt','uuid-ossp','pgcrypto','pg_stat_statements','pg_trgm','http')
          order by installed_version is null, name`,
        true,
      )

      return linhas
    },
  },

  {
    name: 'executar_sql',
    group: 'banco',
    requires: 'leitura',
    description:
      'Executa UM comando SQL no banco do projeto. SELECT, WITH, EXPLAIN e SHOW sempre. INSERT, UPDATE, DELETE e MERGE com token de escrita. CREATE, ALTER, DROP e o resto do DDL com token que altera estrutura, mas para mudança de schema prefira aplicar_migracao, que fica registrada com nome e histórico. Comandos que apagam (DROP, TRUNCATE, DELETE ou UPDATE sem WHERE) exigem confirmar: true.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        sql: { type: 'string', description: 'Um comando por chamada' },
        confirmar: {
          type: 'boolean',
          description: 'Necessário quando o comando apaga dados ou estrutura',
        },
      },
      required: ['projeto', 'sql'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const sql = String(args.sql ?? '')
      const guarda = guardSql(sql, {
        canWrite: ctx.token.canWrite,
        canDdl: ctx.token.canDdl,
        confirmed: args.confirmar === true,
      })

      if (!guarda.allowed) throw new Error(guarda.reason ?? 'Comando não permitido para agentes.')

      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      const linhas = await executar(
        pat,
        ref,
        sql,
        guarda.kind === 'leitura',
        ctx.token.canWrite || ctx.token.canDdl,
      )

      if (guarda.kind === 'ddl') invalidateSchema(projeto.id)

      if (guarda.kind !== 'leitura') {
        await audit({
          action: 'sql.executed',
          projectId: projeto.id,
          detail: `[agente ${ctx.token.name}] ${projeto.name} · ${sql.replace(/\s+/g, ' ').slice(0, 160)}`,
          actor: `agente:${ctx.token.name}`,
          meta: { via: 'mcp', tipo: guarda.kind, destrutivo: guarda.destructive },
        })

        await systemDb().from('query_history').insert({
          project_id: projeto.id,
          sql,
          success: true,
          row_count: linhas.length,
        })
      }

      return { tipo: guarda.kind, linhas_retornadas: linhas.length, linhas }
    },
  },

  {
    name: 'aplicar_migracao',
    group: 'banco',
    requires: 'ddl',
    description:
      'Aplica uma migração de schema: vários comandos DDL de uma vez, com nome, registrados no histórico do projeto (supabase_migrations.schema_migrations, a mesma tabela do CLI da Supabase) e na auditoria daqui. É o caminho certo para criar tabela, índice, policy, função ou trigger, use este em vez de executar_sql quando estiver mudando estrutura.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        nome: {
          type: 'string',
          description: 'O que a migração faz, em snake_case: criar_tabela_pedidos',
        },
        sql: { type: 'string', description: 'Um ou mais comandos, separados por ponto e vírgula' },
        confirmar: {
          type: 'boolean',
          description: 'Necessário quando a migração apaga tabela, coluna ou dados',
        },
      },
      required: ['projeto', 'nome', 'sql'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const sql = String(args.sql ?? '').trim()
      const nome = slug(String(args.nome ?? ''))

      const guarda = guardSql(sql, {
        canWrite: ctx.token.canWrite,
        canDdl: ctx.token.canDdl,
        confirmed: args.confirmar === true,
        allowMultiple: true,
      })

      if (!guarda.allowed) throw new Error(guarda.reason ?? 'Migração não permitida.')

      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)
      const version = versaoMigracao()
      const db = systemDb()

      let linhas: Record<string, unknown>[] = []
      try {
        linhas = await runQuery(pat, ref, sql, false)
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : 'Falha ao aplicar a migração.'

        await registrarMigracao(db, {
          project_id: projeto.id,
          version,
          name: nome,
          sql,
          token_id: ctx.token.id,
          token_name: ctx.token.name,
          ok: false,
          error: mensagem.slice(0, 500),
        })

        throw new Error(
          `A migração não passou e NADA foi aplicado além do que já tinha rodado antes do erro: ${mensagem}`,
        )
      }

      invalidateSchema(projeto.id)

      // Registro no próprio projeto, no formato do CLI. Se falhar, a migração
      // já rodou, então isso vira aviso, não erro.
      let registrada = true
      try {
        await runQuery(
          pat,
          ref,
          `create schema if not exists supabase_migrations;
           create table if not exists supabase_migrations.schema_migrations (
             version text primary key,
             statements text[],
             name text
           );
           insert into supabase_migrations.schema_migrations (version, name, statements)
           values ('${version}', ${quoteLiteral(nome)}, array[${quoteLiteral(sql)}])
           on conflict (version) do nothing;`,
          false,
        )
      } catch {
        registrada = false
      }

      await registrarMigracao(db, {
        project_id: projeto.id,
        version,
        name: nome,
        sql,
        token_id: ctx.token.id,
        token_name: ctx.token.name,
        ok: true,
      })

      await audit({
        action: 'sql.migration_applied',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${version}_${nome}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', version, destrutivo: guarda.destructive, sql: sql.slice(0, 4000) },
      })

      return {
        aplicada: true,
        version,
        nome,
        linhas_retornadas: linhas.length,
        linhas,
        aviso: registrada
          ? null
          : 'A migração rodou, mas não consegui registrá-la em supabase_migrations.schema_migrations. Quem usar o CLI da Supabase não vai vê-la lá.',
        proximo_passo:
          'Depois de mudar estrutura, chame obter_recomendacoes para conferir se sobrou tabela sem RLS ou índice faltando.',
      }
    },
  },

  {
    name: 'listar_migracoes',
    group: 'banco',
    requires: 'leitura',
    readOnly: true,
    description:
      'Histórico de migrações do projeto: as aplicadas por agentes daqui e as que já estavam registradas pelo CLI da Supabase.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      let noProjeto: unknown[] = []
      try {
        noProjeto = await runQuery(
          pat,
          ref,
          `select version, name from supabase_migrations.schema_migrations order by version desc limit 50`,
          true,
        )
      } catch {
        // Projeto que nunca viu o CLI nem uma migração daqui não tem a tabela.
        noProjeto = []
      }

      const { data: daqui } = await systemDb()
        .from('agent_migrations')
        .select('version, name, token_name, ok, error, applied_at')
        .eq('project_id', projeto.id)
        .order('applied_at', { ascending: false })
        .limit(50)

      return {
        no_projeto: noProjeto,
        aplicadas_por_agentes: (daqui ?? []).map((m) => ({
          version: m.version,
          nome: m.name,
          agente: m.token_name,
          ok: m.ok,
          erro: m.error ? humanizeShort(m.error) : null,
          quando: m.applied_at,
        })),
      }
    },
  },
]

/**
 * Guarda a migração no histórico central. Nunca lança: a migração já rodou no
 * banco do cliente, e falhar aqui não pode transformar um sucesso em erro.
 */
async function registrarMigracao(
  db: ReturnType<typeof systemDb>,
  linha: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await db.from('agent_migrations').insert(linha)
    if (error) console.error('[mcp] falha ao registrar a migração:', error.message)
  } catch (err) {
    console.error('[mcp] falha ao registrar a migração:', err)
  }
}

/** Escapa um literal para interpolar em SQL. Só usado no registro da migração. */
function quoteLiteral(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`
}

/* ═══════════════════════════════════════════════════════════════════════════
   Dados
   ═══════════════════════════════════════════════════════════════════════════ */

const FERRAMENTAS_DADOS: ToolDef[] = [
  {
    name: 'consultar_linhas',
    group: 'dados',
    requires: 'leitura',
    readOnly: true,
    description:
      'Lê linhas de uma tabela, com paginação, ordenação e filtro por texto. É o caminho mais simples para consultar dados, prefira a executar_sql quando servir.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        tabela: { type: 'string' },
        limite: { type: 'number', description: 'Padrão 50, máximo 200' },
        deslocamento: { type: 'number', description: 'Para paginar' },
        ordenar_por: { type: 'string' },
        crescente: { type: 'boolean' },
        coluna_filtro: { type: 'string', description: 'Coluna onde buscar' },
        valor_filtro: { type: 'string', description: 'Texto contido na coluna' },
      },
      required: ['projeto', 'tabela'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const filtros: string[] = []
      if (args.coluna_filtro && args.valor_filtro) {
        filtros.push(
          `${encodeURIComponent(String(args.coluna_filtro))}=ilike.*${encodeURIComponent(
            String(args.valor_filtro),
          )}*`,
        )
      }

      const { rows, total } = await listRows(url, key, String(args.tabela), {
        limit: Math.min(Number(args.limite) || 50, 200),
        offset: Number(args.deslocamento) || 0,
        orderBy: args.ordenar_por ? String(args.ordenar_por) : undefined,
        ascending: args.crescente !== false,
        filters: filtros,
      })

      return { total, retornadas: rows.length, linhas: rows }
    },
  },

  {
    name: 'inserir_linha',
    group: 'dados',
    requires: 'escrita',
    description:
      'Insere uma linha numa tabela. A ação fica registrada na auditoria com o nome do agente.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        tabela: { type: 'string' },
        valores: { type: 'object', description: 'Objeto coluna: valor' },
      },
      required: ['projeto', 'tabela', 'valores'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const linha = await insertRow(
        url,
        key,
        String(args.tabela),
        args.valores as Record<string, unknown>,
      )

      await audit({
        action: 'data.row_inserted',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.tabela}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', valores: args.valores },
      })

      return { inserida: linha }
    },
  },

  {
    name: 'atualizar_linha',
    group: 'dados',
    requires: 'escrita',
    description:
      'Atualiza uma linha identificada pela chave primária. A ação fica registrada na auditoria.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        tabela: { type: 'string' },
        chave: { type: 'object', description: 'Chave primária: { id: 123 }' },
        valores: { type: 'object', description: 'Colunas a alterar' },
      },
      required: ['projeto', 'tabela', 'chave', 'valores'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const linha = await updateRow(
        url,
        key,
        String(args.tabela),
        args.chave as Record<string, unknown>,
        args.valores as Record<string, unknown>,
      )

      await audit({
        action: 'data.row_updated',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.tabela} · ${JSON.stringify(
          args.chave,
        ).slice(0, 80)}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', chave: args.chave, valores: args.valores },
      })

      return { atualizada: linha }
    },
  },

  {
    name: 'deletar_linha',
    group: 'dados',
    requires: 'escrita',
    destructive: true,
    description:
      'Apaga UMA linha, identificada pela chave primária. Exige confirmar: true. Para apagar em lote, use executar_sql com um DELETE que tenha WHERE, mas leia as linhas antes e mostre ao usuário o que vai sumir.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        tabela: { type: 'string' },
        chave: { type: 'object', description: 'Chave primária: { id: 123 }' },
        confirmar: { type: 'boolean' },
      },
      required: ['projeto', 'tabela', 'chave'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      exigeConfirmacao(
        args,
        `Apagar linha de ${args.tabela} em "${projeto.name}" só se desfaz restaurando backup.`,
      )

      const { url, key } = await serviceKey(projeto)
      const chave = args.chave as Record<string, unknown>

      // Lê antes de apagar: o registro da auditoria guarda o conteúdo, para
      // dar como reconstruir a linha sem restaurar o backup inteiro.
      let antes: Record<string, unknown> | null = null
      try {
        const filtros = Object.entries(chave).map(
          ([col, val]) => `${encodeURIComponent(col)}=eq.${encodeURIComponent(String(val))}`,
        )
        const { rows } = await listRows(url, key, String(args.tabela), { limit: 1, filters: filtros })
        antes = rows[0] ?? null
      } catch {
        antes = null
      }

      await deleteRow(url, key, String(args.tabela), chave)

      await audit({
        action: 'data.row_deleted',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.tabela} · ${JSON.stringify(
          chave,
        ).slice(0, 80)}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', chave, linha_apagada: antes },
      })

      return { apagada: true, linha_que_existia: antes }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Auth
   ═══════════════════════════════════════════════════════════════════════════ */

const FERRAMENTAS_AUTH: ToolDef[] = [
  {
    name: 'listar_usuarios_auth',
    group: 'auth',
    requires: 'leitura',
    readOnly: true,
    description:
      'Usuários do Auth do projeto, com e-mail, confirmação, último acesso e metadados.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        pagina: { type: 'number', description: 'Padrão 1' },
        por_pagina: { type: 'number', description: 'Padrão 50, máximo 200' },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const { users, total } = await listAuthUsers(
        url,
        key,
        Number(args.pagina) || 1,
        Math.min(Number(args.por_pagina) || 50, 200),
      )

      return {
        total,
        usuarios: users.map((u) => ({
          id: u.id,
          email: u.email,
          telefone: u.phone,
          criado_em: u.created_at,
          ultimo_acesso: u.last_sign_in_at ?? null,
          email_confirmado: Boolean(u.email_confirmed_at),
          banido_ate: u.banned_until ?? null,
          metadados: u.user_metadata ?? null,
        })),
      }
    },
  },

  {
    name: 'criar_usuario_auth',
    group: 'auth',
    requires: 'escrita',
    description:
      'Cria um usuário no Auth do projeto. Serve para semear ambiente de teste e para cadastrar acesso pedido pelo cliente.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        email: { type: 'string' },
        senha: { type: 'string', description: 'Se omitida, o usuário nasce sem senha' },
        confirmar_email: {
          type: 'boolean',
          description: 'true marca o e-mail como confirmado, sem mandar mensagem',
        },
        metadados: { type: 'object', description: 'Vai para user_metadata' },
      },
      required: ['projeto', 'email'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const usuario = await createAuthUser(url, key, {
        email: String(args.email),
        ...(args.senha ? { password: String(args.senha) } : {}),
        email_confirm: args.confirmar_email === true,
        ...(args.metadados ? { user_metadata: args.metadados as Record<string, unknown> } : {}),
      })

      await audit({
        action: 'auth.user_created',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.email}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp' },
      })

      return { criado: { id: usuario.id, email: usuario.email } }
    },
  },

  {
    name: 'atualizar_usuario_auth',
    group: 'auth',
    requires: 'escrita',
    description:
      'Altera um usuário do Auth: e-mail, senha, confirmação, banimento ou metadados.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        usuario_id: { type: 'string' },
        email: { type: 'string' },
        senha: { type: 'string' },
        confirmar_email: { type: 'boolean' },
        banir_ate: {
          type: 'string',
          description: 'Duração no formato do Go: "24h", "0s" para desbanir',
        },
        metadados: { type: 'object' },
      },
      required: ['projeto', 'usuario_id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const payload: Record<string, unknown> = {}
      if (args.email) payload.email = String(args.email)
      if (args.senha) payload.password = String(args.senha)
      if (args.confirmar_email !== undefined) payload.email_confirm = args.confirmar_email === true
      if (args.banir_ate) payload.ban_duration = String(args.banir_ate)
      if (args.metadados) payload.user_metadata = args.metadados

      if (!Object.keys(payload).length) throw new Error('Nada para alterar no usuário.')

      const usuario = await updateAuthUser(url, key, String(args.usuario_id), payload)

      await audit({
        action: 'auth.user_updated',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${usuario.email ?? args.usuario_id} · ${Object.keys(
          payload,
        ).join(', ')}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', campos: Object.keys(payload) },
      })

      return { atualizado: { id: usuario.id, email: usuario.email } }
    },
  },

  {
    name: 'deletar_usuario_auth',
    group: 'auth',
    requires: 'escrita',
    destructive: true,
    description:
      'Apaga um usuário do Auth. As linhas que apontam para ele por chave estrangeira podem ir junto, dependendo do on delete das tabelas. Exige confirmar: true.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        usuario_id: { type: 'string' },
        confirmar: { type: 'boolean' },
      },
      required: ['projeto', 'usuario_id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      exigeConfirmacao(
        args,
        `Apagar o usuário ${args.usuario_id} em "${projeto.name}" pode levar junto os dados ligados a ele.`,
      )

      const { url, key } = await serviceKey(projeto)
      await deleteAuthUser(url, key, String(args.usuario_id))

      await audit({
        action: 'auth.user_deleted',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.usuario_id}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp' },
      })

      return { apagado: true }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Storage
   ═══════════════════════════════════════════════════════════════════════════ */

const FERRAMENTAS_STORAGE: ToolDef[] = [
  {
    name: 'listar_buckets',
    group: 'storage',
    requires: 'leitura',
    readOnly: true,
    description: 'Buckets do Storage do projeto, com visibilidade e limites de cada um.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      return (await listBuckets(url, key)).map((b) => ({
        bucket: b.name,
        publico: b.public,
        limite_tamanho_bytes: b.file_size_limit,
        tipos_permitidos: b.allowed_mime_types,
        criado_em: b.created_at,
      }))
    },
  },

  {
    name: 'criar_bucket',
    group: 'storage',
    requires: 'ddl',
    description:
      'Cria um bucket no Storage. Nasce privado: bucket público deixa qualquer pessoa com a URL ler o arquivo, sem token, o que só serve para conteúdo que já é público de propósito.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        nome: { type: 'string' },
        publico: { type: 'boolean', description: 'Padrão false' },
        limite_tamanho_bytes: { type: 'number' },
        tipos_permitidos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ex: ["image/png","image/jpeg"]',
        },
      },
      required: ['projeto', 'nome'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      await createBucket(url, key, {
        name: String(args.nome),
        public: args.publico === true,
        fileSizeLimit: Number(args.limite_tamanho_bytes) || null,
        allowedMimeTypes: (args.tipos_permitidos as string[] | undefined) ?? null,
      })

      await audit({
        action: 'storage.bucket_created',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.nome}${
          args.publico === true ? ' (PÚBLICO)' : ''
        }`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', publico: args.publico === true },
      })

      return {
        criado: true,
        bucket: args.nome,
        publico: args.publico === true,
        lembrete:
          'Bucket novo não tem policy de acesso. Enquanto não houver policy, só a service_role key alcança os arquivos.',
      }
    },
  },

  {
    name: 'listar_objetos',
    group: 'storage',
    requires: 'leitura',
    readOnly: true,
    description: 'Arquivos de um bucket, com tamanho e data.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        bucket: { type: 'string' },
        prefixo: { type: 'string', description: 'Pasta dentro do bucket' },
        limite: { type: 'number', description: 'Padrão 100' },
      },
      required: ['projeto', 'bucket'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const objetos = await listObjects(
        url,
        key,
        String(args.bucket),
        String(args.prefixo ?? ''),
        Math.min(Number(args.limite) || 100, 500),
      )

      return objetos.map((o) => ({
        arquivo: o.name,
        tamanho_bytes: o.metadata?.size ?? null,
        tipo: o.metadata?.mimetype ?? null,
        atualizado_em: o.updated_at,
      }))
    },
  },

  {
    name: 'link_temporario_objeto',
    group: 'storage',
    requires: 'leitura',
    readOnly: true,
    description:
      'Gera uma URL assinada, de curta duração, para um arquivo privado do Storage. Serve para mostrar ou baixar o arquivo sem tornar o bucket público.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        bucket: { type: 'string' },
        caminho: { type: 'string' },
        segundos: { type: 'number', description: 'Validade. Padrão 300, máximo 3600.' },
      },
      required: ['projeto', 'bucket', 'caminho'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { url, key } = await serviceKey(projeto)

      const segundos = Math.min(Number(args.segundos) || 300, 3600)
      const link = await signedUrl(url, key, String(args.bucket), String(args.caminho), segundos)

      return { url: link, validade_segundos: segundos }
    },
  },

  {
    name: 'deletar_objeto',
    group: 'storage',
    requires: 'escrita',
    destructive: true,
    description: 'Apaga um arquivo do Storage. Não tem lixeira. Exige confirmar: true.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        bucket: { type: 'string' },
        caminho: { type: 'string' },
        confirmar: { type: 'boolean' },
      },
      required: ['projeto', 'bucket', 'caminho'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      exigeConfirmacao(
        args,
        `Apagar ${args.bucket}/${args.caminho} em "${projeto.name}" é definitivo: o Storage não tem lixeira.`,
      )

      const { url, key } = await serviceKey(projeto)
      await deleteObject(url, key, String(args.bucket), String(args.caminho))

      await audit({
        action: 'storage.file_deleted',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.bucket}/${args.caminho}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp' },
      })

      return { apagado: true }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Edge functions
   ═══════════════════════════════════════════════════════════════════════════ */

const FERRAMENTAS_FUNCOES: ToolDef[] = [
  {
    name: 'listar_edge_functions',
    group: 'funcoes',
    requires: 'leitura',
    readOnly: true,
    description: 'Edge functions publicadas no projeto, com versão e estado.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      return (await listEdgeFunctions(pat, ref)).map((f) => ({
        slug: f.slug,
        nome: f.name,
        estado: f.status,
        versao: f.version,
        verifica_jwt: f.verify_jwt,
        url: `${projeto.url}/functions/v1/${f.slug}`,
      }))
    },
  },

  {
    name: 'obter_edge_function',
    group: 'funcoes',
    requires: 'leitura',
    readOnly: true,
    description: 'Código-fonte e metadados de uma edge function.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        slug: { type: 'string' },
      },
      required: ['projeto', 'slug'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)
      const slugFn = String(args.slug)

      const [meta, codigo] = await Promise.all([
        getEdgeFunction(pat, ref, slugFn),
        getEdgeFunctionBody(pat, ref, slugFn).catch(() => ''),
      ])

      return {
        slug: meta.slug,
        nome: meta.name,
        versao: meta.version,
        verifica_jwt: meta.verify_jwt,
        entrada: meta.entrypoint_path,
        codigo,
      }
    },
  },

  {
    name: 'publicar_edge_function',
    group: 'funcoes',
    requires: 'ddl',
    description:
      'Publica ou atualiza uma edge function. O slug decide: se já existe, vira versão nova; se não, nasce agora. O código roda em Deno, e a URL fica em <projeto>/functions/v1/<slug>.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        slug: { type: 'string', description: 'Nome na URL: enviar-email' },
        arquivos: {
          type: 'array',
          description: 'Um item por arquivo. O primeiro é a entrada, salvo se entrada for dito.',
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string', description: 'index.ts' },
              conteudo: { type: 'string' },
            },
            required: ['nome', 'conteudo'],
          },
        },
        entrada: { type: 'string', description: 'Arquivo de entrada. Padrão: o primeiro.' },
        verificar_jwt: {
          type: 'boolean',
          description: 'true exige token de usuário autenticado para chamar a function',
        },
      },
      required: ['projeto', 'slug', 'arquivos'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      const arquivos = (args.arquivos as Array<{ nome: string; conteudo: string }> | undefined) ?? []
      if (!arquivos.length) throw new Error('Envie ao menos um arquivo com o código da function.')

      const publicada = await deployEdgeFunction(pat, ref, {
        slug: String(args.slug),
        files: arquivos.map((a) => ({ name: a.nome, content: a.conteudo })),
        entrypoint: args.entrada ? String(args.entrada) : undefined,
        verifyJwt: args.verificar_jwt === undefined ? undefined : args.verificar_jwt === true,
      })

      await audit({
        action: 'function.deployed',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name} · ${args.slug}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', arquivos: arquivos.map((a) => a.nome) },
      })

      return {
        publicada: true,
        slug: publicada.slug ?? args.slug,
        versao: publicada.version ?? null,
        url: `${projeto.url}/functions/v1/${publicada.slug ?? args.slug}`,
      }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Monitoramento e diagnóstico
   ═══════════════════════════════════════════════════════════════════════════ */

/** Consultas padrão por serviço, no formato que a API de logs espera. */
const LOGS_POR_SERVICO: Record<string, string> = {
  api: 'edge_logs',
  postgres: 'postgres_logs',
  auth: 'auth_logs',
  storage: 'storage_logs',
  realtime: 'realtime_logs',
  edge_function: 'function_edge_logs',
  function: 'function_logs',
}

const FERRAMENTAS_MONITORAMENTO: ToolDef[] = [
  {
    name: 'saude_projeto',
    group: 'monitoramento',
    requires: 'leitura',
    readOnly: true,
    description:
      'Estado e uso de recursos de um projeto: saúde por serviço, CPU, memória, disco, tamanho do banco e conexões ativas, com histórico recente.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        horas: { type: 'number', description: 'Janela do histórico. Padrão 24.' },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const horas = Math.min(Number(args.horas) || 24, 168)
      const desde = new Date(Date.now() - horas * 3600_000).toISOString()

      const { data } = await systemDb()
        .from('snapshots')
        .select(
          'collected_at, overall_health, health_json, cpu_pct, ram_pct, disk_pct, db_size_bytes, active_connections, error',
        )
        .eq('project_id', projeto.id)
        .gte('collected_at', desde)
        .order('collected_at', { ascending: false })

      const atual = data?.[0] ?? null

      return {
        projeto: projeto.name,
        estado: projeto.status,
        regiao: projeto.region,
        versao_postgres: projeto.pg_version,
        atual: atual
          ? {
              saude: atual.overall_health,
              servicos: atual.health_json,
              cpu_pct: atual.cpu_pct,
              memoria_pct: atual.ram_pct,
              disco_pct: atual.disk_pct,
              tamanho_banco_bytes: atual.db_size_bytes,
              conexoes_ativas: atual.active_connections,
              aviso: atual.error ? humanizeShort(atual.error) : null,
              coletado_em: atual.collected_at,
            }
          : null,
        historico: (data ?? []).slice(0, 50),
      }
    },
  },

  {
    name: 'obter_recomendacoes',
    group: 'monitoramento',
    requires: 'leitura',
    readOnly: true,
    description:
      'Avisos de segurança e de performance do projeto, a mesma lista da aba Advisors do painel: tabela exposta sem RLS, função com search_path mutável, chave estrangeira sem índice, índice que ninguém usa. Chame SEMPRE depois de criar tabela ou aplicar migração.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        tipo: {
          type: 'string',
          enum: ['seguranca', 'performance', 'ambos'],
          description: 'Padrão: ambos',
        },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)
      const tipo = String(args.tipo ?? 'ambos')

      const enxuga = (lista: Awaited<ReturnType<typeof getAdvisors>>) =>
        lista.map((a) => ({
          nivel: a.level,
          titulo: a.title ?? a.name,
          descricao: a.description,
          detalhe: a.detail,
          como_resolver: a.remediation,
        }))

      const resultado: Record<string, unknown> = {}

      if (tipo === 'seguranca' || tipo === 'ambos') {
        resultado.seguranca = enxuga(await getAdvisors(pat, ref, 'security'))
      }
      if (tipo === 'performance' || tipo === 'ambos') {
        resultado.performance = enxuga(await getAdvisors(pat, ref, 'performance'))
      }

      return resultado
    },
  },

  {
    name: 'consultar_logs',
    group: 'monitoramento',
    requires: 'leitura',
    readOnly: true,
    description:
      'Logs do projeto por serviço (api, postgres, auth, storage, realtime, edge_function), do último minuto até um dia atrás. É por onde se investiga erro que o usuário relatou. A janela padrão é curta de propósito: log antigo demora a voltar.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        servico: {
          type: 'string',
          enum: ['api', 'postgres', 'auth', 'storage', 'realtime', 'edge_function', 'function'],
        },
        limite: { type: 'number', description: 'Padrão 50, máximo 200' },
        horas: { type: 'number', description: 'Janela para trás. Padrão 1, máximo 24.' },
        sql: {
          type: 'string',
          description: 'Consulta própria, quando a padrão não basta. Substitui limite e serviço.',
        },
      },
      required: ['projeto', 'servico'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      const tabela = LOGS_POR_SERVICO[String(args.servico)]
      if (!tabela) throw new Error(`Serviço "${args.servico}" não tem logs conhecidos.`)

      const limite = Math.min(Number(args.limite) || 50, 200)
      const horas = Math.min(Number(args.horas) || 1, 24)

      const sql =
        (typeof args.sql === 'string' && args.sql.trim()) ||
        `select id, timestamp, event_message from ${tabela} order by timestamp desc limit ${limite}`

      const linhas = await queryLogs(pat, ref, sql, {
        iso_timestamp_start: new Date(Date.now() - horas * 3600_000).toISOString(),
        iso_timestamp_end: new Date().toISOString(),
      })

      return { servico: args.servico, janela_horas: horas, registros: linhas }
    },
  },

  {
    name: 'listar_backups',
    group: 'monitoramento',
    requires: 'leitura',
    readOnly: true,
    description: 'Histórico de backups de um projeto, com data, tamanho e o que cada um contém.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)

      const { data } = await systemDb()
        .from('backups')
        .select('started_at, status, size_bytes, table_count, row_count, trigger_source, error')
        .eq('project_id', projeto.id)
        .order('started_at', { ascending: false })
        .limit(30)

      return (data ?? []).map((b) => ({
        data: b.started_at,
        estado: b.status,
        tamanho_bytes: b.size_bytes,
        tabelas: b.table_count,
        linhas: b.row_count,
        origem: b.trigger_source === 'cron' ? 'automático' : 'manual',
        aviso: b.error ? humanizeShort(b.error) : null,
      }))
    },
  },

  {
    name: 'criar_backup',
    group: 'monitoramento',
    requires: 'escrita',
    description:
      'Dispara um backup do projeto agora e espera terminar. Vale a pena antes de uma migração que mexe em dados: é o que dá como voltar atrás. Em bancos grandes pode demorar.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const resultado = await runBackup(projeto, 'manual')

      if (!resultado.ok) {
        throw new Error(resultado.error ?? 'O backup não completou.')
      }

      await audit({
        action: 'backup.created',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name}`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp', tamanho: resultado.sizeBytes },
      })

      return {
        feito: true,
        tamanho_bytes: resultado.sizeBytes ?? null,
        conteudo: resultado.counts ?? null,
        avisos: resultado.warnings ?? [],
      }
    },
  },

  {
    name: 'listar_cron_jobs',
    group: 'monitoramento',
    requires: 'leitura',
    readOnly: true,
    description:
      'Tarefas agendadas (pg_cron) de um projeto, com expressão, comando, estado e resultado da última execução.',
    inputSchema: {
      type: 'object',
      properties: { projeto: { type: 'string' } },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      const instalado = await runQuery<{ n: boolean }>(
        pat,
        ref,
        "select exists(select 1 from pg_extension where extname = 'pg_cron') as n",
        true,
      )

      if (!instalado[0]?.n) return { pg_cron_instalado: false, agendamentos: [] }

      const jobs = await runQuery(
        pat,
        ref,
        `select jobname, schedule, command, active,
                (select status from cron.job_run_details r
                  where r.jobid = j.jobid order by r.start_time desc limit 1) as ultimo_status,
                (select start_time from cron.job_run_details r
                  where r.jobid = j.jobid order by r.start_time desc limit 1) as ultima_execucao
         from cron.job j order by jobname`,
        true,
      )

      return { pg_cron_instalado: true, agendamentos: jobs }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Desenvolvimento
   ═══════════════════════════════════════════════════════════════════════════ */

const FERRAMENTAS_DESENVOLVIMENTO: ToolDef[] = [
  {
    name: 'obter_credenciais',
    group: 'desenvolvimento',
    requires: 'leitura',
    readOnly: true,
    description:
      'Devolve as credenciais de conexão de um projeto. A URL, a anon key e a publishable key vêm sempre: são públicas por natureza, feitas para ficar em código de frontend. A service_role key e a connection string só vêm se o token tiver permissão explícita, porque quem as possui acessa o banco inteiro sem passar por este servidor.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        incluir_secretas: {
          type: 'boolean',
          description:
            'Pede também a service_role key e a connection string. Só funciona se o token permitir. Peça apenas quando for realmente necessário.',
        },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const creds = await credenciais(projeto)

      // Parte pública: sem risco. É o que se coloca no cliente.
      const resposta: Record<string, unknown> = {
        projeto: projeto.name,
        url: projeto.url,
        ref: projeto.ref,
        anon_key: creds.anonKey ?? null,
        publishable_key: await ensurePublishableKey(creds),
        observacao:
          'A anon key e a publishable key são públicas por design e respeitam as políticas de RLS do projeto. Podem ir para código de frontend. Prefira a publishable key: é a chave nova, que substitui a anon; quando ela vem nula, o projeto ainda só tem as chaves legadas.',
      }

      if (!args.incluir_secretas) return resposta

      if (!ctx.token.canReadSecrets) {
        resposta.secretas_negadas =
          'Este token não tem permissão para ler credenciais secretas. Se for mesmo necessário, ative "ler credenciais" no agente, em Agentes, mas saiba que a service_role key ignora RLS e dá acesso total ao banco.'
        return resposta
      }

      // Daqui em diante a credencial deixa o servidor. Registrar é obrigatório.
      await audit({
        action: 'project.keys_revealed',
        projectId: projeto.id,
        detail: `[agente ${ctx.token.name}] ${projeto.name}, credenciais secretas entregues ao agente`,
        actor: `agente:${ctx.token.name}`,
        meta: { via: 'mcp' },
      })

      resposta.service_role_key = creds.serviceKey ?? null
      resposta.connection_string = creds.dbUrl ?? null
      resposta.aviso =
        'A service_role key ignora RLS e dá acesso total ao banco. Ela agora está no contexto desta conversa, não a grave em arquivo, não a envie a terceiros e não a deixe em código versionado. Esta entrega ficou registrada na auditoria.'

      return resposta
    },
  },

  {
    name: 'gerar_tipos_typescript',
    group: 'desenvolvimento',
    requires: 'leitura',
    readOnly: true,
    description:
      'Gera os tipos TypeScript do schema do projeto, o mesmo arquivo que `supabase gen types typescript` produz. Cole em database.types.ts e passe para createClient<Database>. Gere de novo depois de cada migração.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string' },
        schemas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Padrão: ["public"]',
        },
      },
      required: ['projeto'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projeto = await resolveProject(args.projeto, ctx)
      const { pat, ref } = await comPat(projeto)

      const schemas = (args.schemas as string[] | undefined)?.length
        ? (args.schemas as string[])
        : ['public']

      return {
        schemas,
        tipos: await generateTypescriptTypes(pat, ref, schemas),
      }
    },
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Catálogo
   ═══════════════════════════════════════════════════════════════════════════ */

export const TOOLS: ToolDef[] = [
  ...FERRAMENTAS_PROJETOS,
  ...FERRAMENTAS_BANCO,
  ...FERRAMENTAS_DADOS,
  ...FERRAMENTAS_AUTH,
  ...FERRAMENTAS_STORAGE,
  ...FERRAMENTAS_FUNCOES,
  ...FERRAMENTAS_MONITORAMENTO,
  ...FERRAMENTAS_DESENVOLVIMENTO,
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/**
 * O catálogo que este token enxerga.
 *
 * Esconde o que ele não pode usar: o agente não perde chamada tentando o que
 * seria negado, e o prompt dele fica menor. `executar_sql` é a exceção, ela
 * aparece sempre, porque leitura já é motivo suficiente.
 */
export function toolsForToken(token: ResolvedToken): ToolDef[] {
  const grupos = token.connection?.features ?? []

  return TOOLS.filter((t) => tokenAllows(token, t.requires)).filter(
    (t) => grupos.length === 0 || grupos.includes(t.group),
  )
}

/** Formato de retorno que o protocolo MCP espera. */
export function toolResult(valor: unknown) {
  return { content: [{ type: 'text', text: texto(valor) }] }
}

export function toolError(mensagem: string) {
  return { content: [{ type: 'text', text: mensagem }], isError: true }
}
