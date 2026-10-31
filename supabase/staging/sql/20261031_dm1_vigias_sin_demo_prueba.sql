-- supabase/staging/sql/20261031_dm1_vigias_sin_demo_prueba.sql
--
-- SOLO STAGING. Prueba de la 1912 (DM1 · PR 2a: una demo no cuenta en los
-- vigías), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Nombra lo que cambia: public.codigo_plataforma_watchdog,
-- public.kds_device_stale_bundle_check, public.sales_unmapped_watchdog,
-- public.modifier_incomplete_impact_watchdog, public.modifier_zero_cost_watchdog
-- y public._generate_daily_count_core.
--
-- Por sus caminos, no por su texto: dos vigías se ejecutan de verdad con datos
-- de B y de A (ventas que entran sin código de pedido; un modificador que cobra
-- y vale 0 EUR). Las otras cuatro no se pueden disparar sin montar medio
-- servicio (un bundle en el almacén, una ficha a medias que la tabla prohíbe,
-- 10 platos de carta, un autocierre que falle): de ésas se comprueba que la
-- única diferencia con la de antes es la puerta, y su vuelta atrás.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás. Y ROJO A PROPÓSITO:
--       con los vigías de antes, B marcada de demo SÍ avisa (código perdido) y
--       SÍ siembra su marca de modificadores a 0 EUR.
--   1 · recién aplicada (con la 0907 y la 1713 delante, si faltan).
--   2 · con B de demo: ni avisa ni siembra; A, con los mismos datos, sí.
--   3 · las seis llevan la puerta; la vuelta atrás las deja byte a byte.

-- sin usuario: los seis los llaman las tareas programadas (y el
-- autoinventario, _generate_daily_count_core, la función que lo envuelve);
-- ninguna pantalla ni persona. Se prueban como los llaman ellas.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 vigías: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _s (clave text primary key, v text) on commit drop;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'), ('b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('marca_a', 'e0200000-0000-4000-8000-00000000a0b1'), ('marca_b', 'e0200000-0000-4000-8000-00000000b0b2');

create temp table _firma (f text primary key, huella text) on commit drop;
insert into _firma values
  ('public.codigo_plataforma_watchdog(integer,numeric,interval)', '97c8bbbd42511394efa7bd918d042a22'),
  ('public.kds_device_stale_bundle_check()', '1d3e5faaacc2daffaac86d0ad32a2c93'),
  ('public.sales_unmapped_watchdog(integer,integer)', 'b4d0108303df9c1f5ff5889392cdd13a'),
  ('public.modifier_incomplete_impact_watchdog(interval)', '25c481f76d3d117ea7de939287ad0fd8'),
  ('public.modifier_zero_cost_watchdog(interval,interval)', '12b36c4157797a06219378fe9c72d4f7'),
  ('public._generate_daily_count_core(uuid,uuid,uuid[],integer,numeric,boolean)', '73a3fd629d6e25a33b754cee8fc116e4');

-- Los datos de A y de B, iguales: 20 ventas con código hace dos días (la
-- fuente es «de las que traen código») y 10 sin código en la última hora; un
-- grupo de modificadores con una opción que cobra 1 EUR y no tiene impacto.
-- Las ventas van canceladas y de «import»: los vigías no miran ni el estado
-- ni el canal, y así ningún disparador de cocina ni de reparto se mueve.
create temp table _datos (cuenta uuid, marca uuid) on commit drop;
insert into _datos select c.v::uuid, (select m.v::uuid from _s m where m.clave = 'marca_' || c.clave) from _s c where c.clave in ('a', 'b');
insert into public.sale (account_id, sold_at, source, status, platform_order_code)
select d.cuenta, now() - interval '2 days' + make_interval(mins => g), 'import', 'cancelled', 'DM1-' || g
  from _datos d, generate_series(1, 20) g;
insert into public.sale (account_id, sold_at, source, status, platform_order_code)
select d.cuenta, now() - make_interval(mins => g), 'import', 'cancelled', null
  from _datos d, generate_series(1, 10) g;
insert into public.modifier_group (account_id, brand_id, name)
select d.cuenta, d.marca, 'DM1 prueba' from _datos d;
insert into public.modifier_option (account_id, modifier_group_id, name, is_active, price_impact)
select g.account_id, g.id, 'DM1 prueba · cobra y no cuesta', true, 1 from public.modifier_group g where g.name = 'DM1 prueba';
delete from public.modifier_zero_cost_baseline where account_id in (select cuenta from _datos);

-- Lo que ha hecho cada vigía con una cuenta: si ha avisado del código perdido
-- y si ha sembrado su marca de modificadores.
create function pg_temp.avisa(p uuid) returns boolean language sql as $f$
  select exists (select 1 from public.system_alert_queue where debounce_kind like 'codigo_plataforma_' || p::text || '_import_%')
