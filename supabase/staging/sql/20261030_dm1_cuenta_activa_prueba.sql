-- supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
--
-- SOLO STAGING. Prueba de la 1950 y la 1951 (DM1 · PR 1: un usuario en varias
-- empresas), con \i dentro de la transacción y ROLLBACK: staging no cambia.
--
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role). La
-- persona de dos cuentas es el administrador de la cuenta A, al que se da
-- dentro de la transacción un perfil de administrador en la cuenta B (que no
-- tenía). Usa los proveedores (supplier): su lectura pasa por
-- belongs_to_account → current_user_account_ids, y su escritura por
-- current_user_is_admin_or_manager_of.
--
--   0 · lo de antes: si ya están aplicadas, sus vueltas atrás. Y ROJO A
--       PROPÓSITO: con las funciones de antes, la persona de dos cuentas VE LAS
--       DOS y escribe en las dos. Si eso no pasara, la prueba no estaría
--       midiendo nada.
--   1 · recién aplicadas: con una sola cuenta nadie nota nada (el encargado de
--       A ve lo mismo que antes); el superadministrador ve lo mismo que antes;
--       sin usuario, lo mismo que antes ('{}' y falso).
--   2 · la persona de dos cuentas, con A abierta (la más antigua): lee los
--       proveedores de A y ninguno de B, ni pidiéndolo por su id; escribe en A
--       y no en B.
--   3 · cambia a B: lee B y nada de A; escribe en B y no en A. mis_empresas
--       dice las dos, con B abierta.
--   4 · no puede abrir una cuenta de la que no es miembro (NO_AUTORIZADO), y
--       quien no es miembro de B no ve nada de B aunque conozca su id.
--   5 · la 1950, pasada dos veces, igual; una sola firma de cada función.
--   6 · la vuelta atrás, en orden inverso: todo como estaba.
--   R · el rendimiento (decisión 1, condición 4): las 5 consultas de pedidos y
--       cocina con más tiempo en producción (pg_stat_statements, 30/10), como
--       el encargado de A (una sola cuenta, como casi todos), 200 veces cada
--       una, ANTES y DESPUÉS, con la misma consulta a los dos lados. Lo dice
--       en el registro; no para la prueba (en staging el tiempo varía).

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261030T1951_dm1_permisos_de_la_activa') as dm1_b_aplicada \gset
\if :dm1_b_aplicada
\i supabase/vuelta-atras/20261030T1951_dm1_permisos_de_la_activa.down.sql
\endif
select to_regclass('public.user_active_account') is not null as dm1_a_aplicada \gset
\if :dm1_a_aplicada
\i supabase/vuelta-atras/20261030T1950_dm1_cuenta_activa.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert, update on _s to authenticated, anon;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'), ('b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('dos', 'c01a0000-0000-4000-8000-0000000000a1'),        -- administrador de A; se le da B dentro
  ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),  -- solo A
  ('plataforma', 'c0600000-0000-4000-8000-0000000000f0');
insert into _s select 'huella:' || f, md5(pg_get_functiondef(to_regprocedure(f)))
  from unnest(array['public.current_user_account_ids()', 'public.current_user_is_admin_of(uuid)',
    'public.current_user_is_admin_or_manager_of(uuid)', 'public.current_user_is_employee(uuid,uuid)',
    'public.current_user_ve_persona(uuid,uuid)', 'public.current_user_is_office()',
    'public.current_user_location_ids()', 'public.current_employee_and_account()']) f;

do $$
declare v_falta text;
begin
  select string_agg(x.c, ', ') into v_falta
    from (values ('dos', 'a', 'admin'), ('encargado', 'a', 'manager')) x(c, cta, rol)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = x.cta) and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA DM1 · faltan los usuarios de prueba: %.', v_falta; end if;
  if exists (select 1 from public.user_profiles where user_id = (select v::uuid from _s where clave = 'dos') and account_id = (select v::uuid from _s where clave = 'b')) then
    raise exception 'PRUEBA DM1 · 0: el administrador de A ya era miembro de B en staging: la prueba necesita que no.';
  end if;
  if (select count(*) from _s where clave like 'huella:%' and v is not null) <> 8 then
    raise exception 'PRUEBA DM1 · 0: falta alguna de las ocho funciones de permisos.';
  end if;
