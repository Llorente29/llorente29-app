-- supabase/staging/sql/20261113_b01r26_ensayo_c0009_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · el ensayo en la C0009 (2005) y su
-- limpieza. Todo en una transacción con ROLLBACK. En staging no está Foodint:
--   1. Sin Foodint, la tanda solo crea su tabla y no toca ni envíos ni conexiones.
--   2. La limpieza (su vuelta atrás), sin ensayo guardado, no toca nada y quita la tabla.
--   3. La limpieza otra vez, sin tabla: no hace nada (se puede repetir).
-- Con los datos de verdad, la tanda y su limpieza las prueba el ensayo de
-- producción («la vuelta atrás automática funcionaría», con las cuentas iguales).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 ENSAYO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda y su limpieza las corre el dueño; no hay nada que un usuario pueda hacer con ellas.

create temp table prueba_antes on commit drop as
  select (select md5(coalesce(string_agg(s.id::text || s.status || coalesce(s.last_error, ''), ',' order by s.id), '')) from public.external_send s) envios,
         (select md5(coalesce(string_agg(c.id::text || coalesce(c.external_account_id, '') || coalesce(c.config::text, ''), ',' order by c.id), '')) from public.account_connector c) conexiones;

\i supabase/migrations/20261113T2005_b01r26_ensayo_c0009.sql
do $$ begin
  if to_regclass('public.conta_b01r26_ensayo') is null then raise exception 'PRUEBA B01r26 ENSAYO 1: no ha creado su tabla.'; end if;
  if exists (select 1 from public.conta_b01r26_ensayo) then raise exception 'PRUEBA B01r26 ENSAYO 1: sin Foodint ha guardado algo.'; end if;
  if (select md5(coalesce(string_agg(s.id::text || s.status || coalesce(s.last_error, ''), ',' order by s.id), '')) from public.external_send s) <> (select envios from prueba_antes)
     or (select md5(coalesce(string_agg(c.id::text || coalesce(c.external_account_id, '') || coalesce(c.config::text, ''), ',' order by c.id), '')) from public.account_connector c) <> (select conexiones from prueba_antes) then
    raise exception 'PRUEBA B01r26 ENSAYO 1: sin Foodint ha tocado envíos o conexiones.';
  end if;
end $$;

\i supabase/vuelta-atras/20261113T2005_b01r26_ensayo_c0009.down.sql
do $$ begin
  if to_regclass('public.conta_b01r26_ensayo') is not null then raise exception 'PRUEBA B01r26 ENSAYO 2: la limpieza no ha quitado la tabla.'; end if;
  if (select md5(coalesce(string_agg(s.id::text || s.status || coalesce(s.last_error, ''), ',' order by s.id), '')) from public.external_send s) <> (select envios from prueba_antes) then
    raise exception 'PRUEBA B01r26 ENSAYO 2: la limpieza sin ensayo ha tocado envíos.';
  end if;
end $$;

\i supabase/vuelta-atras/20261113T2005_b01r26_ensayo_c0009.down.sql

select 'PRUEBA B01r26 ensayo en la C0009: en verde' as resultado;
rollback;
