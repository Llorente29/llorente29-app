-- ============================================================================
-- C04 R4 · Prueba en staging de 20261012T0050_c04r_lectura.sql: cada agente,
-- CON EL ROL conta_lectura, pasa entero; y si falta un permiso, falla.
-- Todo en una transacción que acaba en ROLLBACK: en staging el rol no existe y
-- aquí se crea solo para la prueba (como la del C02, 20261007_c02_prueba_lectura.sql).
--
--   1. Se crea conta_lectura (sin login, de solo lectura, BYPASSRLS como en
--      producción) y entra la migración.
--   2. Como conta_lectura, los cuatro SQL de los agentes, tal cual están en
--      scripts/conta/ (los lee psql al vuelo): ninguno da «permission denied».
--   3. Que la prueba puede fallar (regla 31): se quita SELECT sobre sale —lo
--      que faltaba en producción— y el agente del libro TIENE que dar 42501.
--      Y lo mismo con el USAGE sobre extensions (journal_huella llama a
--      extensions.digest): sin él, el del libro también falla.
--   4. El rol no puede escribir: un insert como conta_lectura falla.
-- ============================================================================
set transaction isolation level repeatable read;
begin;

\echo '>>> 1. El rol y la migración'
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise exception 'PRUEBA C04R4 lectura · 1: conta_lectura ya existe en staging; esta prueba lo da por ausente.';
  end if;
end $$;
-- Como en producción (crear-usuario-lectura.sql): BYPASSRLS, para que RLS no le
-- esconda filas ni le haga evaluar políticas que producción no evalúa.
create role conta_lectura nologin bypassrls;
alter role conta_lectura set default_transaction_read_only = on;
grant conta_lectura to current_user;
\ir ../../migrations/20261012T0050_c04r_lectura.sql

-- Los cuatro SQL, como texto, para ejecutarlos dentro de un bloque que dice cuál falla y por qué.
\set q_datos `cat scripts/conta/agente-datos-maestros.sql`
\set q_terceros `cat scripts/conta/agente-terceros.sql`
\set q_libro `cat scripts/conta/agente-libro.sql`
\set q_plan `cat scripts/conta/agente-plan-contable.sql`
select set_config('prueba.datos', :'q_datos', true), set_config('prueba.terceros', :'q_terceros', true),
       set_config('prueba.libro', :'q_libro', true), set_config('prueba.plan', :'q_plan', true) \gset

create function pg_temp.pasar_agentes(p_rol text) returns text language plpgsql as $$
declare a text; ok text := ''; v jsonb;
begin
  foreach a in array array['datos', 'terceros', 'libro', 'plan'] loop
    execute format('set local role %I', p_rol);
    begin
      execute regexp_replace(current_setting('prueba.' || a), ';\s*$', '') into v;
    exception when insufficient_privilege then
      execute 'reset role';
      raise exception 'PRUEBA C04R4 lectura · agente «%» como %: %', a, p_rol, sqlerrm using errcode = '42501';
    end;
    execute 'reset role';
    if v is null then raise exception 'PRUEBA C04R4 lectura · agente «%»: no devolvió nada.', a; end if;
    ok := ok || a || ' ';
  end loop;
  return ok;
end $$;

\echo '>>> 2. Los cuatro agentes, como conta_lectura'
do $$ begin
  raise notice 'PRUEBA C04R4 lectura · 2: pasan como conta_lectura: %', pg_temp.pasar_agentes('conta_lectura');
end $$;

\echo '>>> 3. Sin SELECT sobre sale, el agente del libro tiene que fallar'
revoke select on table public.sale from conta_lectura;
do $$ begin
  begin
    perform pg_temp.pasar_agentes('conta_lectura');
    raise exception 'PRUEBA C04R4 lectura · 3: sin SELECT sobre sale los agentes pasaron: la prueba no puede fallar.';
  exception when insufficient_privilege then
    if sqlerrm not like '%«libro»%sale%' then raise exception 'PRUEBA C04R4 lectura · 3: falló otra cosa: %', sqlerrm; end if;
    raise notice 'PRUEBA C04R4 lectura · 3: falla como debe — %', sqlerrm;
  end;
end $$;
grant select on table public.sale to conta_lectura;

\echo '>>> 3b. Sin USAGE sobre extensions, el agente del libro tiene que fallar'
revoke usage on schema extensions from conta_lectura;
do $$ begin
  begin
    perform pg_temp.pasar_agentes('conta_lectura');
    raise exception 'PRUEBA C04R4 lectura · 3b: sin USAGE sobre extensions los agentes pasaron: la prueba no puede fallar.';
  exception when insufficient_privilege then
    if sqlerrm not like '%«libro»%extensions%' then raise exception 'PRUEBA C04R4 lectura · 3b: falló otra cosa: %', sqlerrm; end if;
    raise notice 'PRUEBA C04R4 lectura · 3b: falla como debe — %', sqlerrm;
  end;
end $$;
grant usage on schema extensions to conta_lectura;

\echo '>>> 4. Y no escribe'
do $$ begin
  set local role conta_lectura;
  begin
    insert into public.brand (account_id, name) values ('c01a0000-0000-4000-8000-00000000000a', 'no debería entrar');
    reset role;
    raise exception 'PRUEBA C04R4 lectura · 4: conta_lectura pudo insertar.';
  exception when insufficient_privilege or read_only_sql_transaction then
    reset role;
    raise notice 'PRUEBA C04R4 lectura · 4: no escribe — %', sqlerrm;
  end;
end $$;

\echo '>>> PRUEBA C04R4 lectura: todo en verde. ROLLBACK.'
rollback;