end $$;

-- R · La medida: misma consulta, mismo usuario, antes y después.
create temp table _medida (consulta text, momento text, ms numeric, primary key (consulta, momento)) on commit drop;
grant select, insert on _medida to authenticated, anon;
create or replace function pg_temp.medir(p_momento text) returns void language plpgsql as $f$
declare
  loc uuid := (select l.id from public.locations l where l.account_id = (select v::uuid from _s where clave = 'a')
                order by (select count(*) from public.sale s where s.location_id = l.id) desc, l.id limit 1);
  acc uuid := (select v::uuid from _s where clave = 'a');
  q record; t0 timestamptz; i int; n int := 200;
begin
  for q in select * from (values
      ('1 · kitchen_day_banner (banner del día de cocina)', format('select public.kitchen_day_banner(%L::uuid)', loc)),
      ('2 · ventas: total por fecha y local', format('select count(*), sum(total) from public.sale where account_id = %L and sold_at >= now() - interval ''60 days'' and sold_at < now() and location_id = %L', acc, loc)),
      ('3 · ventas: total y hora por fecha y local', format('select count(*), sum(total), max(sold_at) from public.sale where account_id = %L and sold_at >= now() - interval ''60 days'' and sold_at < now() and location_id = %L', acc, loc)),
      ('4 · ventas: total y local por fecha', format('select count(*), sum(total), count(location_id) from public.sale where account_id = %L and sold_at >= now() - interval ''60 days'' and sold_at < now() and location_id = %L', acc, loc)),
      ('5 · kds_alarms (alarmas de cocina)', format('select public.kds_alarms(%L::uuid, null)', loc))) x(nombre, consulta)
  loop
    execute q.consulta;  -- una de calentamiento
    t0 := clock_timestamp();
    for i in 1..n loop execute q.consulta; end loop;
    insert into _medida values (q.nombre, p_momento, round(extract(epoch from clock_timestamp() - t0) * 1000 / n, 3));
  end loop;
end $f$;

-- Lo que ve cada uno con las funciones de ANTES (para comparar después con la misma consulta).
create temp table _visto (quien text, momento text, cuentas int, prov_a int, prov_b int, primary key (quien, momento)) on commit drop;
grant select, insert on _visto to authenticated, anon;

-- La persona de dos cuentas: perfil de administrador en B (más nuevo que el de A).
insert into public.user_profiles (user_id, account_id, role, active, display_name, created_at, updated_at)
values ((select v::uuid from _s where clave = 'dos'), (select v::uuid from _s where clave = 'b'), 'admin', true, 'Persona de dos cuentas (prueba DM1)', now(), now());

-- Como quien sea: cuántas cuentas ve y cuántos proveedores de A y de B.
create or replace function pg_temp.mirar(p_quien text, p_momento text) returns void language plpgsql as $f$
begin
  insert into _visto values (p_quien, p_momento,
    coalesce(array_length(public.current_user_account_ids(), 1), 0),
    (select count(*) from public.supplier where account_id = (select v::uuid from _s where clave = 'a')),
    (select count(*) from public.supplier where account_id = (select v::uuid from _s where clave = 'b')));
end $f$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'dos'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.mirar('dos', 'antes');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.mirar('encargado', 'antes');
select pg_temp.medir('antes');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'plataforma'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.mirar('plataforma', 'antes');
reset role;
select set_config('request.jwt.claims', '', true);
insert into _s values ('sin_usuario_antes', (select coalesce(array_length(public.current_user_account_ids(), 1), 0)::text || '·' || public.current_user_is_admin_of((select v::uuid from _s where clave = 'a'))::text));

do $$
declare d _visto;
begin
  select * into d from _visto where quien = 'dos' and momento = 'antes';
  -- ROJO A PROPÓSITO: con las funciones de antes, ve las dos cuentas.
  if d.cuentas <> 2 or d.prov_b = 0 then
    raise exception 'PRUEBA DM1 · 0: con las funciones de antes, la persona de dos cuentas debería ver las dos (ve % cuentas, % proveedores de B): la prueba no mediría nada.', d.cuentas, d.prov_b;
  end if;
  raise notice '0 · con las funciones de antes, la persona de dos cuentas ve las dos (% proveedores de A y % de B): lo que esta tanda arregla', d.prov_a, d.prov_b;
