-- =====================================================================
-- 0005, permissão de ler credenciais
--
-- Separada de `can_write` de propósito: são riscos de natureza diferente.
--
-- Escrita é reversível: o backup diário desfaz. Entregar a service_role
-- key não é: uma vez que ela sai do servidor, está no contexto do agente,
-- no histórico da conversa e nos registros do provedor do modelo. E quem a
-- tiver contorna TODAS as barreiras deste sistema, porque fala direto com o
-- banco sem passar por aqui.
--
-- Por isso o padrão é falso, e a interface avisa.
-- =====================================================================

alter table mcp_tokens
  add column if not exists can_read_secrets boolean not null default false;

comment on column mcp_tokens.can_read_secrets is
  'Permite ao agente obter a service_role key e a connection string. Entregar essas credenciais anula as protecoes do servidor, porque o portador passa a acessar o banco diretamente.';
