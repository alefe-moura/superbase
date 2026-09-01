-- =====================================================================
-- 0007, permissões de estrutura e de gestão de projetos para agentes
--
-- Até aqui um agente tinha duas chaves: escrever (INSERT/UPDATE) e ler
-- credenciais. Tudo que mexia em ESTRUTURA (CREATE, ALTER, DROP) e tudo
-- que criava ou pausava PROJETO era bloqueado no servidor, sem exceção.
--
-- Isso resolvia o risco de injeção de prompt, mas impedia o uso legítimo:
-- um agente de desenvolvimento precisa criar tabela, criar índice, ajustar
-- policy e criar o projeto onde a aplicação vai morar.
--
-- A troca é a mesma que a Supabase fez no MCP oficial: em vez de proibir,
-- exigir que a permissão seja LIGADA DE PROPÓSITO, por agente, e deixar o
-- padrão fechado. Quem já existe continua exatamente como estava, porque
-- as colunas nascem falsas.
--
-- As barreiras que sobram e não dependem de permissão nenhuma:
--   · comandos que leem arquivos do servidor ou executam programas
--   · operações destrutivas sem confirmação explícita na chamada
--   · registro em auditoria de tudo que altera
-- =====================================================================

alter table mcp_tokens
  add column if not exists can_ddl             boolean not null default false,
  add column if not exists can_manage_projects boolean not null default false;

comment on column mcp_tokens.can_ddl is
  'Permite CREATE, ALTER, DROP, policies, indices e migrations no banco dos projetos que o token alcanca. Operacoes destrutivas ainda exigem confirmacao explicita na chamada.';

comment on column mcp_tokens.can_manage_projects is
  'Permite criar projeto novo na conta Supabase, pausar, restaurar e editar os dados do projeto na carteira.';

-- ---------------------------------------------------------------------
-- Migrations aplicadas por agente
--
-- O registro fica TAMBEM no proprio projeto, em
-- supabase_migrations.schema_migrations, que e a tabela que o CLI da
-- Supabase usa, assim uma migration aplicada por agente aparece para
-- quem trabalha pelo CLI. Aqui guardamos a copia central, com o SQL
-- inteiro e quem mandou, para a auditoria conseguir responder "quem mudou
-- esta tabela e o que exatamente rodou".
-- ---------------------------------------------------------------------
create table if not exists agent_migrations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  version    text not null,             -- timestamp no formato do CLI: YYYYMMDDHHMMSS
  name       text not null,
  sql        text not null,

  token_id   uuid references mcp_tokens(id) on delete set null,
  token_name text,

  ok         boolean not null default true,
  error      text,
  applied_at timestamptz not null default now()
);

create index if not exists agent_migrations_project_idx
  on agent_migrations (project_id, applied_at desc);

alter table agent_migrations enable row level security;
