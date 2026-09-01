# SuperBase

Painel unificado para gerenciar múltiplos projetos Supabase espalhados por contas diferentes. Um login só, todos os projetos da carteira, com leitura e edição de dados, SQL, usuários, backups e monitoramento de recursos. E um servidor MCP que entrega essa mesma carteira para agentes de IA.

**[Manual completo](MANUAL.md)** · [Por que cada coisa é assim](DECISOES.md) · [Especificação do produto](PRD.md)

---

## O problema

Quem atende vários clientes acaba com projetos Supabase espalhados por contas diferentes. Cada conta tem login próprio, e ver o estado de cinco projetos significa cinco abas e cinco trocas de sessão.

Aqui é um painel só. E, para os agentes, um endereço só: o agente diz o nome do projeto, e o sistema descobre em qual conta ele está, descriptografa a credencial certa e executa. Nenhuma chave passa pelo agente.

## O que ele faz

| Módulo | O que resolve |
|---|---|
| **Cofre de conexões** | Conecta uma conta inteira via Personal Access Token, importando todos os projetos e buscando as chaves sozinho, ou cadastra projetos avulsos com URL e chaves |
| **Carteira** | Todos os projetos em cards ou tabela, com busca, filtros por cliente e saúde, e agrupamento opcional |
| **Visão geral do projeto** | Replica o Project Overview oficial (saúde por serviço, CPU, RAM, disco, tamanho do banco, conexões) e acrescenta o histórico de 24h e 7d, que o painel oficial não mostra |
| **Tabelas** | Navega pelo schema, lê linhas com paginação, ordenação e filtro, edita células, insere e exclui |
| **SQL Runner** | Executa SQL arbitrário, com histórico e confirmação obrigatória em comandos de escrita |
| **Cron Jobs** | Agenda tarefas no Postgres via `pg_cron`, e traduz a expressão cron para português |
| **No Sleep** | Um clique impede que o projeto seja pausado por inatividade |
| **Backups** | Backup lógico diário de cada banco, comprimido no Storage do sistema, validado por teste de restauração real |
| **Auth** | Lista, cria, confirma, bane e exclui usuários do projeto |
| **Storage** | Navega buckets e pastas, baixa via link temporário, exclui arquivos |
| **Clientes** | CRM leve para agrupar projetos por cliente, mesmo entre contas diferentes |
| **Saúde geral** | Todos os projetos lado a lado, com destaque para os que pedem atenção |
| **Auditoria** | Registro de toda ação sensível |
| **Agentes (MCP)** | 37 ferramentas cobrindo dados, schema, migrações, Auth, Storage, edge functions, logs e criação de projeto. Token por agente, com escada de permissão e leitura de credenciais em separado |

## Instalação

Leva cerca de quinze minutos e está detalhada no **[manual](MANUAL.md#3-instalação-do-zero)**. O resumo:

```bash
git clone https://github.com/SEU-USUARIO/superbase.git
cd superbase
npm install
npm run genkey            # gera as chaves do cofre e do cron
cp .env.example .env.local
# preencha o .env.local com o seu projeto Supabase do sistema
npm run check             # diz exatamente o que ainda falta
npm run dev
```

Cada instalação é isolada: você cria o seu próprio projeto Supabase do sistema, gera as suas chaves e conecta as suas contas. Não existe servidor central nem credencial compartilhada, e não há nada no repositório apontando para a instalação de outra pessoa.

## Arquitetura

```
Navegador (só interface, zero segredos)
   │  HTTPS + cookie de sessão httpOnly
   ▼
Vercel, Next.js 15 App Router
   ├─ Vercel Cron ──► coleta de métricas e backup diário
   ├─ Banco do sistema: projeto Supabase dedicado
   │     cofre · clientes · auditoria · snapshots · tokens
   ├─ /api/mcp ──► agentes de IA (JSON-RPC 2.0)
   └─ Gateway
         ├─ Management API (PAT)      → projetos, chaves, saúde, SQL
         ├─ PostgREST, Auth, Storage  → dados (service_role)
         └─ Métricas Prometheus       → CPU, RAM, disco
```

**Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, Recharts. Nenhuma dependência nativa, e toda a criptografia usa o módulo `crypto` do próprio Node.

## Segurança

- **Segredos criptografados em repouso** com AES-256-GCM. A chave mestra vive numa variável de ambiente, nunca no banco: um dump do banco do sistema, sozinho, é inútil.
- **Nenhuma credencial chega ao navegador** sem ação explícita, e revelar uma chave fica registrado na auditoria.
- **Login pelo Supabase Auth**, com rate limit centralizado, sessão em cookie httpOnly e recuperação de senha por e-mail.
- **Allowlist de e-mail** validada no servidor. Sem a lista preenchida, ninguém entra.
- **RLS habilitado e sem policies** no banco do sistema, o que faz só a service_role acessar.
- **Tokens de agente guardados como hash SHA-256.** Se o banco vazar, ninguém reconstrói os tokens.
- **Rate limit em duas camadas** (memória da instância e tabela no banco) no login, no MCP e nas rotas de cron.

Antes de publicar um fork, rode `npm run leaks -- --full`. Ele varre os arquivos versionados e todo o histórico do git atrás de chaves, tokens e connection strings.

## Comandos

```bash
npm run dev        # desenvolvimento
npm run build      # build de produção (pare o dev antes, eles disputam a pasta .next)
npm run typecheck  # checagem de tipos

npm run check      # configuração, banco, migration e usuário de login
npm run selftest   # cofre, parser de métricas, detecção de escrita (offline)
npm run smoke      # todas as telas renderizam com o conteúdo esperado
npm run e2e        # fluxo de autenticação ponta a ponta
npm run probe      # tenta invadir o próprio sistema usando só o que é público
npm run leaks      # procura segredo versionado (use -- --full para o histórico)

npm run test:restore  # gera um backup e RESTAURA num schema descartável
npm run test:guard    # a guarda de SQL do MCP, sozinha
npm run test:mcp      # testa o MCP como um agente sequestrado tentaria abusar dele
```

## Estrutura

```
src/
  app/
    (app)/              páginas autenticadas
      page.tsx            carteira
      saude/              saúde geral da carteira
      clientes/           CRM leve
      conexoes/           cofre de conexões
      agentes/            tokens do MCP
      auditoria/          histórico de ações
      projetos/[id]/      detalhe do projeto, com as abas
    api/                route handlers, incluindo /api/mcp
    login/              autenticação
  components/
    ui/                 design system (Button, Field, Toast, ...)
    AppShell.tsx        navegação e layout autenticado
  lib/
    crypto.ts           cofre AES-256-GCM
    session.ts          sessão e allowlist de e-mail
    rate-limit.ts       teto de chamadas, duas camadas
    db.ts               cliente do banco do sistema
    gateway/            tudo que fala com a Supabase de fora
    mcp/                ferramentas, tokens e guarda de SQL
supabase/migrations/    schema do banco do sistema
scripts/                genkey, check-db, selftest, check-leaks
```

## Licença

Uso livre. Se este código lhe for útil, fique à vontade para adaptá-lo ao seu fluxo.
