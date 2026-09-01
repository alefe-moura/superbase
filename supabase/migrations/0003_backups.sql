-- =====================================================================
-- 0003, registro de backups
--
-- O arquivo em si vive no Storage do projeto do sistema (bucket "backups").
-- Esta tabela guarda apenas os metadados, para a interface listar sem
-- precisar varrer o Storage a cada abertura.
-- =====================================================================

create table if not exists backups (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,

  -- caminho dentro do bucket: <project_id>/<timestamp>.sql.gz
  storage_path   text not null,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',  -- running | ok | error
  error          text,

  -- o que entrou no arquivo, para dar como conferir sem baixar
  size_bytes     bigint,
  raw_bytes      bigint,          -- tamanho antes de comprimir
  table_count    integer,
  row_count      integer,
  index_count    integer,
  trigger_count  integer,
  function_count integer,
  policy_count   integer,
  auth_users     integer,

  trigger_source text not null default 'manual',   -- manual | cron
  created_at     timestamptz not null default now()
);

create index if not exists backups_project_idx on backups (project_id, started_at desc);
create index if not exists backups_status_idx  on backups (status, started_at desc);

alter table backups enable row level security;

-- ---------------------------------------------------------------------
-- Bucket do Storage
--
-- Privado: nada aqui pode ser lido sem a service_role key. Os downloads
-- pela interface usam URL assinada de curta duração.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Limpeza por retenção, chamada pelo cron de backup
--
-- Por DATA, não por quantidade: contar arquivos era enganoso, porque
-- clicar em "fazer backup agora" várias vezes num dia consumia dias do
-- histórico. Sempre preserva o backup mais recente de cada projeto, mesmo
-- que ele seja mais antigo que o prazo.
--
-- Remove só o registro; o arquivo no Storage é apagado pelo app antes.
-- ---------------------------------------------------------------------
create or replace function prune_backups(days integer default 30)
returns integer language plpgsql as $$
declare removed integer;
begin
  with mais_recente as (
    select distinct on (project_id) id
    from backups
    where status = 'ok'
    order by project_id, started_at desc
  )
  delete from backups
  where status = 'ok'
    and started_at < now() - (days || ' days')::interval
    and id not in (select id from mais_recente);

  get diagnostics removed = row_count;
  return removed;
end $$;
