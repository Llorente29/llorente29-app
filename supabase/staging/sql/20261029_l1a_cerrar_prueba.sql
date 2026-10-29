-- supabase/staging/sql/20261029_l1a_cerrar_prueba.sql
--
-- SOLO STAGING. Prueba de la 0730, la 0731, la 0732 y la 0733 (L1a · PR 2b,
-- «Cerrar»), con \i dentro de la transacción y ROLLBACK: staging no cambia.
--
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role), en
-- la cuenta A: el trabajador (enlazado dentro de la transacción a una ficha
-- limpia), el encargado y el administrador. Personas inventadas: «yo» y
-- «otro» en Norte Centro.
--
--   0 · lo de antes: si ya están aplicadas, sus vueltas atrás; las huellas de
--       export_gestoria_mensual y _informe_registro_jornada; y el mes pasado
--       de «yo», firmado, con tres marcas «kiosko»: una con GPS, otra con las
--       coordenadas ya borradas por la conservación y otra sin ubicación.
--   1 · clock_entries sin escritura directa: el trabajador y el administrador
--       no pueden ni insertar, ni cambiar, ni borrar; fichar() sigue fichando.
--   2 · export_gestoria_mensual: el administrador, con DNI; el encargado, no.
--   3 · las columnas privadas: nadie con sesión lee el salario, el DNI, el
--       nacimiento ni el coste de SS de employees; el resto, sí; la ficha se
--       sigue guardando con INSERT y UPDATE; el administrador los ve por
--       empleados_datos_privados.
--   4 · el origen: las dos con GPS pasan a «movil», la otra se queda en
--       «kiosko»; cada cambio deja su rastro con motivo y quién, sin pedir
--       conformidad y sin quitar valor a la firma; pasada dos veces, no cambia
--       nada más.
--   5 · el informe: la marca dice de qué origen venía; el cambio va como
--       «solo_origen».
--   6 · una sola firma de cada función.
--   7 · la vuelta atrás, en orden inverso: todo como estaba.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L1A2B: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261029T0733_l1a_informe_origen') as l1a2b_d_aplicada \gset
\if :l1a2b_d_aplicada
\i supabase/vuelta-atras/20261029T0733_l1a_informe_origen.down.sql
\endif
select exists (select 1 from public.clock_entry_audit where reason like 'Origen corregido:%(20261029T0732_l1a_origen_movil)%') as l1a2b_c_aplicada \gset
\if :l1a2b_c_aplicada
\i supabase/vuelta-atras/20261029T0732_l1a_origen_movil.down.sql
\endif
select not has_table_privilege('authenticated', 'public.employees', 'select') as l1a2b_b_aplicada \gset
\if :l1a2b_b_aplicada
\i supabase/vuelta-atras/20261029T0731_l1a_columnas_privadas.down.sql
\endif
select exists (select 1 from public.funcion_respaldo where migracion = '20261029T0730_l1a_cerrar_escritura_directa') as l1a2b_a_aplicada \gset
\if :l1a2b_a_aplicada
\i supabase/vuelta-atras/20261029T0730_l1a_cerrar_escritura_directa.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('centro', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7');
insert into _s
select 'huella:' || f, md5(pg_get_functiondef(to_regprocedure(f)))
  from (values ('public.export_gestoria_mensual(uuid,date,date)'),
               ('public._informe_registro_jornada(uuid,date,date,boolean,boolean)')) x(f);

do $$
declare v_falta text;
begin
  if (select count(*) from _s where clave like 'huella:%' and v is not null) <> 2 then
    raise exception 'PRUEBA L1A2B · 0: falta export_gestoria_mensual o _informe_registro_jornada.';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.clock_entries'::regclass) <> 4
     or not has_table_privilege('authenticated', 'public.clock_entries', 'insert')
     or not has_table_privilege('authenticated', 'public.employees', 'select')
     or to_regprocedure('public._solo_cambia_origen(jsonb,jsonb)') is not null then
    raise exception 'PRUEBA L1A2B · 0: lo de antes no es lo de producción (políticas, privilegios o _solo_cambia_origen).';
  end if;
  select string_agg(x.c, ', ') into v_falta
    from (values ('admin', 'admin'), ('encargado', 'manager'), ('trabajador', 'worker')) x(c, rol)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = 'cuenta') and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA L1A2B · faltan los usuarios de prueba de la cuenta A: %.', v_falta; end if;
  raise notice '0 · lo de antes: como en producción';
