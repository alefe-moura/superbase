-- =====================================================================
-- 0004, tokens de agente (MCP)
--
-- Cada agente de IA recebe um token próprio, com escopo definido: quais
-- projetos alcança e se pode escrever. Assim um agente de relatórios não
-- precisa ter o mesmo alcance de um que faz manutenção.
--
-- O token em si NUNCA é guardado, só o hash SHA-256. Se este banco vazar,
-- ninguém consegue reconstruir os tokens.
-- =====================================================================

create table if not exists mcp_tokens (
  id            uuid primary key default gen_random_uuid(),

  name          text not null,              -- "Agente de relatórios", "n8n"
  token_hash    text not null unique,       -- SHA-256 do token; o token não fica aqui
  token_prefix  text not null,              -- primeiros caracteres, para identificar na tela

  -- Escopo -----------------------------------------------------------
  -- Vazio = todos os projetos. Preenchido = só os listados.
  project_ids   uuid[] not null default '{}',
  can_write     boolean not null default false,

  -- Uso --------------------------------------------------------------
  last_used_at  timestamptz,
  call_count    bigint not null default 0,

  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  notes         text
);

create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash) where revoked_at is null;

alter table mcp_tokens enable row level security;

-- ---------------------------------------------------------------------
-- Registro de chamadas
--
-- Separado da auditoria geral porque o volume é diferente: um agente pode
-- fazer dezenas de chamadas por minuto, e misturar isso com "chave revelada"
-- afogaria a tela de auditoria. As ações que ALTERAM dados continuam indo
-- para audit_logs também.
-- ---------------------------------------------------------------------
create table if not exists mcp_calls (
  id          bigserial primary key,
  token_id    uuid references mcp_tokens(id) on delete set null,
  token_name  text,                          -- preservado mesmo se o token sumir
  project_id  uuid references projects(id) on delete set null,

  tool        text not null,
  arguments   jsonb,
  ok          boolean not null default true,
  error       text,
  duration_ms integer,

  created_at  timestamptz not null default now()
);

create index if not exists mcp_calls_time_idx  on mcp_calls (created_at desc);
create index if not exists mcp_calls_token_idx on mcp_calls (token_id, created_at desc);

alter table mcp_calls enable row level security;

-- ---------------------------------------------------------------------
-- Limpeza: o histórico de chamadas cresce rápido e envelhece mal
-- ---------------------------------------------------------------------
create or replace function prune_mcp_calls(days integer default 14)
returns integer language plpgsql as $$
declare removed integer;
begin
  delete from mcp_calls where created_at < now() - (days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end $$;
