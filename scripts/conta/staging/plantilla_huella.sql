-- scripts/conta/staging/plantilla_huella.sql — la huella de la plantilla de prueba.
--
-- W02 (16/10), la regla de la plantilla, punto 5. Una línea por tabla de
-- public con columna account_id: «tabla<TAB>md5 de sus filas de la plantilla».
-- Y una línea «#registro<TAB>md5 del historial»: si la plantilla cambia y el
-- historial no, la ha cambiado alguien sin fichero.
--
-- La plantilla: las cuentas A, B, C y Diez, y las de los perfiles de sus siete
-- usuarios (las solas). Las mismas que copia el carril (scripts/e2e/carril/comun.sql)
-- y que nombra scripts/conta/plantilla.mjs.
--
-- Solo lee (la sesión es de solo lectura). Se corre con psql -At y \gexec.
select string_agg(quote_literal(id::text), ',') as cuentas from (
  select id from public.accounts where id in (
    'c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b',
    'c01c0000-0000-4000-8000-00000000000c', 'c0600000-0000-4000-8000-0000000000d0')
  union
  select account_id from public.user_profiles where user_id in (
    'c01a0000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-0000000000a6',
    'c01b0000-0000-4000-8000-0000000000b1', 'c01c0000-0000-4000-8000-0000000000c1',
    'c0600000-0000-4000-8000-0000000000a1', 'c0600000-0000-4000-8000-0000000000b1',
    'c0600000-0000-4000-8000-0000000000f0')
) x \gset

select 'cuentas' || E'\t' || md5(string_agg(t::text, '|' order by t::text))
  from public.accounts t where id in (:cuentas);

select format(
  'select %L || E''\t'' || coalesce(md5(string_agg(t::text, ''|'' order by t::text)), ''-'') from public.%I t where account_id in (%s)',
  c.relname, c.relname, :'cuentas')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped
 where c.relkind in ('r', 'p') and not c.relispartition
 order by c.relname \gexec

select '#registro' || E'\t' || md5(coalesce(string_agg(version || ':' || coalesce(array_to_string(statements, ''), ''), ',' order by version), ''))
  from supabase_migrations.schema_migrations;