end $$;

\i supabase/migrations/20261030T1950_dm1_cuenta_activa.sql
\i supabase/migrations/20261030T1951_dm1_permisos_de_la_activa.sql

-- ── 1 · Los de una sola cuenta, el superadministrador y sin usuario: igual ────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.mirar('encargado', 'despues');
select pg_temp.medir('despues');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'plataforma'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.mirar('plataforma', 'despues');
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare a _visto; b _visto; q text;
begin
  foreach q in array array['encargado', 'plataforma'] loop
    select * into a from _visto where quien = q and momento = 'antes';
    select * into b from _visto where quien = q and momento = 'despues';
    if (a.cuentas, a.prov_a, a.prov_b) is distinct from (b.cuentas, b.prov_a, b.prov_b) then
      raise exception 'PRUEBA DM1 · 1: el % no ve lo mismo que antes: % cuentas, % y % proveedores; ahora %, % y %.', q, a.cuentas, a.prov_a, a.prov_b, b.cuentas, b.prov_a, b.prov_b;
    end if;
  end loop;
  if (select coalesce(array_length(public.current_user_account_ids(), 1), 0)::text || '·' || public.current_user_is_admin_of((select v::uuid from _s where clave = 'a'))::text)
     is distinct from (select v from _s where clave = 'sin_usuario_antes') then
    raise exception 'PRUEBA DM1 · 1: sin usuario (tareas programadas, service_role) no devuelve lo mismo que antes.';
  end if;
  raise notice '1 · el encargado de una sola cuenta, el superadministrador y sin usuario: lo mismo que antes';
end $$;
do $$
declare r record;
begin
  for r in select a.consulta, a.ms antes, d.ms despues from _medida a join _medida d on d.consulta = a.consulta and d.momento = 'despues'
            where a.momento = 'antes' order by a.consulta loop
    raise notice 'R · % · antes % ms · después % ms (% %%)', r.consulta, r.antes, r.despues,
      case when r.antes > 0 then round((r.despues - r.antes) / r.antes * 100) else null end;
  end loop;
end $$;

-- ── 2 · Dos cuentas, con A abierta (la más antigua) ────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'dos'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.mirar('dos', 'con_a');
do $$
declare ok boolean := false; n int;
begin
  -- Pedir un proveedor de B por su id: nada.
  select count(*) into n from public.supplier where id = (select s.id from public.supplier s where s.account_id = (select v::uuid from _s where clave = 'b') limit 1);
  if n <> 0 then raise exception 'PRUEBA DM1 · 2: con A abierta, lee un proveedor de B pidiéndolo por su id.'; end if;
  insert into public.supplier (account_id, name) values ((select v::uuid from _s where clave = 'a'), 'Proveedor de prueba DM1 en A');
  begin
    insert into public.supplier (account_id, name) values ((select v::uuid from _s where clave = 'b'), 'Proveedor de prueba DM1 en B');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'PRUEBA DM1 · 2: con A abierta, escribe en B.'; end if;
end $$;
reset role;
do $$
declare d _visto;
begin
  select * into d from _visto where quien = 'dos' and momento = 'con_a';
  if d.cuentas <> 1 or d.prov_b <> 0 or d.prov_a = 0 then
    raise exception 'PRUEBA DM1 · 2: con A abierta ve % cuentas, % proveedores de A y % de B: tiene que ver solo A.', d.cuentas, d.prov_a, d.prov_b;
  end if;
  raise notice '2 · con A abierta: % proveedores de A, 0 de B (ni por su id); escribe en A y no en B', d.prov_a;
end $$;

-- ── 3 · Cambia a B ──────────────────────────────────────────────────────────
set local role authenticated;
insert into _s values ('cambio', public.cambiar_empresa((select v::uuid from _s where clave = 'b'))::text);
insert into _s values ('mis_empresas', public.mis_empresas()::text);
select pg_temp.mirar('dos', 'con_b');
do $$
declare ok boolean := false;
begin
  insert into public.supplier (account_id, name) values ((select v::uuid from _s where clave = 'b'), 'Proveedor de prueba DM1 en B');
  begin
    insert into public.supplier (account_id, name) values ((select v::uuid from _s where clave = 'a'), 'Otro de prueba DM1 en A');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'PRUEBA DM1 · 3: con B abierta, escribe en A.'; end if;
