-- =====================================================================
-- SuperBase Manager, schema do banco do sistema
-- Rode este SQL no SQL Editor do projeto Supabase DEDICADO ao sistema.
--
-- IMPORTANTE: este banco e acessado exclusivamente pelo backend do app
-- com a service_role key. RLS fica habilitado e SEM policies, de modo que
-- nenhuma chave anon consiga ler nada mesmo que vaze.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Clientes (CRM leve)
-- ---------------------------------------------------------------------
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text,
  notes      text,
  color      text,                            -- hex opcional para o badge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_name_idx on clients (lower(name));

-- ---------------------------------------------------------------------
-- Contas Supabase (1 PAT por conta): nao agrupam a UI, servem para sync
-- ---------------------------------------------------------------------
create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  login_email   text not null,
  alias         text,
  pat_encrypted text not null,                -- AES-256-GCM (envelope v1)
  status        text not null default 'active',  -- active | invalid | disabled
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists accounts_login_email_idx on accounts (lower(login_email));

-- ---------------------------------------------------------------------
-- Projetos gerenciados
-- ---------------------------------------------------------------------
create table if not exists projects (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid references accounts(id) on delete set null,
  client_id          uuid references clients(id) on delete set null,

  ref                text,                    -- project ref (ex: abcdefghijklm)
  name               text not null,
  url                text not null,           -- https://<ref>.supabase.co
  account_email      text,                    -- "tag" de conta exibida na UI

  anon_key_enc       text,
  service_key_enc    text,
  db_url_enc         text,

  source             text not null default 'manual',  -- sync | manual
  status             text,                    -- ACTIVE_HEALTHY, PAUSED, ...
  region             text,
  pg_version         text,
  notes              text,

  archived_at        timestamptz,             -- soft delete
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists projects_ref_idx on projects (ref) where ref is not null and archived_at is null;
create index if not exists projects_client_idx  on projects (client_id);
create index if not exists projects_account_idx on projects (account_id);

-- ---------------------------------------------------------------------
-- Snapshots de monitoramento (coletados pelo cron)
-- ---------------------------------------------------------------------
create table if not exists snapshots (
  id                 bigserial primary key,
  project_id         uuid not null references projects(id) on delete cascade,
  collected_at       timestamptz not null default now(),

  ok                 boolean not null default false,
  error              text,

  health_json        jsonb,                   -- [{name, healthy, status}]
  overall_health     text,                    -- healthy | degraded | down | unknown

  cpu_pct            double precision,
  ram_pct            double precision,
  ram_total_bytes    bigint,
  ram_used_bytes     bigint,
  disk_pct           double precision,
  disk_total_bytes   bigint,
  disk_used_bytes    bigint,
  load1              double precision,

  db_size_bytes      bigint,
  active_connections integer,
  max_connections    integer,

  cpu_total_seconds  double precision,        -- contador bruto p/ calcular delta
  cpu_idle_seconds   double precision
);

create index if not exists snapshots_project_time_idx on snapshots (project_id, collected_at desc);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table if not exists audit_logs (
  id          bigserial primary key,
  project_id  uuid references projects(id) on delete set null,
  action      text not null,
  detail      text,
  meta        jsonb,
  actor       text,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_created_idx on audit_logs (created_at desc);
create index if not exists audit_project_idx on audit_logs (project_id, created_at desc);

-- ---------------------------------------------------------------------
-- Historico de SQL
-- ---------------------------------------------------------------------
create table if not exists query_history (
  id            bigserial primary key,
  project_id    uuid not null references projects(id) on delete cascade,
  sql           text not null,
  success       boolean not null default true,
  error         text,
  row_count     integer,
  duration_ms   integer,
  executed_at   timestamptz not null default now()
);

create index if not exists query_history_project_idx on query_history (project_id, executed_at desc);

-- ---------------------------------------------------------------------
-- Trava de tudo: RLS on, zero policies => so a service_role acessa
-- ---------------------------------------------------------------------
alter table clients       enable row level security;
alter table accounts      enable row level security;
alter table projects      enable row level security;
alter table snapshots     enable row level security;
alter table audit_logs    enable row level security;
alter table query_history enable row level security;

-- ---------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists clients_touch on clients;
create trigger clients_touch before update on clients
  for each row execute function touch_updated_at();

drop trigger if exists accounts_touch on accounts;
create trigger accounts_touch before update on accounts
  for each row execute function touch_updated_at();

drop trigger if exists projects_touch on projects;
create trigger projects_touch before update on projects
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Limpeza de snapshots antigos (retencao 30 dias)
-- Chamada pelo cron do app; tambem pode virar pg_cron se preferir.
-- ---------------------------------------------------------------------
create or replace function prune_snapshots(days integer default 30)
returns integer language plpgsql as $$
declare removed integer;
begin
  delete from snapshots where collected_at < now() - (days || ' days')::interval;
  get diagnostics removed = row_count;
  return removed;
end $$;
