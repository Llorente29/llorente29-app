-- supabase/staging/sql/20261109_gd_ingresos_gocardless_prueba.sql
--
-- SOLO STAGING. La 1707 del GD (el ingreso de cada liquidación de GoCardless
-- en el banco de la demo), por sus caminos, sobre la «Gestoría Demo» de staging
-- (la 0110, sin administrador), con liquidaciones inventadas:
--   1. Sin administrador, no apunta nada y lo dice.
--   2. Con administrador (y su contabilidad, la 1300): de cuatro liquidaciones
--      (pagada y llegada; pagada que llega dentro de 3 días; pendiente; en
--      dólares) entra UNA, en el banco por defecto de la sociedad, con su día
--      de llegada, el neto y «TRANSFER INMEDIATA GOCARDLESS SAS».
--   3. Repetir no duplica nada; una liquidación nueva entra sola por el bucle
--      de las demos (el del cron), y solo ella.
--   4. Bancos la casa: la liquidación sale en los pendientes de GoCardless y
--      conta_abono_gocardless_casar la casa con su movimiento (banco contra la
--      57200002 por el neto).
--   5. En una cuenta que no es demo, no (42501).
--   6. La vuelta atrás quita el cron y las funciones.
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la siembra la llama la plataforma; dentro actúa como el
-- administrador de la cuenta, y eso es lo que se prueba.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T1300_gd_contabilidad_demo.sql
\i supabase/migrations/20261109T1530_gd_banco_demo.sql
\i supabase/migrations/20261109T1707_gd_ingresos_gocardless.sql

create temp table _p (que text, id uuid) on commit drop;

-- 1 · Sin administrador.
insert into public.conta_gc_payout (company_id, gc_id, account_id, estado, llegada, importe, comision, moneda, referencia) values
  ('de000000-0000-4000-8000-0000000000a9', 'PO-PRUEBA-1', 'de000000-0000-4000-8000-0000000000a0', 'paid', (now() at time zone 'Europe/Madrid')::date - 2, 123.45, 0.95, 'EUR', 'PRUEBA-GD-1'),
  ('de000000-0000-4000-8000-0000000000a9', 'PO-PRUEBA-2', 'de000000-0000-4000-8000-0000000000a0', 'paid', (now() at time zone 'Europe/Madrid')::date + 3, 50.00, 0.40, 'EUR', 'PRUEBA-GD-2'),
  ('de000000-0000-4000-8000-0000000000a9', 'PO-PRUEBA-3', 'de000000-0000-4000-8000-0000000000a0', 'pending', (now() at time zone 'Europe/Madrid')::date - 1, 60.00, 0.40, 'EUR', 'PRUEBA-GD-3'),
  ('de000000-0000-4000-8000-0000000000a9', 'PO-PRUEBA-4', 'de000000-0000-4000-8000-0000000000a0', 'paid', (now() at time zone 'Europe/Madrid')::date - 1, 70.00, 0.40, 'USD', 'PRUEBA-GD-4');

do $$ declare v jsonb; begin
  v := public.demo_gestoria_ingresos_gocardless('de000000-0000-4000-8000-0000000000a0');
  if v->>'frase' not like '%no tiene administrador%' then raise exception 'GD · 1: sin administrador tenía que no apuntar nada: %', v->>'frase'; end if;
  raise notice 'GD · 1: sin administrador, no apunta nada y lo dice. OK';
end $$;

-- Un administrador (un usuario de prueba de staging), y la contabilidad de la demo.
insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
select id, 'de000000-0000-4000-8000-0000000000a0', 'admin', true, 'Administración GD (prueba)', now(), now() from auth.users where email = 'p01.laura@p01-prueba.test';
do $$ begin
  if not exists (select 1 from public.user_profiles where account_id = 'de000000-0000-4000-8000-0000000000a0' and role = 'admin' and active) then
    raise exception 'PRUEBA GD: no está el usuario de prueba p01.laura en staging.';
  end if;
  perform public.demo_gestoria_contabilidad_sembrar('de000000-0000-4000-8000-0000000000a0');
end $$;

-- 2 · Entra una, la que ha llegado.
do $$
declare v jsonb; b uuid; m public.bank_movement; n int;
begin
  select id into b from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000a9' and kind = 'bank' and is_default;
  v := public.demo_gestoria_ingresos_gocardless('de000000-0000-4000-8000-0000000000a0');
  if (v->>'nuevos')::int <> 1 then raise exception 'GD · 2: tenía que entrar 1 ingreso y entran %: %', v->>'nuevos', v; end if;
  select count(*) into n from public.bank_movement where company_id = 'de000000-0000-4000-8000-0000000000a9';
  if n <> 1 then raise exception 'GD · 2: hay % movimientos en la sociedad y tenía que haber 1.', n; end if;
  select * into m from public.bank_movement where company_id = 'de000000-0000-4000-8000-0000000000a9';
  if m.treasury_account_id <> b or m.amount <> 123.45 or m.op_date <> (now() at time zone 'Europe/Madrid')::date - 2
     or m.bank_concept <> 'TRANSFER INMEDIATA GOCARDLESS SAS' or m.status <> 'pendiente' or m.account_id <> 'de000000-0000-4000-8000-0000000000a0' then
    raise exception 'GD · 2: el movimiento no es el de la liquidación: % % % % %', m.treasury_account_id, m.amount, m.op_date, m.bank_concept, m.status;
  end if;
  if public._bank_cuenta_572(b) <> '57200000' then raise exception 'GD · 2: el banco no es la 57200000 (%).', public._bank_cuenta_572(b); end if;
  if exists (select 1 from public.bank_movement where company_id = 'de000000-0000-4000-8000-0000000000b9') then
    raise exception 'GD · 2: ha apuntado algo en el banco de la autónoma.';
  end if;
  insert into _p values ('mov1', m.id);
  raise notice 'GD · 2: de cuatro liquidaciones entra la llegada (123,45 € el %, en la 57200000). OK', m.op_date;
