-- supabase/staging/sql/20261118_r03_vuelta_atras_prueba.sql
--
-- SOLO STAGING. Las tres vueltas atrás del R03 (0320, 0310 y 0300), los MISMOS
-- ficheros que lista supabase/produccion/vuelta-atras.txt, ejecutadas de verdad
-- (\i) y en su orden sobre staging con el R03 puesto, con datos de la cuenta A
-- (los pedidos inventados de la semilla del R03). Todo en una transacción que
-- acaba en ROLLBACK: staging no cambia.
-- sin usuario: la tanda y su vuelta atrás las aplica el workflow como postgres, y así se prueban aquí.
--
--   1. 0320: un pedido al que rellenó el código (R03A) lo vuelve a null; un Uber
--      que recolocó (R03T) vuelve al tipo de reparto que tenía; fuera
--      r03_entrega_relleno.
--   2. 0310: fuera las tres columnas, los dos disparadores y
--      decidir_quien_reparte; los feeds y el ticket ya no nombran el código.
--   3. 0300: sin direcciones completadas (las de la cuenta A, de las e2e, se
--      quitan dentro de la transacción), resolve_dispatch vuelve byte a byte a producción (prosrc md5
--      9d645a5186cb45215b26f00a2cc7d8cb, medido el 17/10) y fuera las cinco
--      columnas y las tres funciones nuevas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R03 vuelta atrás: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.r03_entrega_relleno') is null
     or to_regprocedure('public.fijar_direccion_entrega(uuid,text,text)') is null then
    raise exception 'PRUEBA R03 vuelta atrás: el R03 no está puesto en staging (0300, 0310 y 0320). No hay nada que deshacer.';
  end if;
  if (select count(*) from public.sale where id in ('e0300000-0000-4000-8000-0000000000a1', 'e0300000-0000-4000-8000-0000000000a8')
        and account_id = 'c01a0000-0000-4000-8000-00000000000a') <> 2 then
    raise exception 'PRUEBA R03 vuelta atrás: faltan R03A o R03T de la semilla del R03 (seed_r02_e2e.sql).';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo que habría dejado la 0320 en dos pedidos (inventados, de la cuenta A).
select set_config('folvy.reparto_tal_cual', 'on', true);
delete from public.r03_entrega_relleno where sale_id in ('e0300000-0000-4000-8000-0000000000a1', 'e0300000-0000-4000-8000-0000000000a8');
update public.sale set customer_phone_code = '99999999' where id = 'e0300000-0000-4000-8000-0000000000a1';
update public.sale set service_type = 'own_delivery', delivery_by_reason = 'prueba' where id = 'e0300000-0000-4000-8000-0000000000a8';
insert into public.r03_entrega_relleno (sale_id, account_id, service_type_antes) values
  ('e0300000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-00000000000a', null),
  ('e0300000-0000-4000-8000-0000000000a8', 'c01a0000-0000-4000-8000-00000000000a', 'platform_delivery');
select set_config('folvy.reparto_tal_cual', '', true);

-- 1 · La 0320.
\i supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql
do $$
declare r record;
begin
  if to_regclass('public.r03_entrega_relleno') is not null then raise exception 'R03 vuelta atrás 1a: sigue r03_entrega_relleno.'; end if;
  select customer_phone_code into r from public.sale where id = 'e0300000-0000-4000-8000-0000000000a1';
  if r.customer_phone_code is not null then raise exception 'R03 vuelta atrás 1b: R03A sigue con el código (%).', r.customer_phone_code; end if;
  select service_type, delivery_by_reason into r from public.sale where id = 'e0300000-0000-4000-8000-0000000000a8';
  if r.service_type is distinct from 'platform_delivery' or r.delivery_by_reason is not null then
    raise exception 'R03 vuelta atrás 1c: R03T no ha vuelto a como estaba: %', r;
  end if;
  raise notice 'R03 vuelta atrás 1: la 0320 devuelve el código a null, el Uber recolocado a su tipo de reparto y quita su tabla.';
