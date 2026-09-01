#!/usr/bin/env node
/**
 * Testa a guarda de SQL sozinha, sem servidor e sem banco.
 *
 * Este e o teste que importa mais: a guarda e a unica coisa entre um agente
 * sequestrado por injecao de prompt e o banco de um cliente. Aqui ele roda
 * em milissegundos e sem tocar em nada, entao pode rodar a cada mudanca.
 *
 *   node scripts/test-guard.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))

execFileSync(
  'npx',
  ['tsc', 'src/lib/mcp/guard.ts', '--outDir', saida, '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler'],
  { stdio: 'inherit' },
)

fs.renameSync(path.join(saida, 'guard.js'), path.join(saida, 'guard.mjs'))
const { guardSql } = await import(path.join(saida, 'guard.mjs'))

const LEITURA = { canWrite: false, canDdl: false }
const ESCRITA = { canWrite: true, canDdl: false }
const TUDO = { canWrite: true, canDdl: true }
const TUDO_CONF = { canWrite: true, canDdl: true, confirmed: true }
const MIGRACAO = { canWrite: true, canDdl: true, allowMultiple: true }

let falhas = 0
const t = (nome, cond, extra = '') => {
  console.log(`${cond ? 'ok   ' : 'FALHA'} ${nome}${extra ? '  (' + extra + ')' : ''}`)
  if (!cond) falhas++
}
const neg = (sql, caps) => guardSql(sql, caps).allowed === false
const pos = (sql, caps) => guardSql(sql, caps).allowed === true
const kind = (sql, caps) => guardSql(sql, caps).kind

// leitura
t('SELECT passa em leitura', pos('select 1', LEITURA))
t('WITH passa', pos('with a as (select 1) select * from a', LEITURA))
t('EXPLAIN ANALYZE nao vira DDL', kind('explain analyze select * from clients', LEITURA) === 'leitura', kind('explain analyze select * from clients', LEITURA))
t('INSERT negado em leitura', neg("insert into c (a) values (1)", LEITURA))
t('CREATE negado em leitura', neg('create table x (id int)', LEITURA))

// escrita
t('INSERT passa com escrita', pos("insert into c (a) values (1)", ESCRITA))
t('UPDATE com WHERE passa', pos("update c set a = 1 where id = 2", ESCRITA))
t('UPDATE sem WHERE exige confirmar', neg("update c set a = 1", ESCRITA))
t('DELETE com WHERE passa com escrita', pos('delete from c where id = 1', ESCRITA))
t('DELETE sem WHERE exige confirmar', neg('delete from c', ESCRITA))
t('DELETE sem WHERE passa com confirmar', pos('delete from c', { ...ESCRITA, confirmed: true }))
t('CREATE negado em escrita', neg('create table x (id int)', ESCRITA))
t('DROP negado em escrita', neg('drop table x', ESCRITA))

// ddl
t('CREATE TABLE passa com ddl', pos('create table x (id int)', TUDO))
t('CREATE POLICY passa', pos('create policy p on t for select using (true)', TUDO))
t('CREATE OR REPLACE FUNCTION passa', pos('create or replace function f() returns int as $$ select 1 $$ language sql', TUDO))
t('ALTER TABLE ADD COLUMN passa', pos('alter table t add column x int', TUDO))
t('ENABLE RLS passa', pos('alter table t enable row level security', TUDO))
t('DROP TABLE exige confirmar', neg('drop table x', TUDO))
t('DROP TABLE passa com confirmar', pos('drop table x', TUDO_CONF))
t('TRUNCATE exige confirmar', neg('truncate t', TUDO))
t('DROP COLUMN exige confirmar', neg('alter table t drop column c', TUDO))
t('DROP INDEX nao e destrutivo', pos('drop index idx_x', TUDO))
t('GRANT passa com ddl', pos('grant select on t to anon', TUDO))
t('CREATE EXTENSION passa', pos('create extension if not exists pgcrypto', TUDO))

// sempre bloqueado
for (const sql of [
  "select pg_read_file('/etc/passwd')",
  "copy t to program 'curl x'",
  "copy t from program 'sh'",
  "alter system set log_statement = 'none'",
  'drop database postgres',
  'select lo_import(\'/etc/passwd\')',
  'set session authorization postgres',
  'select pg_sleep(10)',
]) t(`bloqueado sempre: ${sql.slice(0, 40)}`, neg(sql, TUDO_CONF))

// multiplos comandos
t('dois comandos negados em SQL avulso', neg('select 1; select 2', TUDO))
t('dois comandos aceitos em migracao', pos('create table a (id int); create table b (id int);', MIGRACAO))
t('migracao com DROP ainda exige confirmar', neg('create table a (id int); drop table b;', MIGRACAO))

// evasao por comentario e literal
t('DELETE escondido apos comentario e visto', neg('select 1 --\ndelete from c', ESCRITA))
t('DROP dentro de string nao conta como DDL', kind("select 'drop table x' as t", LEITURA) === 'leitura')
t('bloco DO exige ddl', neg('do $$ begin delete from c; end $$', ESCRITA))
t('bloco DO passa com ddl', pos('do $$ begin update c set a=1 where id=2; end $$', TUDO))

// vazio e exotico
t('vazio negado', neg('   ', TUDO))
t('comando desconhecido negado', neg('listen canal', TUDO))

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo passou')
fs.rmSync(saida, { recursive: true, force: true })
process.exit(falhas ? 1 : 0)