end $$;

-- 3 · Repetir no duplica; una nueva entra por el bucle de las demos.
do $$
declare v jsonb; n int;
begin
  v := public.demo_gestoria_ingresos_gocardless('de000000-0000-4000-8000-0000000000a0');
  if (v->>'nuevos')::int <> 0 or (v->>'ya_estaban')::int <> 1 then raise exception 'GD · 3: repetir tenía que no cambiar nada: %', v; end if;
  insert into public.conta_gc_payout (company_id, gc_id, account_id, estado, llegada, importe, comision, moneda, referencia) values
    ('de000000-0000-4000-8000-0000000000a9', 'PO-PRUEBA-5', 'de000000-0000-4000-8000-0000000000a0', 'paid', (now() at time zone 'Europe/Madrid')::date, 88.10, 0.60, 'EUR', 'PRUEBA-GD-5');
  v := public.demo_gestoria_ingresos_gocardless_demos();
  if not exists (select 1 from jsonb_array_elements(v) e where e->>'cuenta' = 'de000000-0000-4000-8000-0000000000a0' and (e->>'nuevos')::int = 1) then
    raise exception 'GD · 3: el bucle de las demos tenía que apuntar 1 nuevo en la demo: %', v;
  end if;
  if exists (select 1 from jsonb_array_elements(v) e join public.accounts a on a.id = (e->>'cuenta')::uuid where a.is_demo is not true) then
    raise exception 'GD · 3: el bucle ha tocado una cuenta que no es demo: %', v;
  end if;
  select count(*) into n from public.bank_movement where company_id = 'de000000-0000-4000-8000-0000000000a9';
  if n <> 2 then raise exception 'GD · 3: hay % movimientos y tenía que haber 2.', n; end if;
  raise notice 'GD · 3: repetir no duplica, y la nueva entra sola por el bucle de las demos. OK';
end $$;

-- 4 · Bancos la casa (como el administrador).
do $$
declare v jsonb; adm uuid; mov uuid := (select id from _p where que = 'mov1');
begin
  select user_id into adm from public.user_profiles where account_id = 'de000000-0000-4000-8000-0000000000a0' and role = 'admin' and active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', adm::text || ':de000000-0000-4000-8000-0000000000a0', true);
  v := public.conta_abonos_gocardless_pendientes('de000000-0000-4000-8000-0000000000a9');
  if not exists (select 1 from jsonb_array_elements(v) e where e->>'id' = 'PO-PRUEBA-1' and (e->>'neto')::numeric = 123.45) then
    raise exception 'GD · 4: la liquidación no sale en los pendientes de GoCardless: %', v;
  end if;
  v := public.conta_abono_gocardless_casar(mov, 'PO-PRUEBA-1', 'seguro', 'Prueba GD: neto exacto, mismo día y el banco nombra a GoCardless.', 'folvy');
  if v->>'casado' is null then raise exception 'GD · 4: no se ha casado: %', v; end if;
  if (select match_id from public.conta_gc_payout where company_id = 'de000000-0000-4000-8000-0000000000a9' and gc_id = 'PO-PRUEBA-1') is null then
    raise exception 'GD · 4: la liquidación no apunta su casado.';
  end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('folvy.cuenta_activa', '', true);
  raise notice 'GD · 4: Bancos la casa: %', v->>'frase';
end $$;

-- 5 · En una cuenta que no es demo, no.
do $$ begin
  begin
    perform public.demo_gestoria_ingresos_gocardless('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'GD · 5: en una cuenta que no es demo tenía que negarse.';
  exception when insufficient_privilege then raise notice 'GD · 5: en una cuenta que no es demo, no. OK';
  end;
end $$;

-- 6 · La vuelta atrás.
\i supabase/vuelta-atras/20261109T1707_gd_ingresos_gocardless.down.sql
do $$ declare v_cron boolean := false; begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select exists (select 1 from cron.job where jobname = ''gd-ingresos-gocardless'')' into v_cron;
  end if;
  if to_regprocedure('public.demo_gestoria_ingresos_gocardless(uuid)') is not null or to_regprocedure('public.demo_gestoria_ingresos_gocardless_demos()') is not null then
    raise exception 'GD · 6: las funciones siguen.';
  end if;
  if v_cron then
    raise exception 'GD · 6: el cron sigue.';
  end if;
  raise notice 'GD · 6: la vuelta atrás quita el cron y las funciones. OK';
end $$;

rollback;