end $$;

-- Las personas y sus fichajes, inventados. El mes pasado de «yo»: tres
-- marcas «kiosko» (con GPS, con las coordenadas ya borradas y sin ubicación).
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
        centro uuid := (select v::uuid from _s where clave = 'centro');
        yo uuid; otro uuid;
        mp timestamptz := (date_trunc('month', now() at time zone 'Europe/Madrid') - interval '1 month' + interval '10 days 9 hours') at time zone 'Europe/Madrid';
begin
  update public.locations set lat = 40.4168, lng = -3.7038, clock_geofence_mode = 'warn', clock_radius_m = 200 where id = centro;
  insert into public.employees (name, location_id, account_id, "position", salary, dni, birth_date, contracted_hours_week)
  values ('Trabajador de la prueba L1a2b', centro, a, 'Cocina', 1000, '00000000T', '1990-01-01', 30) returning id into yo;
  insert into public.employees (name, location_id, account_id, "position", salary, dni)
  values ('Compañero de la prueba L1a2b', centro, a, 'Sala', 1999.99, '11111111H') returning id into otro;
  update public.user_profiles set employee_id = yo where user_id = (select v::uuid from _s where clave = 'trabajador') and account_id = a;
  insert into public.manager_locations (user_profile_id, location_id)
  select up.id, centro from public.user_profiles up
   where up.user_id = (select v::uuid from _s where clave = 'encargado') and up.account_id = a
     and not exists (select 1 from public.manager_locations ml where ml.user_profile_id = up.id and ml.location_id = centro);
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock, lat, lng, ubicacion_borrada_at, created_at)
  values (yo, 'entrada', mp, mp, 'kiosko', centro, 40.4169, -3.7038, null, mp),
         (yo, 'salida', mp + interval '8 hours', mp + interval '8 hours', 'kiosko', centro, null, null, now() - interval '1 day', mp + interval '8 hours'),
         (yo, 'entrada', mp + interval '1 day', mp + interval '1 day', 'kiosko', centro, null, null, null, mp + interval '1 day'),
         (yo, 'salida', mp + interval '1 day 6 hours', mp + interval '1 day 6 hours', 'movil', centro, 40.4169, -3.7038, null, mp + interval '1 day 6 hours'),
         (otro, 'entrada', now() - interval '4 days', now() - interval '4 days', 'movil', centro, null, null, null, now() - interval '4 days');
  insert into _s values ('yo', yo), ('otro', otro), ('mes_pasado', (date_trunc('month', mp at time zone 'Europe/Madrid'))::date::text),
    ('k_gps', (select id::text from public.clock_entries where employee_id = yo and type = 'entrada' and real_datetime = mp)),
    ('k_borrada', (select id::text from public.clock_entries where employee_id = yo and type = 'salida' and real_datetime = mp + interval '8 hours')),
    ('k_sin', (select id::text from public.clock_entries where employee_id = yo and type = 'entrada' and real_datetime = mp + interval '1 day'));
end $$;
set constraints all immediate;

-- «yo» firma su mes pasado antes de la corrección.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.firmar_registro_mes((select v::uuid from _s where clave = 'yo'), (select v::date from _s where clave = 'mes_pasado'));
reset role;
select set_config('request.jwt.claims', '', true);

