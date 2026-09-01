-- =====================================================================
-- 0009: rate limit compartilhado
--
-- Por que no banco, e nao em memoria: a Vercel e serverless. Cada
-- instancia nasce com o proprio processo, entao um contador em memoria
-- comeca zerado toda vez que uma instancia sobe. Quem quisesse forcar
-- senha bastaria espalhar as tentativas, e foi por isso que o
-- login proprio deu lugar ao Supabase Auth (ver 0002 e DECISOES.md).
-- Repetir o mesmo erro numa camada nova nao faria sentido.
--
-- O contador precisa entao viver fora do processo, e o banco do sistema
-- ja esta aqui, ja e consultado a cada requisicao autenticada e nao
-- custa dependencia nova. Uma tabela e uma funcao resolvem.
--
-- Janela fixa, nao deslizante: a janela deslizante exigiria guardar cada
-- tentativa, e o volume de escrita passaria a ser o proprio problema que
-- viemos evitar. A janela fixa erra no limite (ate 2x o teto na virada),
-- e esse erro e aceitavel para o que se quer barrar aqui, que e ordem de
-- grandeza, nao precisao.
-- =====================================================================

create table if not exists rate_limits (
  -- SHA-256 do que identifica o cliente (IP, e-mail, prefixo do token).
  -- Guardamos o hash, nunca o valor: se esta tabela vazar, ela nao entrega
  -- de quem sao os enderecos nem quais e-mails tentaram entrar.
  bucket       text primary key,

  count        integer     not null default 0,
  window_start timestamptz not null default now()
);

create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;

-- ---------------------------------------------------------------------
-- Uma chamada, uma decisao
--
-- Tudo acontece num UPSERT so. Ler, decidir e gravar em passos separados
-- perderia contagem sempre que duas requisicoes chegassem juntas, que e
-- justamente o caso de um ataque. O mesmo motivo da 0008.
--
-- Devolve sempre, inclusive quando recusa, para o handler conseguir
-- montar os cabecalhos RateLimit-* e o Retry-After.
-- ---------------------------------------------------------------------
create or replace function public.rate_limit_hit(
  p_bucket  text,
  p_limit   integer,
  p_seconds integer
)
returns table (allowed boolean, used integer, reset_at timestamptz)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_start timestamptz;
begin
  insert into public.rate_limits as r (bucket, count, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
     set count = case
           when r.window_start < now() - make_interval(secs => p_seconds) then 1
           else r.count + 1
         end,
         window_start = case
           when r.window_start < now() - make_interval(secs => p_seconds) then now()
           else r.window_start
         end
  returning r.count, r.window_start into v_count, v_start;

  return query select
    v_count <= p_limit,
    v_count,
    v_start + make_interval(secs => p_seconds);
end $$;

comment on function public.rate_limit_hit(text, integer, integer) is
  'Conta uma tentativa no balde e diz se ela passa. Janela fixa, incremento atomico. Chamada por src/lib/rate-limit.ts.';

-- ---------------------------------------------------------------------
-- Limpeza
--
-- Balde vencido nao serve para nada: na proxima batida a janela reinicia
-- de qualquer jeito. Sem a poda, um ataque distribuido deixaria uma linha
-- por IP para sempre. Chamada pelo cron de snapshot.
-- ---------------------------------------------------------------------
create or replace function public.prune_rate_limits(hours integer default 24)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare removed integer;
begin
  -- Mesmo idioma das podas da 0001 e 0003. Com make_interval seria preciso
  -- usar notacao nomeada (hours => hours), e o parametro sombrearia o nome
  -- do argumento; assim nao ha ambiguidade nenhuma para o parser.
  delete from public.rate_limits
   where window_start < now() - (hours || ' hours')::interval;

  get diagnostics removed = row_count;
  return removed;
end $$;

comment on function public.prune_rate_limits(integer) is
  'Apaga baldes de rate limit cuja janela ja venceu. Chamada pelo cron de snapshot.';
