-- supabase/staging/sql/20261029_l1ah_firma_interruptor_prueba.sql
--
-- SOLO STAGING. Prueba de la 1135 (L1a-H: la firma del registro, solo cuando
-- la empresa la encienda), con \i dentro de la transacción y ROLLBACK: staging
-- no cambia.
--
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role), en
-- la cuenta A: el administrador, el encargado y el trabajador.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás; los usuarios de la
--       cuenta A.
--   1 · recién aplicada, todas las cuentas apagadas (NULL), y se lee con la
--       sesión.
--   2 · el administrador la enciende y la apaga; la función dice cuántas
--       personas activas hay. El encargado y el trabajador no pueden.
--   3 · el trabajador lee si su empresa la pide.
--   4 · pasada dos veces, no cambia nada.
--   5 · la vuelta atrás: ni columna ni función.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L1AH: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'firma_registro_mes') as l1ah_aplicada \gset
\if :l1ah_aplicada
\i supabase/vuelta-atras/20261029T1135_l1ah_firma_interruptor.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7');

do $$
declare v_falta text;
begin
  select string_agg(x.c, ', ') into v_falta
    from (values ('admin', 'admin'), ('encargado', 'manager'), ('trabajador', 'worker')) x(c, rol)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = 'cuenta') and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA L1AH · faltan los usuarios de prueba de la cuenta A: %.', v_falta; end if;
  if to_regprocedure('public.firma_registro_mes_pedir(uuid,boolean)') is not null then
    raise exception 'PRUEBA L1AH · 0: la función ya existe sin la columna.';
  end if;
  insert into _s values ('personas', (select count(*)::text from public.employees where account_id = (select v::uuid from _s where clave = 'cuenta') and active));
  raise notice '0 · lo de antes: sin la columna ni la función';
end $$;

\i supabase/migrations/20261029T1135_l1ah_firma_interruptor.sql

-- ── 1 · Todas apagadas, y se lee con la sesión ─────────────────────────────
do $$ begin
  if exists (select 1 from public.accounts where firma_registro_mes is not null) then
    raise exception 'PRUEBA L1AH · 1: alguna cuenta sale con la firma encendida o apagada a mano: tienen que nacer todas en NULL.';
  end if;
  if not has_column_privilege('authenticated', 'public.accounts', 'firma_registro_mes', 'select')
     or not has_column_privilege('anon', 'public.accounts', 'firma_registro_mes', 'select') then
    raise exception 'PRUEBA L1AH · 1: la sesión no puede leer la columna (regla de la 0731).';
  end if;
  if has_function_privilege('anon', 'public.firma_registro_mes_pedir(uuid,boolean)', 'execute') then
    raise exception 'PRUEBA L1AH · 1: sin sesión se puede llamar a firma_registro_mes_pedir.';
  end if;
  raise notice '1 · todas las cuentas en NULL (apagada); la columna se lee con la sesión';
end $$;

-- ── 2 · El administrador la enciende y la apaga; los demás, no ──────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _s values ('encender', public.firma_registro_mes_pedir((select v::uuid from _s where clave = 'cuenta'), true)::text);
insert into _s values ('leida_admin', (select firma_registro_mes::text from public.accounts where id = (select v::uuid from _s where clave = 'cuenta')));
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare r jsonb := (select v::jsonb from _s where clave = 'encender');
begin
  if (r->>'pedir')::boolean is distinct from true or (r->>'personas') is distinct from (select v from _s where clave = 'personas') then
    raise exception 'PRUEBA L1AH · 2: al encender, la función devuelve % (personas activas: %).', r, (select v from _s where clave = 'personas');
  end if;
  if (select v from _s where clave = 'leida_admin') is distinct from 'true' then
    raise exception 'PRUEBA L1AH · 2: el administrador no lee la firma encendida.';
  end if;
  if (select count(*) from public.accounts where firma_registro_mes) <> 1 then
    raise exception 'PRUEBA L1AH · 2: se ha encendido en otra cuenta además de la A.';
  end if;
  raise notice '2 · el administrador la enciende: % personas', r->>'personas';
end $$;

do $$
declare c text; ok boolean;
begin
  foreach c in array array['encargado', 'trabajador'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = c), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    ok := false;
    begin
      perform public.firma_registro_mes_pedir((select v::uuid from _s where clave = 'cuenta'), false);
    exception when insufficient_privilege then ok := true;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if not ok then raise exception 'PRUEBA L1AH · 2: el % puede apagar la firma.', c; end if;
  end loop;
  if (select firma_registro_mes from public.accounts where id = (select v::uuid from _s where clave = 'cuenta')) is not true then
    raise exception 'PRUEBA L1AH · 2: el encargado o el trabajador han cambiado la firma.';
  end if;
  raise notice '2 · el encargado y el trabajador no pueden cambiarla';
end $$;

-- ── 3 · El trabajador lee si su empresa la pide ────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _s values ('leida_trabajador', (select firma_registro_mes::text from public.accounts where id = (select v::uuid from _s where clave = 'cuenta')));
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select v from _s where clave = 'leida_trabajador') is distinct from 'true' then
    raise exception 'PRUEBA L1AH · 3: el trabajador no lee que su empresa pide la firma.';
  end if;
  raise notice '3 · el trabajador lee que su empresa la pide';
end $$;

-- El administrador la apaga otra vez.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _s values ('apagar', public.firma_registro_mes_pedir((select v::uuid from _s where clave = 'cuenta'), false)::text);
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if ((select v::jsonb from _s where clave = 'apagar')->>'pedir')::boolean is distinct from false
     or (select firma_registro_mes from public.accounts where id = (select v::uuid from _s where clave = 'cuenta')) is distinct from false then
    raise exception 'PRUEBA L1AH · 2: el administrador no la apaga.';
  end if;
  raise notice '2 · el administrador la apaga';
end $$;

-- ── 4 · Pasada dos veces ────────────────────────────────────────────────────
\i supabase/migrations/20261029T1135_l1ah_firma_interruptor.sql
do $$ begin
  if (select firma_registro_mes from public.accounts where id = (select v::uuid from _s where clave = 'cuenta')) is distinct from false
     or exists (select 1 from public.accounts where firma_registro_mes and id <> (select v::uuid from _s where clave = 'cuenta')) then
    raise exception 'PRUEBA L1AH · 4: pasada dos veces, cambia lo que había.';
  end if;
  if (select count(*) from pg_proc where proname = 'firma_registro_mes_pedir' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'PRUEBA L1AH · 4: hay más de una firma de firma_registro_mes_pedir.';
  end if;
  raise notice '4 · pasada dos veces: nada cambia, una sola firma';
end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261029T1135_l1ah_firma_interruptor.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'firma_registro_mes')
     or to_regprocedure('public.firma_registro_mes_pedir(uuid,boolean)') is not null then
    raise exception 'PRUEBA L1AH · 5: la vuelta atrás deja la columna o la función.';
  end if;
  raise notice '5 · la vuelta atrás: ni columna ni función';
end $$;

rollback;