\i supabase/migrations/20261029T0730_l1a_cerrar_escritura_directa.sql
\i supabase/migrations/20261029T0731_l1a_columnas_privadas.sql
\i supabase/migrations/20261029T0732_l1a_origen_movil.sql
-- La 0732, pasada dos veces: la segunda no cambia nada.
\i supabase/migrations/20261029T0732_l1a_origen_movil.sql
\i supabase/migrations/20261029T0733_l1a_informe_origen.sql

-- ── 1 · clock_entries sin escritura directa ────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); r jsonb; n int := 0;
begin
  begin
    insert into public.clock_entries (employee_id, type, datetime, source) values (yo, 'entrada', now(), 'movil');
  exception when insufficient_privilege then n := n + 1; end;
  begin
    update public.clock_entries set source = 'tablet' where employee_id = yo;
  exception when insufficient_privilege then n := n + 1; end;
  begin
    delete from public.clock_entries where employee_id = yo;
  exception when insufficient_privilege then n := n + 1; end;
  if n <> 3 then raise exception 'PRUEBA L1A2B · 1: el trabajador aún escribe directo en clock_entries (% de 3 cerradas).', n; end if;
  r := to_jsonb(public.fichar(yo, 'entrada', 'movil', (select v::uuid from _s where clave = 'centro'), 40.4169, -3.7038, null, now() - interval '2 hours'));
  if not exists (select 1 from public.clock_entries where employee_id = yo and source = 'movil' and created_at > now() - interval '1 minute') then
    raise exception 'PRUEBA L1A2B · 1: fichar() no ha fichado (%).', r;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); n int := 0;
begin
  begin
    update public.clock_entries set real_datetime = now() where employee_id = yo;
  exception when insufficient_privilege then n := n + 1; end;
  begin
    delete from public.clock_entries where employee_id = yo;
  exception when insufficient_privilege then n := n + 1; end;
  if n <> 2 then raise exception 'PRUEBA L1A2B · 1: el administrador aún cambia o borra directo (% de 2 cerradas).', n; end if;
  raise notice '1 · clock_entries: nadie escribe directo; fichar() sigue fichando';
end $$;

-- ── 2 · export_gestoria_mensual ─────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); v_dni text;
begin
  select g.dni into v_dni from public.export_gestoria_mensual(a, (current_date - 40), current_date) g
   where g.empleado = 'Trabajador de la prueba L1a2b';
  if v_dni is distinct from '00000000T' then raise exception 'PRUEBA L1A2B · 2: el administrador no recibe el DNI (%).', v_dni; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); ok boolean := false;
begin
  begin
    perform * from public.export_gestoria_mensual(a, (current_date - 40), current_date);
  exception when insufficient_privilege then ok := sqlerrm = 'NO_AUTORIZADO'; end;
  if not ok then raise exception 'PRUEBA L1A2B · 2: el encargado saca el resumen para la gestoría.'; end if;
  raise notice '2 · la gestoría: el administrador, con DNI; el encargado, no';
end $$;
reset role;

-- ── 3 · Las columnas privadas ───────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); c text; n int := 0; v_id uuid; v_nombre text;
        centro uuid := (select v::uuid from _s where clave = 'centro');
begin
  foreach c in array array['salary', 'dni', 'birth_date', 'employer_ss_annual'] loop
    begin
      execute format('select %I from public.employees where account_id = %L limit 1', c, a);
    exception when insufficient_privilege then n := n + 1; end;
  end loop;
  begin
    perform * from public.employees where account_id = a limit 1;
  exception when insufficient_privilege then n := n + 1; end;
  if n <> 5 then raise exception 'PRUEBA L1A2B · 3: la sesión aún lee columnas privadas de employees (% de 5 cerradas).', n; end if;
  perform id, name, phone, email, "position", location_id, contracted_hours_week, username, account_id
     from public.employees where account_id = a;
  -- La ficha se guarda como el front: INSERT y UPDATE, devolviendo solo columnas que se ven.
  insert into public.employees (name, location_id, account_id, "position", salary, dni, birth_date)
  values ('Alta de la prueba L1a2b', centro, a, 'Sala', 1234, '22222222J', '1991-02-03') returning id, name into v_id, v_nombre;
  update public.employees set salary = 1300, dni = '33333333P' where id = v_id returning name into v_nombre;
  if v_nombre is distinct from 'Alta de la prueba L1a2b' then raise exception 'PRUEBA L1A2B · 3: la ficha no se guarda.'; end if;
  if (select p.salary from public.empleados_datos_privados(a) p where p.id = v_id) is distinct from 1300
     or (select p.dni from public.empleados_datos_privados(a) p where p.id = v_id) is distinct from '33333333P' then
    raise exception 'PRUEBA L1A2B · 3: el administrador no ve los datos privados guardados por empleados_datos_privados.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); ok boolean := false;
