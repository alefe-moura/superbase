-- =====================================================================
-- 0002, remove a tabela de login proprio
--
-- A autenticacao passou a ser feita pelo Supabase Auth do proprio projeto
-- do sistema. Motivo: o rate limit contra forca bruta precisa ser
-- centralizado (num ambiente serverless, um contador em memoria nasce
-- zerado a cada instancia) e o GoTrue ja resolve isso, alem de reset de
-- senha e revogacao de sessao.
--
-- Rode este SQL apenas se voce ja tinha aplicado a 0001 antes da mudanca.
-- Em instalacoes novas a tabela nem chega a ser criada.
-- =====================================================================

drop table if exists app_users;
