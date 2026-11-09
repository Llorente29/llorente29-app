-- supabase/staging/sql/20261109_g05_t4_prueba.sql
--
-- SOLO STAGING. La 1344 de la T4 del G05 (lo que necesita el modelo de
-- factura «Sumied»), en la cuenta A de pruebas, con ROLLBACK:
--   1. La 1344, dos veces: las columnas nuevas (conta_servicio.incluye y la
--      cuenta del mandato) y la función del «Qué incluye».
--   2. «Qué incluye» de un servicio: ensaya por defecto (no escribe), guarda de
--      verdad con p_ensayo = false, se vacía con '' y no pasa de 200 letras.
--      Otra cuenta no puede. conta_pantalla_clientes lo devuelve.
--   3. La vuelta atrás: conta_pantalla_clientes, la de antes (de su respaldo,
--      con su huella) y sin las columnas; y otra vez la 1344.
-- Datos inventados (T11).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 T4: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _t (clave text primary key, v text) on commit drop;
grant select, insert on _t to authenticated;
insert into _t select 'antes', md5(prosrc) from pg_proc where oid = 'public.conta_pantalla_clientes(uuid)'::regprocedure;

-- 1 · La 1344, dos veces.
\i supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
\i supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_servicio' and column_name = 'incluye')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_mandato' and column_name = 'cuenta_final')
     or to_regprocedure('public.conta_tarifa_servicio_incluye(uuid,uuid,text,boolean)') is null then
    raise exception 'G05 T4 · 1: falta algo de la 1344.';
  end if;
  raise notice 'G05 T4 · 1: la 1344 carga, y dos veces. OK';
end $$;

-- 2 · Un servicio inventado de la empresa A y su «Qué incluye», como la persona administradora.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (v_acc, v_e, 'prueba_g05_t4', 'Servicio Prueba G05', 'fijo_mes');
  insert into _t values ('empresa', v_e::text), ('servicio', (select id::text from public.conta_servicio where company_id = v_e and clave = 'prueba_g05_t4'));
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _t where clave = 'empresa'); v_s uuid := (select v::uuid from _t where clave = 'servicio'); r jsonb;
begin
  r := public.conta_tarifa_servicio_incluye(v_e, v_s, 'Nóminas y seguros sociales');
  if (r->>'ensayo')::boolean is not true then raise exception 'G05 T4 · 2: sin decirlo, tenía que ensayar.'; end if;
  r := public.conta_tarifa_servicio_incluye(v_e, v_s, '  Nóminas y seguros sociales  ', false);
  if r->>'frase' <> 'Servicio Prueba G05 incluye «Nóminas y seguros sociales»: así sale en las facturas.' then raise exception 'G05 T4 · 2: la frase es «%».', r->>'frase'; end if;
  begin
    perform public.conta_tarifa_servicio_incluye(v_e, v_s, repeat('x', 201), false);
    raise exception 'G05 T4 · 2: han entrado 201 letras.';
  exception when invalid_parameter_value then null; end;
  if not exists (select 1 from jsonb_array_elements(public.conta_pantalla_clientes('c01a0000-0000-4000-8000-00000000000a')->'servicios') x
                  where x->>'id' = v_s::text and x->>'incluye' = 'Nóminas y seguros sociales') then
    raise exception 'G05 T4 · 2: la pantalla de clientes no devuelve el «Qué incluye» del servicio.';
  end if;
end $$;
reset role;
do $$ begin
  if (select incluye from public.conta_servicio where id = (select v::uuid from _t where clave = 'servicio')) is distinct from 'Nóminas y seguros sociales' then
    raise exception 'G05 T4 · 2: no se ha guardado (o el ensayo escribió).';
  end if;
end $$;
-- Vaciarlo: vuelve el de siempre (null).
set local role authenticated;
select public.conta_tarifa_servicio_incluye((select v::uuid from _t where clave = 'empresa'), (select v::uuid from _t where clave = 'servicio'), '', false);
reset role;
-- Otra cuenta (B) no puede.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_tarifa_servicio_incluye((select v::uuid from _t where clave = 'empresa'), (select v::uuid from _t where clave = 'servicio'), 'Intruso', false);
    raise exception 'G05 T4 · 2: otra cuenta ha cambiado el «Qué incluye».';
  exception when no_data_found then null; end;
end $$;
reset role;
do $$ begin
  if (select incluye from public.conta_servicio where id = (select v::uuid from _t where clave = 'servicio')) is not null then
    raise exception 'G05 T4 · 2: vaciarlo no lo ha vaciado.';
  end if;
  raise notice 'G05 T4 · 2: el «Qué incluye» ensaya, se guarda, se vacía, no pasa de 200 letras, otra cuenta no puede y la pantalla lo devuelve. OK';
end $$;

-- 3 · La vuelta atrás, y otra vez la 1344.
\i supabase/vuelta-atras/20261109T1344_g05_t4_incluye_y_cuenta.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_pantalla_clientes(uuid)'::regprocedure) <> (select v from _t where clave = 'antes')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('conta_servicio', 'conta_gc_mandato') and column_name in ('incluye', 'cuenta_final', 'cuenta_pais', 'banco'))
     or to_regprocedure('public.conta_tarifa_servicio_incluye(uuid,uuid,text,boolean)') is not null then
    raise exception 'G05 T4 · 3: la vuelta atrás no lo deja como estaba.';
  end if;
  raise notice 'G05 T4 · 3: la vuelta atrás lo deja como estaba. OK';
end $$;
\i supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
\echo 'G05 T4 · 3: y otra vez la 1344. OK'

rollback;
