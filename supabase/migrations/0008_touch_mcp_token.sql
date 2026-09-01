-- =====================================================================
-- 0008, contadores de uso do token
--
-- A logCall sempre chamou touch_mcp_token, mas essa função nunca existiu:
-- não está em nenhuma migration anterior. E o plano B, que atualizava
-- last_used_at direto, ficava no segundo argumento de um .then(ok, erro).
-- O cliente da Supabase resolve com { error } dentro da resposta em vez de
-- rejeitar a promise, então esse ramo nunca rodou. A falha passava calada.
--
-- Resultado medido em 28/08/2026: 73 chamadas gravadas em mcp_calls, e o
-- token aparecendo como "nunca usado" na tela de Agentes, com call_count
-- em 0 e last_used_at nulo desde 05/08. A auditoria estava correta o tempo
-- todo; quem mentia era o resumo por token.
--
-- O incremento mora aqui, no banco, e não na aplicação: somar em SQL num
-- UPDATE só é atômico. Ler, somar e gravar pela API perderia contagem
-- sempre que duas chamadas chegassem juntas, que é o caso normal de um
-- agente disparando ferramentas em paralelo.
-- =====================================================================

create or replace function public.touch_mcp_token(token_id uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.mcp_tokens
     set last_used_at = now(),
         call_count   = call_count + 1
   where id = token_id;
$$;

comment on function public.touch_mcp_token(uuid) is
  'Marca uso do token: soma 1 em call_count e grava last_used_at. Chamada pela logCall a cada chamada de ferramenta do MCP.';


-- ---------------------------------------------------------------------
-- Acerto do que já passou
--
-- As chamadas antigas estão todas em mcp_calls, então o número certo é
-- recuperável. Sem isto, um token com 73 chamadas voltaria a contar do
-- zero e a tela mostraria "1 chamada", que é pior que mostrar "nunca
-- usado": um número errado parece confiável.
--
-- Só toca em quem está zerado, para não sobrescrever contagem boa se esta
-- migration rodar duas vezes.
-- ---------------------------------------------------------------------
update public.mcp_tokens t
   set call_count   = c.total,
       last_used_at = c.ultima
  from (
    select token_id, count(*) as total, max(created_at) as ultima
      from public.mcp_calls
     where token_id is not null
     group by token_id
  ) c
 where c.token_id = t.id
   and t.call_count = 0;