end $$;
reset role;
do $$
declare d _visto; m jsonb := (select v::jsonb from _s where clave = 'mis_empresas');
begin
  select * into d from _visto where quien = 'dos' and momento = 'con_b';
  if d.cuentas <> 1 or d.prov_a <> 0 or d.prov_b = 0 then
    raise exception 'PRUEBA DM1 · 3: con B abierta ve % cuentas, % proveedores de A y % de B: tiene que ver solo B.', d.cuentas, d.prov_a, d.prov_b;
  end if;
  if jsonb_array_length(m) <> 2
     or (select count(*) from jsonb_array_elements(m) e where (e->>'activa')::boolean) <> 1
     or (select e->>'account_id' from jsonb_array_elements(m) e where (e->>'activa')::boolean) <> (select v from _s where clave = 'b') then
    raise exception 'PRUEBA DM1 · 3: mis_empresas no dice las dos con B abierta: %.', m;
  end if;
  raise notice '3 · con B abierta: % proveedores de B, 0 de A; escribe en B y no en A; mis_empresas, las dos con B abierta', d.prov_b;
end $$;

-- ── 4 · Lo que no es suyo ───────────────────────────────────────────────────
set local role authenticated;
do $$
declare ok boolean := false;
begin
  begin
    perform public.cambiar_empresa('00000000-0000-4000-8000-0000000000dd'::uuid);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'PRUEBA DM1 · 4: abre una cuenta de la que no es miembro.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int; ok boolean := false;
begin
  select count(*) into n from public.supplier where account_id = (select v::uuid from _s where clave = 'b');
  if n <> 0 then raise exception 'PRUEBA DM1 · 4: el encargado de A (no es miembro de B) ve % proveedores de B.', n; end if;
  begin
    perform public.cambiar_empresa((select v::uuid from _s where clave = 'b'));
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'PRUEBA DM1 · 4: el encargado de A abre B sin ser miembro.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice '4 · no se abre una cuenta ajena, y quien no es miembro de B no ve nada de B'; end $$;

-- ── 5 · Pasadas dos veces ───────────────────────────────────────────────────
-- La 1950 (solo añade) se pasa otra vez. La 1951 no: respalda antes de cambiar, y
-- una segunda pasada respaldaría la versión nueva; el historial no la reaplica.
\i supabase/migrations/20261030T1950_dm1_cuenta_activa.sql
do $$ begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('_cuenta_activa', 'mis_empresas', 'cambiar_empresa', 'current_user_account_ids', 'current_user_is_admin_of',
                       'current_user_is_admin_or_manager_of', 'current_user_is_employee', 'current_user_ve_persona',
                       'current_user_is_office', 'current_user_location_ids', 'current_employee_and_account')) <> 11 then
    raise exception 'PRUEBA DM1 · 5: hay más de una firma de alguna función.';
  end if;
  raise notice '5 · pasada dos veces: una sola firma de cada función';
end $$;

-- ── 6 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261030T1951_dm1_permisos_de_la_activa.down.sql
\i supabase/vuelta-atras/20261030T1950_dm1_cuenta_activa.down.sql
do $$
declare v_mal text;
begin
  select string_agg(split_part(s.clave, ':', 2), ', ') into v_mal from _s s
   where s.clave like 'huella:%' and md5(pg_get_functiondef(to_regprocedure(split_part(s.clave, ':', 2)))) is distinct from s.v;
  if v_mal is not null then raise exception 'PRUEBA DM1 · 6: la vuelta atrás no deja como estaban: %.', v_mal; end if;
  if to_regclass('public.user_active_account') is not null or to_regprocedure('public._cuenta_activa()') is not null then
    raise exception 'PRUEBA DM1 · 6: la vuelta atrás deja la tabla o la función de la cuenta abierta.';
  end if;
  raise notice '6 · la vuelta atrás: las ocho funciones byte a byte, sin la tabla ni las funciones nuevas';
end $$;

rollback;