begin
  begin
    perform dni from public.employees where id = yo;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PRUEBA L1A2B · 3: el trabajador lee el DNI de employees.'; end if;
  if not exists (select 1 from public.employees where id = yo) then raise exception 'PRUEBA L1A2B · 3: el trabajador no ve su ficha.'; end if;
  raise notice '3 · columnas privadas: cerradas a la sesión; la ficha se guarda; el administrador las ve por su función';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform salary from public.employees limit 1;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PRUEBA L1A2B · 3: anon lee el salario.'; end if;
end $$;
reset role;

-- ── 4 · El origen ───────────────────────────────────────────────────────────
do $$
declare v_mal text; f public.registro_jornada_firma;
        yo uuid := (select v::uuid from _s where clave = 'yo'); v_mes date := (select v::date from _s where clave = 'mes_pasado');
begin
  select string_agg(x.k || '=' || coalesce(ce.source, '¿?'), ', ') into v_mal
    from (values ('k_gps', 'movil'), ('k_borrada', 'movil'), ('k_sin', 'kiosko')) x(k, esperado)
    join public.clock_entries ce on ce.id = (select v::uuid from _s where clave = x.k)
   where ce.source is distinct from x.esperado;
  if v_mal is not null then raise exception 'PRUEBA L1A2B · 4: el origen no es el esperado: %.', v_mal; end if;
  if (select count(*) from public.clock_entry_audit a
       where a.clock_entry_id in ((select v::uuid from _s where clave = 'k_gps'), (select v::uuid from _s where clave = 'k_borrada'))
         and a.action = 'edit' and a.reason like 'Origen corregido:%(20261029T0732_l1a_origen_movil)%'
         and a.actor_label = 'Corrección de datos (Folvy)' and a.conformidad is null
         and a.before ->> 'source' = 'kiosko' and a.after ->> 'source' = 'movil'
         and public._solo_cambia_origen(a.before, a.after)) <> 2 then
    raise exception 'PRUEBA L1A2B · 4: el rastro no tiene una fila por marca (con motivo, quién y sin conformidad), o la segunda pasada dejó más.';
  end if;
  if exists (select 1 from public.clock_entry_audit a where a.clock_entry_id = (select v::uuid from _s where clave = 'k_sin') and a.action = 'edit') then
    raise exception 'PRUEBA L1A2B · 4: la marca sin ubicación tiene un cambio.';
  end if;
  select * into f from public.registro_jornada_firma where employee_id = yo and mes = v_mes;
  if f.id is null or f.invalidada_at is not null or f.huella is distinct from public._huella_registro_mes(yo, v_mes) then
    raise exception 'PRUEBA L1A2B · 4: corregir el origen ha quitado valor a la firma del mes.';
  end if;
  if current_setting('app.clock_edit_reason', true) <> '' then
    raise exception 'PRUEBA L1A2B · 4: el motivo de la 0732 se queda puesto para lo que venga después.';
  end if;
  raise notice '4 · el origen: las dos con GPS a «movil», la otra sigue en «kiosko»; con rastro y la firma vigente';
end $$;

-- ── 5 · El informe ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); v_mes date := (select v::date from _s where clave = 'mes_pasado');
        d jsonb; m jsonb; c jsonb;