end $$;

-- 2 · La 0310.
\i supabase/vuelta-atras/20261118T0310_r03_ticket_codigo_quien_reparte.down.sql
do $$
declare f text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale'
              and column_name in ('customer_phone_code', 'delivery_instructions', 'order_customer_note')) then
    raise exception 'R03 vuelta atrás 2a: siguen columnas de la 0310.';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.sale'::regclass and not tgisinternal
              and tgname in ('trg_sale_entrega_desde_raw', 'trg_sale_tipo_uber_quien_reparte')) then
    raise exception 'R03 vuelta atrás 2b: siguen los disparadores de la 0310.';
  end if;
  if exists (select 1 from pg_proc where proname = 'decidir_quien_reparte' and pronamespace = 'public'::regnamespace) then
    raise exception 'R03 vuelta atrás 2c: sigue decidir_quien_reparte.';
  end if;
  foreach f in array array['public.orders_feed(uuid)', 'public.orders_feed_by_token(text)', 'public.order_for_print(text,uuid)'] loop
    if position('customer_phone_code' in pg_get_functiondef(f::regprocedure)) > 0 then
      raise exception 'R03 vuelta atrás 2d: % sigue nombrando el código.', f;
    end if;
  end loop;
  raise notice 'R03 vuelta atrás 2: la 0310 quita columnas, disparadores y decidir_quien_reparte; los feeds y el ticket vuelven.';
end $$;

-- 3 · La 0300. Su guarda (para si hay direcciones completadas) no se puede
-- ver parar aquí: el workflow corre con ON_ERROR_STOP y un fichero que para se
-- lleva la prueba entera. La comprueba tests/conta/produccion/analizar.test.ts
-- (la .down.sql de la 0300 lleva su «raise exception»).
-- Sin direcciones completadas (las de la cuenta A son de las e2e: dentro de esta transacción).
update public.sale set delivery_address_fixed = null, delivery_address_fixed_at = null, delivery_address_fixed_by = null
 where account_id = 'c01a0000-0000-4000-8000-00000000000a' and delivery_address_fixed is not null;
do $$ begin
  if exists (select 1 from public.sale where delivery_address_fixed is not null) then
    raise exception 'R03 vuelta atrás 3b: quedan direcciones completadas fuera de la cuenta A de prueba.';
  end if;
end $$;
\i supabase/vuelta-atras/20261118T0300_r03_direccion_incompleta.down.sql
do $$
declare h text;
begin
  select md5(prosrc) into h from pg_proc where oid = to_regprocedure('public.resolve_dispatch(uuid)');
  if h is distinct from '9d645a5186cb45215b26f00a2cc7d8cb' then
    raise exception 'R03 vuelta atrás 3c: resolve_dispatch no vuelve a la de producción (prosrc md5 %).', h;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale'
              and column_name in ('delivery_address_fixed', 'delivery_address_fixed_at', 'delivery_address_fixed_by',
                                  'delivery_address_origin', 'delivery_by_reason')) then
    raise exception 'R03 vuelta atrás 3d: siguen columnas de la 0300.';
  end if;
  if to_regprocedure('public.fijar_direccion_entrega(uuid,text,text)') is not null
     or to_regprocedure('public.pedidos_sin_direccion(uuid,text)') is not null
     or to_regprocedure('public.sale_coordenadas_de_entrega_by_token(text,uuid)') is not null then
    raise exception 'R03 vuelta atrás 3e: siguen funciones de la 0300.';
  end if;
  raise notice 'R03 vuelta atrás 3: resolve_dispatch como en producción (9d645a51…), fuera columnas y funciones.';
end $$;

\echo '>>> Las tres vueltas atrás del R03, de verdad y en orden, en verde. ROLLBACK: staging no cambia.'
rollback;
