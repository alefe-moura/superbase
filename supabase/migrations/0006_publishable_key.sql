-- =====================================================================
-- 0006, publishable key no cofre
--
-- A Supabase substituiu o par anon/service_role por publishable/secret.
-- A publishable (`sb_publishable_...`) e o que vai no cliente hoje, e e o
-- que um agente pede primeiro para montar um `createClient`. Guardamos
-- junto das outras para que a secao de Credenciais entregue tudo de uma vez.
--
-- Criptografada como as demais, por consistencia do cofre, apesar de ser
-- publica por natureza, exatamente como a anon key.
--
-- O access token da conta NAO ganha coluna: ele ja vive em
-- `accounts.pat_encrypted` e e um segredo da conta, nao do projeto.
-- =====================================================================

alter table projects
  add column if not exists publishable_key_enc text;

comment on column projects.publishable_key_enc is
  'Publishable key (sb_publishable_...) criptografada. Nula em projetos antigos que ainda so tem as chaves legadas.';
