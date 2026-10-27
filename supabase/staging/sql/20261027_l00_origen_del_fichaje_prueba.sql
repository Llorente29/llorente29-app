-- supabase/staging/sql/20261027_l00_origen_del_fichaje_prueba.sql
--
-- SOLO STAGING. Prueba de la 1112 (L00 · el origen del fichaje), con \i dentro
-- de la transacción y ROLLBACK: staging no cambia. Toca clock_entries y
-- tg_clock_entry_debounce, en un local y una persona inventados de la cuenta A.
--
-- Por los caminos (regla 10), no por el texto: se FICHA de verdad.
--   0. Lo de antes: tg_clock_entry_debounce con el md5 de producción, y el CHECK
--      rechaza 'tablet'.
--   1. Con la 1112, COMO USUARIO de la cuenta (el camino de la app: RLS y
--      disparadores): se ficha entrada desde el móvil y salida desde la tablet;
--      el origen queda guardado tal cual.
--   2. El freno del doble toque (< 60 s) para al móvil, a la tablet y a lo
--      antiguo ('kiosko'); lo puesto a mano ('manual') sigue pasando, como hoy.
--   3. Un origen que no existe sigue rechazado por el CHECK.
--   4. Una sola firma de tg_clock_entry_debounce (regla 2).
--   5. La vuelta atrás: con un fichaje 'tablet', para y no quita nada; sin él,
--      deja la función con su md5 de producción y el CHECK sin 'tablet'.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L00 ORIGEN: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _s (clave text primary key, v text) on commit drop;
grant select on _s to authenticated;
insert into _s values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('md5_debounce', '72f6807d7e58695adeb9a4132f84d5f3'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('t0', (now() - interval '3 hours')::text);

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
do $$
declare v_h text;
begin
  select md5(prosrc) into v_h from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_clock_entry_debounce';
  if v_h is distinct from (select v from _s where clave = 'md5_debounce') then
    raise exception 'PRUEBA L00 ORIGEN · 0: tg_clock_entry_debounce no es la de producción (md5 %).', coalesce(v_h, 'no está');
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'clock_entries_source_check' and conrelid = 'public.clock_entries'::regclass)) ~ 'tablet' then
    raise exception 'PRUEBA L00 ORIGEN · 0: el CHECK ya admitía tablet antes de la 1112.';
  end if;
  raise notice '0 · lo de antes: el freno con el md5 de producción, y el CHECK sin tablet';
end $$;

-- La persona y el local, inventados.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l uuid; e uuid;
begin
  insert into public.locations (name, account_id) values ('Local de prueba L00', a) returning id into l;
  insert into public.employees (name, location_id, account_id) values ('Persona de prueba L00', l, a) returning id into e;
  insert into _s values ('local', l::text), ('persona', e::text);
end $$;

-- ── 1 · Con la 1112, se ficha como usuario y el origen queda guardado ──────
\i supabase/migrations/20261027T1112_l00_origen_del_fichaje.sql

select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _s where clave = 'persona'); l uuid := (select v::uuid from _s where clave = 'local');
        t0 timestamptz := (select v::timestamptz from _s where clave = 't0');
begin
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock)
  values (e, 'entrada', t0, t0, 'movil', l);
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock)
  values (e, 'salida', t0 + interval '2 hours', t0 + interval '2 hours', 'tablet', l);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare e uuid := (select v::uuid from _s where clave = 'persona'); v_origenes text;
begin
  select string_agg(type || '=' || source, ', ' order by real_datetime) into v_origenes from public.clock_entries where employee_id = e;
  if v_origenes is distinct from 'entrada=movil, salida=tablet' then
    raise exception 'PRUEBA L00 ORIGEN · 1: el origen no queda como se fichó: %.', coalesce(v_origenes, 'nada');
  end if;
  raise notice '1 · fichado como usuario: %', v_origenes;
end $$;

