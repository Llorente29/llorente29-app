-- supabase/staging/sql/20261031_dm1_avisos_sin_demo_prueba.sql
--
-- SOLO STAGING. Prueba de la 1713 (DM1 · PR 2a: una demo no cuenta en los
-- avisos del sistema), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. Nombra lo que cambia: public.encolar_alerta.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás. Y ROJO A PROPÓSITO:
--       con la encolar_alerta de antes, el aviso de una cuenta de demo SÍ se
--       encola. Si no pasara, la prueba no mediría nada.
--   1 · recién aplicada (con la 0907 delante, si falta).
--   2 · con B marcada de demo: su aviso no se encola, ni por su cuenta, ni por
--       su local, ni por su marca (devuelve NULL); el de A sí; uno sin cuenta
--       (como los de _queue_system_alert), también.
--   3 · la vuelta atrás: encolar_alerta, byte a byte como estaba (md5 36a9dfb7…).

-- sin usuario: encolar_alerta la llaman otras funciones de la base, las tareas
-- programadas y las funciones del servidor con la clave de servicio
-- (_shared/alerta.ts, social-publish, social-token-refresh); ninguna pantalla
-- ni persona. Se prueba como la llaman ellas.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 avisos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _s (clave text primary key, v text) on commit drop;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'), ('b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('local_b', 'c01b0000-0000-4000-8000-0000000000b2'), ('marca_b', 'e0200000-0000-4000-8000-00000000b0b2'),
  ('firma', 'public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)');

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261031T1713_dm1_avisos_sin_demo') as dm1_avisos_aplicada \gset
\if :dm1_avisos_aplicada
\i supabase/vuelta-atras/20261031T1713_dm1_avisos_sin_demo.down.sql
\endif
select to_regprocedure('public.cuenta_puede_salir(uuid)') is not null as dm1_puerta_aplicada \gset
\if :dm1_puerta_aplicada
\else
\i supabase/migrations/20261031T0907_dm1_marca_de_demo.sql
\endif
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'b');
do $$
declare v_id bigint;
begin
  v_id := public.encolar_alerta('dm1_prueba', 'Aviso de B', 'prueba', null, null, (select v::uuid from _s where clave = 'b'));
  if v_id is null then raise exception 'PRUEBA DM1 avisos · 0: con la función de antes, el aviso de una demo no se encola: la prueba no mediría nada.'; end if;
  delete from public.system_alert_queue where id = v_id;
  raise notice 'DM1 avisos · 0 (rojo a propósito): con la función de antes, el aviso de la demo B se encola.';
end $$;
update public.accounts set is_demo = null where id = (select v::uuid from _s where clave = 'b');

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261031T1713_dm1_avisos_sin_demo.sql

-- ── 2 · B de demo: sus avisos no se encolan; los demás, sí ──────────────────
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'b');
do $$
declare v_antes bigint := (select count(*) from public.system_alert_queue); v_id bigint;
begin
  if public.encolar_alerta('dm1_prueba', 'B por cuenta', 'p', null, null, (select v::uuid from _s where clave = 'b')) is not null
     or public.encolar_alerta('dm1_prueba', 'B por local', 'p', null, null, null, (select v::uuid from _s where clave = 'local_b')) is not null
     or public.encolar_alerta('dm1_prueba', 'B por marca', 'p', null, null, null, null, (select v::uuid from _s where clave = 'marca_b')) is not null then
    raise exception 'PRUEBA DM1 avisos · 2: un aviso de la demo B se ha encolado.';
  end if;
  if (select count(*) from public.system_alert_queue) <> v_antes then raise exception 'PRUEBA DM1 avisos · 2: la cola ha crecido con avisos de la demo.'; end if;
  v_id := public.encolar_alerta('dm1_prueba', 'A', 'p', null, null, (select v::uuid from _s where clave = 'a'));
  if v_id is null then raise exception 'PRUEBA DM1 avisos · 2: el aviso de A (no es demo) no se ha encolado.'; end if;
  v_id := public.encolar_alerta('dm1_prueba', 'Sin cuenta', 'p');
  if v_id is null then raise exception 'PRUEBA DM1 avisos · 2: un aviso sin cuenta no se ha encolado.'; end if;
  raise notice 'DM1 avisos · 2: la demo B no encola (ni por cuenta, ni por local, ni por marca); A y uno sin cuenta, sí.';
end $$;
update public.accounts set is_demo = null where id = (select v::uuid from _s where clave = 'b');

-- ── 3 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261031T1713_dm1_avisos_sin_demo.down.sql
do $$ begin
  if md5(pg_get_functiondef((select v from _s where clave = 'firma')::regprocedure)) <> '36a9dfb7e8c958467e85b8d2955331ca' then
    raise exception 'PRUEBA DM1 avisos · 3: la vuelta atrás no deja encolar_alerta como estaba.';
  end if;
  raise notice 'DM1 avisos · 3: la vuelta atrás deja encolar_alerta byte a byte como estaba.';
end $$;

rollback;