begin
  d := public.informe_registro_jornada(yo, v_mes, (v_mes + interval '1 month - 1 day')::date);
  select x into m from jsonb_array_elements(d -> 'marcas') x where x ->> 'id' = (select v from _s where clave = 'k_gps');
  if m ->> 'origen' <> 'movil' or m -> 'origen_corregido' ->> 'antes' <> 'kiosko' then
    raise exception 'PRUEBA L1A2B · 5: la marca no dice de qué origen venía (%).', m;
  end if;
  select x into m from jsonb_array_elements(d -> 'marcas') x where x ->> 'id' = (select v from _s where clave = 'k_sin');
  if m ->> 'origen' <> 'kiosko' or jsonb_typeof(m -> 'origen_corregido') <> 'null' then
    raise exception 'PRUEBA L1A2B · 5: la marca sin ubicación sale con el origen corregido (%).', m;
  end if;
  select x into c from jsonb_array_elements(d -> 'cambios') x where x ->> 'marca' = (select v from _s where clave = 'k_gps');
  if (c ->> 'solo_origen')::boolean is not true then
    raise exception 'PRUEBA L1A2B · 5: el cambio de origen no va como «solo_origen» (%).', c;
  end if;
  raise notice '5 · el informe: la marca dice de dónde venía y el cambio va como «solo_origen»';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 6 · Una sola firma de cada función ──────────────────────────────────────
do $$
declare v_mal text;
begin
  select string_agg(proname || ' (' || n || ')', ', ') into v_mal from (
    select p.proname, count(*) n from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('export_gestoria_mensual', '_informe_registro_jornada', '_solo_cambia_origen', 'informe_registro_jornada', 'fichar')
     group by p.proname having count(*) > 1) x;
  if v_mal is not null then raise exception 'PRUEBA L1A2B · 6: hay sobrecargas: %.', v_mal; end if;
  raise notice '6 · una sola firma de cada función';
end $$;

-- ── 7 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261029T0733_l1a_informe_origen.down.sql
\i supabase/vuelta-atras/20261029T0732_l1a_origen_movil.down.sql
\i supabase/vuelta-atras/20261029T0731_l1a_columnas_privadas.down.sql
\i supabase/vuelta-atras/20261029T0730_l1a_cerrar_escritura_directa.down.sql
do $$
declare v_mal text;
begin
  select string_agg(split_part(s.clave, ':', 2), ', ') into v_mal from _s s
   where s.clave like 'huella:%' and md5(pg_get_functiondef(to_regprocedure(split_part(s.clave, ':', 2)))) is distinct from s.v;
  if v_mal is not null then raise exception 'PRUEBA L1A2B · 7: la vuelta atrás no deja como estaban: %.', v_mal; end if;
  if (select count(*) from pg_policy where polrelid = 'public.clock_entries'::regclass) <> 4
     or not has_table_privilege('authenticated', 'public.clock_entries', 'insert')
     or not has_table_privilege('anon', 'public.clock_entries', 'delete')
     or not has_table_privilege('authenticated', 'public.employees', 'select')
     or not has_column_privilege('anon', 'public.employees', 'dni', 'select')
     or to_regprocedure('public._solo_cambia_origen(jsonb,jsonb)') is not null then
    raise exception 'PRUEBA L1A2B · 7: la vuelta atrás no deja los privilegios y las políticas como estaban.';
  end if;
  if (select string_agg(ce.source, ',' order by x.o) from (values (1, 'k_gps'), (2, 'k_borrada'), (3, 'k_sin')) x(o, k)
        join public.clock_entries ce on ce.id = (select v::uuid from _s where clave = x.k)) <> 'kiosko,kiosko,kiosko' then
    raise exception 'PRUEBA L1A2B · 7: la vuelta atrás no devuelve las marcas a «kiosko».';
  end if;
  raise notice '7 · la vuelta atrás: las dos funciones, los privilegios, las políticas y el origen, como estaban';
end $$;

rollback;