-- ── 2 · El freno del doble toque ─────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _s where clave = 'persona'); l uuid := (select v::uuid from _s where clave = 'local');
        t timestamptz := (select v::timestamptz from _s where clave = 't0') + interval '2 hours 30 seconds';
        o text; v_frenado boolean;
begin
  -- 30 s después de la salida de la tablet, una entrada desde cada origen.
  foreach o in array array['movil', 'tablet', 'kiosko'] loop
    v_frenado := false;
    begin
      insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock)
      values (e, 'entrada', t, t, o, l);
    exception when others then
      if sqlerrm like 'DOBLE_FICHAJE_MUY_RAPIDO%' then v_frenado := true; else raise; end if;
    end;
    if not v_frenado then raise exception 'PRUEBA L00 ORIGEN · 2: una entrada % a 30 s no la ha frenado el doble toque.', o; end if;
  end loop;
  -- Lo puesto a mano no pasa por el freno (lo corrige un encargado): sigue entrando.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock)
  values (e, 'entrada', t, t, 'manual', l);
  raise notice '2 · a 30 s: movil, tablet y kiosko frenados; manual entra, como hoy';
end $$;

-- ── 3 · Un origen que no existe ─────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _s where clave = 'persona'); v_ok boolean := false;
begin
  begin
    insert into public.clock_entries (employee_id, type, datetime, real_datetime, source)
    values (e, 'salida', now(), now(), 'telefono');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA L00 ORIGEN · 3: el CHECK ha dejado pasar un origen que no existe.'; end if;
  raise notice '3 · un origen que no existe: rechazado por el CHECK';
end $$;

-- ── 4 · Una sola firma ──────────────────────────────────────────────────────
do $$ begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_clock_entry_debounce') <> 1 then
    raise exception 'PRUEBA L00 ORIGEN · 4: tg_clock_entry_debounce tiene sobrecargas.';
  end if;
  raise notice '4 · una sola firma de tg_clock_entry_debounce';
end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
-- Con un fichaje 'tablet' (el del paso 1), para y no quita nada.
savepoint antes_de_frenar;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261027T1112_l00_origen_del_fichaje.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint antes_de_frenar;
select (:'LAST_ERROR_MESSAGE' = 'L00 · vuelta atrás: hay fichajes con origen tablet. No se quita del CHECK.') as freno_l00_ok \gset
\echo 'El freno de la vuelta atrás dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_l00_ok
\else
  do $$ begin raise exception 'PRUEBA L00 ORIGEN · 5: con un fichaje tablet, la vuelta atrás NO ha parado.'; end $$;
\endif
do $$ begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'clock_entries_source_check' and conrelid = 'public.clock_entries'::regclass)) !~ 'tablet' then
    raise exception 'PRUEBA L00 ORIGEN · 5: la vuelta atrás ha parado, pero ha quitado tablet del CHECK.';
  end if;
end $$;

-- Sin fichajes 'tablet' (se quitan los de la prueba), deja lo de producción.
delete from public.clock_entries where employee_id = (select v::uuid from _s where clave = 'persona');
\i supabase/vuelta-atras/20261027T1112_l00_origen_del_fichaje.down.sql

do $$
declare v_h text;
begin
  select md5(prosrc) into v_h from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_clock_entry_debounce';
  if v_h is distinct from (select v from _s where clave = 'md5_debounce') then
    raise exception 'PRUEBA L00 ORIGEN · 5: la vuelta atrás no deja el freno de producción (md5 %).', v_h;
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'clock_entries_source_check' and conrelid = 'public.clock_entries'::regclass)) ~ 'tablet' then
    raise exception 'PRUEBA L00 ORIGEN · 5: la vuelta atrás deja tablet en el CHECK.';
  end if;
  raise notice '5 · la vuelta atrás: para con un fichaje tablet; sin él, el freno con el md5 de producción y el CHECK sin tablet';
end $$;

rollback;
