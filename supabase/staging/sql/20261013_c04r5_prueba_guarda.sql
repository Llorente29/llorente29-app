-- ============================================================================
-- C04 R5 · Prueba en staging de la guarda 4 del nocturno de producción
-- (scripts/conta/produccion/guarda-lectura.sql): el rol de solo lectura NO
-- PUEDE ESCRIBIR, y BYPASSRLS ya no se rechaza (autorizado por Julio, 08/10).
-- Todo en una transacción que acaba en ROLLBACK: en staging conta_lectura no
-- existe y aquí se crea solo para la prueba, como está en producción.
--
--   1. El rol como en producción (BYPASSRLS, solo lectura, SELECT de los
--      agentes por 20261012T0050_c04r_lectura.sql): la guarda PASA (vacía).
--   2. Con un INSERT sobre una tabla de public: la guarda FALLA.
--   3. Miembro de un rol que escribe: la guarda FALLA y lo nombra.
--   4. Quitado todo eso, vuelve a pasar.
-- ============================================================================
set transaction isolation level repeatable read;
begin;

\echo '>>> 1. El rol como en producción'
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise exception 'PRUEBA C04R5 guarda · 1: conta_lectura ya existe en staging; esta prueba lo da por ausente.';
  end if;
end $$;
create role conta_lectura nologin bypassrls;
alter role conta_lectura set default_transaction_read_only = on;
grant conta_lectura to current_user;
\ir ../../migrations/20261012T0050_c04r_lectura.sql

\set q_guarda `cat scripts/conta/produccion/guarda-lectura.sql`
select set_config('prueba.guarda', :'q_guarda', true) \gset

-- La guarda, ejecutada COMO conta_lectura (current_user es el rol, como en el nocturno).
create function pg_temp.guarda() returns text language plpgsql as $$
declare v text;
begin
  set local role conta_lectura;
  execute regexp_replace(current_setting('prueba.guarda'), ';\s*$', '') into v;
  reset role;
  return v;
end $$;

do $$ declare v text := pg_temp.guarda(); begin
  if not (select rolbypassrls from pg_roles where rolname = 'conta_lectura') then
    raise exception 'PRUEBA C04R5 guarda · 1: el rol de la prueba no tiene BYPASSRLS; no es como el de producción.';
  end if;
  if v <> '' then raise exception 'PRUEBA C04R5 guarda · 1: con el rol como en producción la guarda falla: %', v; end if;
  raise notice 'PRUEBA C04R5 guarda · 1: con BYPASSRLS y solo SELECT, pasa.';
end $$;

\echo '>>> 2. Con un INSERT, tiene que fallar'
grant insert on table public.brand to conta_lectura;
do $$ declare v text := pg_temp.guarda(); begin
  if v not like '%escribe-en-public%' or v not like '%permiso-que-no-es-select%' then
    raise exception 'PRUEBA C04R5 guarda · 2: con INSERT sobre brand la guarda dice «%»: no lo ve.', v;
  end if;
  raise notice 'PRUEBA C04R5 guarda · 2: falla como debe — %', v;
end $$;
revoke insert on table public.brand from conta_lectura;

\echo '>>> 3. Miembro de un rol que escribe, tiene que fallar'
create role prueba_c04r5_escritor nologin;
grant update on table public.brand to prueba_c04r5_escritor;
grant prueba_c04r5_escritor to conta_lectura;
do $$ declare v text := pg_temp.guarda(); begin
  if v not like '%miembro-de-rol-que-escribe:prueba_c04r5_escritor%' then
    raise exception 'PRUEBA C04R5 guarda · 3: miembro de un rol con UPDATE y la guarda dice «%»: no lo ve.', v;
  end if;
  raise notice 'PRUEBA C04R5 guarda · 3: falla como debe — %', v;
end $$;
revoke prueba_c04r5_escritor from conta_lectura;

\echo '>>> 4. Quitado todo, vuelve a pasar'
do $$ declare v text := pg_temp.guarda(); begin
  if v <> '' then raise exception 'PRUEBA C04R5 guarda · 4: quitados los permisos, sigue fallando: %', v; end if;
  raise notice 'PRUEBA C04R5 guarda · 4: pasa otra vez.';
end $$;

\echo '>>> PRUEBA C04R5 guarda: todo en verde. ROLLBACK.'
rollback;