$f$;
create function pg_temp.siembra(p uuid) returns boolean language sql as $f$
  select exists (select 1 from public.modifier_zero_cost_baseline where account_id = p)
$f$;
create function pg_temp.limpiar() returns void language sql as $f$
  delete from public.system_alert_queue where debounce_kind like any (select 'codigo_plataforma_' || cuenta::text || '_import_%' from _datos);
  delete from public.db_health_alert_log where kind like any (select 'codigo_plataforma_' || cuenta::text || '_import_%' from _datos);
  delete from public.modifier_zero_cost_baseline where account_id in (select cuenta from _datos);
$f$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261031T1912_dm1_vigias_sin_demo') as dm1_vigias_aplicada \gset
\if :dm1_vigias_aplicada
\i supabase/vuelta-atras/20261031T1912_dm1_vigias_sin_demo.down.sql
\endif
select to_regprocedure('public.cuenta_puede_salir(uuid)') is not null as dm1_puerta_aplicada \gset
\if :dm1_puerta_aplicada
\else
\i supabase/migrations/20261031T0907_dm1_marca_de_demo.sql
\endif
select exists (select 1 from public.funcion_respaldo where migracion = '20261031T1713_dm1_avisos_sin_demo') as dm1_avisos_aplicada \gset
\if :dm1_avisos_aplicada
\else
\i supabase/migrations/20261031T1713_dm1_avisos_sin_demo.sql
\endif
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'b');
select pg_temp.limpiar();
select public.codigo_plataforma_watchdog();
select public.modifier_zero_cost_watchdog();
do $$
declare v_b uuid := (select v::uuid from _s where clave = 'b');
begin
  if not pg_temp.avisa(v_b) then raise exception 'PRUEBA DM1 vigías · 0: con el vigía de antes, la demo B no avisa del código perdido: la prueba no mediría nada.'; end if;
  if not pg_temp.siembra(v_b) then raise exception 'PRUEBA DM1 vigías · 0: con el vigía de antes, la demo B no siembra su marca: la prueba no mediría nada.'; end if;
  raise notice 'DM1 vigías · 0 (rojo a propósito): con los vigías de antes, la demo B avisa del código perdido y siembra su marca de modificadores.';
end $$;
select pg_temp.limpiar();
update public.accounts set is_demo = null where id = (select v::uuid from _s where clave = 'b');

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261031T1912_dm1_vigias_sin_demo.sql

-- ── 2 · B de demo: ni avisa ni siembra; A, sí ───────────────────────────────
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'b');
select public.codigo_plataforma_watchdog();
select public.modifier_zero_cost_watchdog();
do $$
declare v_a uuid := (select v::uuid from _s where clave = 'a'); v_b uuid := (select v::uuid from _s where clave = 'b');
begin
  if pg_temp.avisa(v_b) then raise exception 'PRUEBA DM1 vigías · 2: la demo B ha avisado del código perdido.'; end if;
  if pg_temp.siembra(v_b) then raise exception 'PRUEBA DM1 vigías · 2: la demo B ha sembrado su marca de modificadores.'; end if;
  if not pg_temp.avisa(v_a) then raise exception 'PRUEBA DM1 vigías · 2: A (no es demo), con los mismos datos, no ha avisado del código perdido.'; end if;
  if not pg_temp.siembra(v_a) then raise exception 'PRUEBA DM1 vigías · 2: A (no es demo), con los mismos datos, no ha sembrado su marca.'; end if;
  raise notice 'DM1 vigías · 2: la demo B ni avisa ni siembra; A, con los mismos datos, sí.';
end $$;
update public.accounts set is_demo = null where id = (select v::uuid from _s where clave = 'b');

-- ── 3 · Las seis llevan la puerta; la vuelta atrás, byte a byte ─────────────
do $$
declare r record;
begin
  for r in select f from _firma loop
    if pg_get_functiondef(r.f::regprocedure) not like '%public.cuenta_puede_salir(%' then
      raise exception 'PRUEBA DM1 vigías · 3: % no lleva la puerta.', r.f;
    end if;
  end loop;
  raise notice 'DM1 vigías · 3: las seis llevan la puerta.';
end $$;
\i supabase/vuelta-atras/20261031T1912_dm1_vigias_sin_demo.down.sql
do $$
declare r record;
begin
  for r in select f, huella from _firma loop
    if md5(pg_get_functiondef(r.f::regprocedure)) <> r.huella then
      raise exception 'PRUEBA DM1 vigías · 3: la vuelta atrás no deja % como estaba.', r.f;
    end if;
  end loop;
  raise notice 'DM1 vigías · 3: la vuelta atrás deja las seis byte a byte como estaban.';
end $$;

rollback;
