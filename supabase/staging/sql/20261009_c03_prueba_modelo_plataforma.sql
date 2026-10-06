-- ============================================================================
-- C03 · Respuesta 2 · Prueba en staging-conta de 20261009T0180 (cómo vende una
-- plataforma: comisionista o revendedor). En una transacción con ROLLBACK.
--   1. La migración entra y la columna nace nula en TODAS las filas (nadie
--      queda dicho por defecto: la ficha pregunta).
--   2. El CHECK: solo los dos valores, y solo en el papel de plataforma.
--   3. Su vuelta atrás PARA si hay un modelo dicho; con todos nulos, deshace.
--   4. Se vuelve a aplicar (idempotente).
-- ============================================================================
begin;

\echo '>>> 1. La 0180 entra; platform_model nulo en todas las filas'
\ir ../../migrations/20261009T0180_c03_modelo_plataforma.sql
do $$
begin
  if exists (select 1 from public.party_role where platform_model is not null) then
    raise exception 'PRUEBA 1: hay filas con modelo sin que nadie lo haya dicho.';
  end if;
  if not exists (select 1 from public.party_role where role = 'platform') then
    raise exception 'PRUEBA 1: staging no tiene ninguna plataforma; la prueba no prueba nada.';
  end if;
  raise notice 'PRUEBA 1 ok: % papeles de plataforma, todos sin decir.', (select count(*) from public.party_role where role = 'platform');
end $$;

\echo '>>> 2. El CHECK'
do $$
declare v_plat uuid; v_otro uuid;
begin
  select party_id into v_plat from public.party_role where role = 'platform' order by party_id limit 1;
  select party_id into v_otro from public.party_role where role <> 'platform' order by party_id limit 1;
  update public.party_role set platform_model = 'comisionista' where party_id = v_plat and role = 'platform';
  update public.party_role set platform_model = 'revendedor' where party_id = v_plat and role = 'platform';
  begin
    update public.party_role set platform_model = 'mayorista' where party_id = v_plat and role = 'platform';
    raise exception 'PRUEBA 2: aceptó un modelo que no existe.';
  exception when check_violation then null;
  end;
  begin
    update public.party_role set platform_model = 'comisionista' where party_id = v_otro and role <> 'platform';
    raise exception 'PRUEBA 2: aceptó un modelo en un papel que no es de plataforma.';
  exception when check_violation then null;
  end;
  raise notice 'PRUEBA 2 ok: solo comisionista o revendedor, y solo en una plataforma.';
end $$;

\echo '>>> 3a. La vuelta atrás PARA con un modelo dicho (la prueba 2 dejó uno)'
-- El .down de verdad, no una copia de su guarda: se deja seguir a psql tras el
-- error, se mira :ERROR y se vuelve al punto de guardado.
savepoint antes_de_la_vuelta;
\set ON_ERROR_STOP 0
\ir ../../vuelta-atras/20261009T0180_c03_modelo_plataforma.down.sql
\set fallo_la_vuelta :ERROR
rollback to savepoint antes_de_la_vuelta;
\set ON_ERROR_STOP 1
\if :fallo_la_vuelta
\echo 'PRUEBA 3a ok: la vuelta atrás se para (hay una plataforma con su modelo dicho).'
\else
do $$ begin raise exception 'PRUEBA 3a: la vuelta atrás ha borrado un modelo dicho sin pararse.'; end $$;
\endif

\echo '>>> 3b. Con todos sin decir, la vuelta atrás deshace'
update public.party_role set platform_model = null where platform_model is not null;
\ir ../../vuelta-atras/20261009T0180_c03_modelo_plataforma.down.sql
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'party_role' and column_name = 'platform_model') then
    raise exception 'PRUEBA 3b: la columna sigue ahí.';
  end if;
  raise notice 'PRUEBA 3b ok: columna y CHECK quitados.';
end $$;

\echo '>>> 4. Se vuelve a aplicar, dos veces (idempotente)'
\ir ../../migrations/20261009T0180_c03_modelo_plataforma.sql
\ir ../../migrations/20261009T0180_c03_modelo_plataforma.sql
do $$
begin
  if (select count(*) from pg_constraint where conname = 'party_role_modelo_plataforma') <> 1 then
    raise exception 'PRUEBA 4: el CHECK no está una vez.';
  end if;
  raise notice 'PRUEBA 4 ok.';
end $$;

\echo '>>> Prueba de la 0180 en verde. ROLLBACK: no queda nada.'
rollback;
