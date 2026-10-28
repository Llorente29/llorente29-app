-- supabase/staging/sql/20261028_l1a_correcciones_e_informe_prueba.sql
--
-- SOLO STAGING. Prueba de la 0700, la 0705 y la 0706 (L1a · PR 2: sin escritura
-- directa en los fichajes, las correcciones dentro de la ley,
-- la firma del mes y el informe para la Inspección), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia.
--
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role), en
-- la cuenta A: el trabajador (enlazado dentro de la transacción a una ficha
-- limpia), el encargado (con «Norte Centro»), el administrador, el
-- administrador de la cuenta B y, para el enlace, sin sesión (anon). Personas
-- inventadas: «yo» y «otro» en Norte Centro, «lejano» en Norte Mercado.
--
--   0 · lo de antes: si ya están aplicadas, sus vueltas atrás; y la huella de
--       las cinco funciones que cambian, para compararla al final.
--   1 · sin escritura directa: ni el trabajador inserta ni el administrador
--       cambia o borra una marca; fichar() sigue fichando.
--   2 · export_gestoria_mensual (lleva el DNI), solo el administrador. Y el
--       ensayo del paso siguiente, en un savepoint: con el SELECT del salario,
--       el DNI y el nacimiento quitado, el administrador guarda la ficha como
--       la guarda el front nuevo (INSERT o UPDATE) y no como el de antes
--       (upsert); el DNI sale por empleados_datos_privados.
--   3 · corregir y la conformidad: el encargado corrige a los suyos (nace
--       «pendiente»), no a los de otro local; el trabajador pide solo para sí;
--       lo aprobado no pide conformidad y sabe de qué petición viene; el
--       trabajador discute en un toque, una sola vez, y solo lo suyo.
--   4 · la firma del mes: solo un mes acabado, una vez, y la propia persona;
--       corregir ese mes la deja sin valor y se vuelve a firmar; borrar
--       coordenadas no la toca.
--   5 · el informe: el encargado, sin DNI y la baja como «ausente»; el
--       administrador, con DNI; nadie de fuera.
--   6 · el enlace: lo crea el administrador; abre sin sesión con DNI; caducado,
--       retirado o inventado, no abre.
--   7 · las jornadas para revisar: la de más de 12 h y la entrada sin salida;
--       el encargado, solo las de los suyos.
--   8 · una sola firma de cada función.
--   9 · la vuelta atrás: las cinco huellas de antes, los permisos de antes y
--       nada de lo nuevo.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L1A2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
-- La 0706 deja su respaldo; la 0705 (solo añade) se reconoce por su función.
-- Desde una rama, la 0705 puede estar aplicada de verdad (W05: solo añade).
select exists (select 1 from public.funcion_respaldo where migracion = '20261028T0706_l1a_corregir_con_conformidad') as l1a2_c_aplicada \gset
\if :l1a2_c_aplicada
\i supabase/vuelta-atras/20261028T0706_l1a_corregir_con_conformidad.down.sql
\endif
select to_regprocedure('public.informe_registro_jornada(uuid,date,date)') is not null as l1a2_b_aplicada \gset
\if :l1a2_b_aplicada
\i supabase/vuelta-atras/20261028T0705_l1a_correcciones_firma_e_informe.down.sql
\endif
select exists (select 1 from public.funcion_respaldo where migracion = '20261028T0700_l1a_cerrar_escritura_directa') as l1a2_a_aplicada \gset
\if :l1a2_a_aplicada
\i supabase/vuelta-atras/20261028T0700_l1a_cerrar_escritura_directa.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('centro', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('mercado', 'e0200000-0000-4000-8000-0000000000a3'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7'), ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1');

-- La huella de antes de las cinco funciones, para la vuelta atrás.
insert into _s
select 'huella:' || f, md5(pg_get_functiondef(to_regprocedure(f)))
  from (values ('public.edit_clock_entry(uuid,timestamp with time zone,text,text,text)'),
               ('public.void_clock_entry(uuid,text,text)'),
               ('public.resolve_clock_correction(uuid,boolean,text,text)'),
               ('public.request_clock_correction(uuid,uuid,text,text,uuid,text,timestamp with time zone)'),
               ('public.export_gestoria_mensual(uuid,date,date)')) x(f);

do $$
declare v_falta text;
begin
  if to_regprocedure('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)') is null then
    raise exception 'PRUEBA L1A2 · 0: falta fichar() (la 1905 del PR 1).';
  end if;
  if (select count(*) from _s where clave like 'huella:%' and v is not null) <> 5 then
    raise exception 'PRUEBA L1A2 · 0: falta alguna de las cinco funciones que cambian.';
  end if;
  if to_regclass('public.registro_jornada_firma') is not null or to_regprocedure('public.informe_registro_jornada(uuid,date,date)') is not null
     or exists (select 1 from pg_trigger where tgname in ('trg_clock_audit_conformidad', 'trg_registro_firma_invalidar')) then
    raise exception 'PRUEBA L1A2 · 0: ya hay cosas de la 0705 o la 0706 antes de aplicarlas.';
  end if;
  if not has_table_privilege('authenticated', 'public.clock_entries', 'INSERT') then
    raise exception 'PRUEBA L1A2 · 0: los permisos de antes no son los de producción.';
  end if;
  select string_agg(x.c, ', ') into v_falta
    from (values ('admin', 'admin'), ('encargado', 'manager'), ('trabajador', 'worker')) x(c, rol)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = 'cuenta') and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA L1A2 · faltan los usuarios de prueba de la cuenta A: %.', v_falta; end if;
  raise notice '0 · lo de antes: las cinco funciones medidas, sin nada de la 0705 ni la 0706 y con los permisos de producción';
end $$;

-- Los locales, las personas y sus fichajes, inventados.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
        centro uuid := (select v::uuid from _s where clave = 'centro'); mercado uuid := (select v::uuid from _s where clave = 'mercado');
        yo uuid; otro uuid; lejano uuid;
        mes_pasado timestamptz := (date_trunc('month', now() at time zone 'Europe/Madrid') - interval '1 month' + interval '10 days 9 hours') at time zone 'Europe/Madrid';
begin
  update public.locations set lat = 40.4168, lng = -3.7038, clock_geofence_mode = 'warn', clock_radius_m = 200 where id = centro;
  update public.locations set lat = 40.4500, lng = -3.6900, clock_geofence_mode = 'warn', clock_radius_m = 200 where id = mercado;
  insert into public.employees (name, location_id, account_id, "position", salary, dni, contracted_hours_week)
  values ('Trabajador de la prueba L1a2', centro, a, 'Cocina', 1000, '00000000T', 30) returning id into yo;
  insert into public.employees (name, location_id, account_id, "position", salary, dni)
  values ('Compañero de la prueba L1a2', centro, a, 'Sala', 1999.99, '11111111H') returning id into otro;
  insert into public.employees (name, location_id, account_id, "position", salary, dni)
  values ('Persona de otro local, prueba L1a2', mercado, a, 'Sala', 1500, '22222222J') returning id into lejano;
  update public.user_profiles set employee_id = yo where user_id = (select v::uuid from _s where clave = 'trabajador') and account_id = a;
  insert into public.manager_locations (user_profile_id, location_id)
  select up.id, centro from public.user_profiles up
   where up.user_id = (select v::uuid from _s where clave = 'encargado') and up.account_id = a
     and not exists (select 1 from public.manager_locations ml where ml.user_profile_id = up.id and ml.location_id = centro);
  insert into public.vacations (employee_id, account_id, type, start_date, end_date, days, status, notes)
  values (otro, a, 'baja_medica', current_date - 5, current_date - 3, 3, 'aprobada', 'Parte de baja de la prueba');
  -- yo: una jornada del mes pasado (para firmar) y una de esta semana.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock, lat, lng, created_at)
  values (yo, 'entrada', mes_pasado, mes_pasado, 'movil', centro, 40.4169, -3.7038, mes_pasado),
         (yo, 'salida', mes_pasado + interval '8 hours', mes_pasado + interval '8 hours', 'movil', centro, 40.4169, -3.7038, mes_pasado + interval '8 hours'),
         (yo, 'entrada', now() - interval '3 days', now() - interval '3 days', 'movil', centro, null, null, now() - interval '3 days'),
         (yo, 'salida', now() - interval '3 days' + interval '7 hours', now() - interval '3 days' + interval '7 hours', 'movil', centro, null, null, now() - interval '3 days' + interval '7 hours');
  -- otro: una entrada de hace 30 h sin salida, y una jornada cerrada de hace 2 días.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock, created_at)
  values (otro, 'entrada', now() - interval '4 days', now() - interval '4 days', 'movil', centro, now() - interval '4 days'),
         (otro, 'salida', now() - interval '4 days' + interval '6 hours', now() - interval '4 days' + interval '6 hours', 'movil', centro, now() - interval '4 days' + interval '6 hours'),
         (otro, 'entrada', now() - interval '30 hours', now() - interval '30 hours', 'movil', centro, now() - interval '30 hours');
  -- lejano: una jornada de 13 h.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock, created_at)
  values (lejano, 'entrada', now() - interval '3 days', now() - interval '3 days', 'movil', mercado, now() - interval '3 days'),
         (lejano, 'salida', now() - interval '3 days' + interval '13 hours', now() - interval '3 days' + interval '13 hours', 'movil', mercado, now() - interval '3 days' + interval '13 hours');
  insert into _s values ('yo', yo), ('otro', otro), ('lejano', lejano), ('mes_pasado', (date_trunc('month', mes_pasado at time zone 'Europe/Madrid'))::date::text),
    ('salida_lejano', (select id::text from public.clock_entries where employee_id = lejano and type = 'salida'));
end $$;
set constraints all immediate;

\i supabase/migrations/20261028T0700_l1a_cerrar_escritura_directa.sql
\i supabase/migrations/20261028T0705_l1a_correcciones_firma_e_informe.sql
-- La 0705 se puede pasar dos veces (W05: desde la rama va de verdad).
\i supabase/migrations/20261028T0705_l1a_correcciones_firma_e_informe.sql
\i supabase/migrations/20261028T0706_l1a_corregir_con_conformidad.sql

-- ── 1 · Sin escritura directa ───────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); centro uuid := (select v::uuid from _s where clave = 'centro'); r jsonb;
begin
  begin
    insert into public.clock_entries (employee_id, type, datetime) values (yo, 'entrada', now());
    raise exception 'PRUEBA L1A2 · 1: el trabajador inserta directo en clock_entries.';
  exception when insufficient_privilege then null; end;
  r := public.fichar(yo, 'entrada', 'movil', centro, 40.4169, -3.7038);
  if r->>'id' is null then raise exception 'PRUEBA L1A2 · 1: fichar() no ficha.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo');
begin
  begin
    update public.clock_entries set real_datetime = now() where employee_id = yo;
    raise exception 'PRUEBA L1A2 · 1: el administrador cambia una marca sin pasar por la corrección.';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.clock_entries where employee_id = yo;
    raise exception 'PRUEBA L1A2 · 1: el administrador borra una marca.';
  exception when insufficient_privilege then null; end;
  raise notice '1 · sin escritura directa: ni insertar, ni cambiar, ni borrar; fichar() ficha';
end $$;

-- ── 2 · La gestoría, solo el administrador; y el paso siguiente, ensayado ──
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
begin
  perform * from public.export_gestoria_mensual(a, current_date - 7, current_date);
end $$;
reset role;
-- El paso siguiente (el cierre de las columnas), dentro de un savepoint.
savepoint antes_de_cerrar_columnas;
revoke select on public.employees from authenticated, anon;
grant select (id, name, location_id, account_id, "position", active) on public.employees to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); otro uuid := (select v::uuid from _s where clave = 'otro');
        centro uuid := (select v::uuid from _s where clave = 'centro'); v_id uuid; v_dni text;
begin
  begin
    select dni into v_dni from public.employees where id = otro;
    raise exception 'PRUEBA L1A2 · 2: con las columnas cerradas, el DNI se lee de employees.';
  exception when insufficient_privilege then null; end;
  -- El front nuevo: cambios con UPDATE y altas con INSERT, devolviendo solo lo permitido.
  update public.employees set salary = 2100, dni = '11111111H', name = 'Compañero de la prueba L1a2' where id = otro returning id into v_id;
  if v_id is distinct from otro then raise exception 'PRUEBA L1A2 · 2: con las columnas cerradas, el UPDATE de la ficha no pasa.'; end if;
  insert into public.employees (name, location_id, account_id, salary, dni) values ('Alta de la prueba L1a2', centro, a, 1200, '33333333P') returning id into v_id;
  if v_id is null then raise exception 'PRUEBA L1A2 · 2: con las columnas cerradas, el alta no pasa.'; end if;
  -- El de antes (upsert): no pasa. Por eso el cierre va en la tanda siguiente.
  begin
    insert into public.employees (id, name, location_id, account_id, salary) values (otro, 'x', centro, a, 1)
    on conflict (id) do update set salary = excluded.salary returning id into v_id;
    raise exception 'PRUEBA L1A2 · 2: el upsert pasa con las columnas cerradas: el cierre podría ir ya.';
  exception when insufficient_privilege then null; end;
  select dni into v_dni from public.empleados_datos_privados(a) where id = otro;
  if v_dni is distinct from '11111111H' then raise exception 'PRUEBA L1A2 · 2: empleados_datos_privados no da el DNI al administrador.'; end if;
end $$;
reset role;
rollback to savepoint antes_de_cerrar_columnas;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
begin
  begin
    perform * from public.export_gestoria_mensual(a, current_date - 7, current_date);
    raise exception 'PRUEBA L1A2 · 2: el encargado saca el resumen de la gestoría (con DNI).';
  exception when insufficient_privilege then null; end;
  raise notice '2 · la gestoría, solo el administrador; con las columnas cerradas la ficha se guarda con INSERT o UPDATE, no con upsert';
end $$;

-- ── 3 · Corregir y la conformidad ───────────────────────────────────────────
do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro'); lejano uuid := (select v::uuid from _s where clave = 'lejano');
        v_id uuid; v_conf text;
begin
  -- El encargado cierra la entrada de «otro» con su salida, con motivo.
  perform public.add_manual_clock_entry(otro, 'salida', now() - interval '22 hours', 'No fichó la salida', 'Encargado de la prueba', false);
  select a.conformidad into v_conf from public.clock_entry_audit a
   where a.employee_id = otro and a.action = 'create_manual' order by a.created_at desc limit 1;
  if v_conf is distinct from 'pendiente' then raise exception 'PRUEBA L1A2 · 3: la marca que pone el encargado no espera la conformidad (%).', v_conf; end if;
  insert into _s select 'audit_otro', a.id from public.clock_entry_audit a
   where a.employee_id = otro and a.action = 'create_manual' order by a.created_at desc limit 1;
  -- Y cambia la hora de una marca suya.
  select id into v_id from public.clock_entries where employee_id = otro and type = 'salida' and source = 'movil';
  perform public.edit_clock_entry(v_id, now() - interval '4 days' + interval '7 hours', 'Salió una hora más tarde', null, 'Encargado de la prueba');
  if (select a.conformidad from public.clock_entry_audit a where a.clock_entry_id = v_id and a.action = 'edit' order by a.created_at desc limit 1) is distinct from 'pendiente' then
    raise exception 'PRUEBA L1A2 · 3: el cambio del encargado no espera la conformidad.';
  end if;
  -- A una persona de otro local, no (el id lo trae la prueba: el encargado ni la ve).
  v_id := (select v::uuid from _s where clave = 'salida_lejano');
  begin
    perform public.edit_clock_entry(v_id, now(), 'Prueba', null, null);
    raise exception 'PRUEBA L1A2 · 3: el encargado corrige a una persona de otro local.';
  exception when raise_exception then if sqlerrm not like 'NO_AUTORIZADO%' then raise; end if; end;
  begin
    perform public.void_clock_entry(v_id, 'Prueba', null);
    raise exception 'PRUEBA L1A2 · 3: el encargado anula una marca de otro local.';
  exception when raise_exception then if sqlerrm not like 'NO_AUTORIZADO%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); otro uuid := (select v::uuid from _s where clave = 'otro');
        r public.clock_correction_request; v_audit uuid;
begin
  -- Pedir por otro, o en nombre de otro: no.
  begin
    perform public.request_clock_correction(otro, otro, 'add', 'Por el compañero', null, 'salida', now() - interval '1 hour');
    raise exception 'PRUEBA L1A2 · 3: el trabajador pide una corrección para otro.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.request_clock_correction(yo, otro, 'add', 'En nombre de otro', null, 'salida', now() - interval '1 hour');
    raise exception 'PRUEBA L1A2 · 3: el trabajador pide en nombre de otro.';
  exception when insufficient_privilege then null; end;
  r := public.request_clock_correction(yo, yo, 'add', 'Me olvidé de fichar la salida', null, 'salida', now() - interval '3 days' + interval '8 hours');
  insert into _s values ('peticion', r.id);
  -- Lo que el encargado puso a «otro» no lo puede contestar «yo».
  v_audit := (select v::uuid from _s where clave = 'audit_otro');
  begin
    perform public.responder_correccion(v_audit, true);
    raise exception 'PRUEBA L1A2 · 3: el trabajador contesta una corrección de otro.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); v_pet uuid := (select v::uuid from _s where clave = 'peticion');
        v_entrada uuid;
begin
  -- Aprobar la petición de «yo»: el alta sabe de qué petición viene y no pide conformidad.
  perform public.resolve_clock_correction(v_pet, true, 'Aprobada', 'Administrador de la prueba');
  if not exists (select 1 from public.clock_entry_audit a where a.employee_id = yo and a.action = 'create_manual'
                  and a.peticion_id = v_pet and a.conformidad is null) then
    raise exception 'PRUEBA L1A2 · 3: lo aprobado no sabe de qué petición viene, o pide conformidad.';
  end if;
  if not exists (select 1 from public.clock_entry_audit a where a.action = 'approve' and a.peticion_id = v_pet and a.clock_entry_id is not null) then
    raise exception 'PRUEBA L1A2 · 3: la aprobación no apunta a la marca nueva.';
  end if;
  -- El administrador cambia la entrada de esta semana de «yo»: espera su conformidad.
  select id into v_entrada from public.clock_entries where employee_id = yo and type = 'entrada' and real_datetime > now() - interval '4 days' and real_datetime < now() - interval '2 days';
  perform public.edit_clock_entry(v_entrada, now() - interval '3 days' - interval '30 minutes', 'Entró antes: lo vio el encargado', null, 'Administrador de la prueba');
  insert into _s select 'para_responder', a.id from public.clock_entry_audit a where a.clock_entry_id = v_entrada and a.action = 'edit' and a.conformidad = 'pendiente';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_audit uuid := (select v::uuid from _s where clave = 'para_responder'); r jsonb;
begin
  if v_audit is null then raise exception 'PRUEBA L1A2 · 3: el cambio del administrador no espera la conformidad.'; end if;
  r := public.responder_correccion(v_audit, false, 'Entré a mi hora');
  if r->>'conformidad' <> 'desacuerdo' then raise exception 'PRUEBA L1A2 · 3: «No es así» no queda en desacuerdo.'; end if;
  begin
    perform public.responder_correccion(v_audit, true);
    raise exception 'PRUEBA L1A2 · 3: se contesta dos veces.';
  exception when invalid_parameter_value then null; end;
  raise notice '3 · corregir: el encargado, a los suyos y con conformidad; el trabajador pide para sí y discute en un toque';
end $$;

-- ── 4 · La firma del mes ────────────────────────────────────────────────────
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); otro uuid := (select v::uuid from _s where clave = 'otro');
        v_mes date := (select v::date from _s where clave = 'mes_pasado'); r jsonb;
begin
  begin
    perform public.firmar_registro_mes(yo, current_date, '{}'::jsonb);
    raise exception 'PRUEBA L1A2 · 4: se firma un mes sin acabar.';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.firmar_registro_mes(otro, v_mes, '{}'::jsonb);
    raise exception 'PRUEBA L1A2 · 4: se firma el mes de otro.';
  exception when insufficient_privilege then null; end;
  r := public.firmar_registro_mes(yo, v_mes, '{"horas": "8 h 00"}'::jsonb);
  if r->>'huella' is null then raise exception 'PRUEBA L1A2 · 4: la firma no guarda la huella.'; end if;
  begin
    perform public.firmar_registro_mes(yo, v_mes, '{}'::jsonb);
    raise exception 'PRUEBA L1A2 · 4: se firma dos veces el mismo mes.';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); v_mes date := (select v::date from _s where clave = 'mes_pasado'); v_id uuid;
begin
  select id into v_id from public.clock_entries where employee_id = yo and type = 'salida' and public._mes_madrid(real_datetime) = v_mes;
  perform public.edit_clock_entry(v_id, (select real_datetime from public.clock_entries where id = v_id) + interval '15 minutes', 'Salió más tarde', null, 'Administrador de la prueba');
  if exists (select 1 from public.registro_jornada_firma where employee_id = yo and mes = v_mes and invalidada_at is null) then
    raise exception 'PRUEBA L1A2 · 4: corregir un mes firmado no deja la firma sin valor.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); v_mes date := (select v::date from _s where clave = 'mes_pasado');
begin
  perform public.firmar_registro_mes(yo, v_mes, '{"horas": "8 h 15"}'::jsonb);
end $$;
reset role;
-- La limpieza de ubicaciones (sin sesión) no toca la firma.
select set_config('request.jwt.claims', '', true);
update public.clock_entries set lat = null, lng = null
 where employee_id = (select v::uuid from _s where clave = 'yo') and public._mes_madrid(real_datetime) = (select v::date from _s where clave = 'mes_pasado');
do $$
begin
  if not exists (select 1 from public.registro_jornada_firma where employee_id = (select v::uuid from _s where clave = 'yo')
                  and mes = (select v::date from _s where clave = 'mes_pasado') and invalidada_at is null) then
    raise exception 'PRUEBA L1A2 · 4: borrar las coordenadas deja la firma sin valor.';
  end if;
  if (select count(*) from public.registro_jornada_firma where employee_id = (select v::uuid from _s where clave = 'yo')) <> 2 then
    raise exception 'PRUEBA L1A2 · 4: la firma sin valor no se queda al lado de la nueva.';
  end if;
  raise notice '4 · la firma del mes: un mes acabado, una vez, la propia persona; corregirlo pide volver a firmar';
end $$;

-- ── 5 · El informe ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro'); lejano uuid := (select v::uuid from _s where clave = 'lejano'); j jsonb;
begin
  j := public.informe_registro_jornada(otro, current_date - 10, current_date);
  if j->'persona'->>'dni' is not null then raise exception 'PRUEBA L1A2 · 5: el encargado ve el DNI en el informe.'; end if;
  if jsonb_array_length(j->'marcas') < 4 then raise exception 'PRUEBA L1A2 · 5: al informe le faltan marcas (%).', jsonb_array_length(j->'marcas'); end if;
  if not exists (select 1 from jsonb_array_elements(j->'cambios') c where c->>'accion' = 'edit' and c->>'motivo' = 'Salió una hora más tarde'
                  and c->>'conformidad' = 'pendiente' and c->'antes' is not null) then
    raise exception 'PRUEBA L1A2 · 5: el informe no enseña la corrección con la marca de antes y la conformidad.';
  end if;
  if not exists (select 1 from jsonb_array_elements(j->'ausencias') x where x->>'tipo' = 'ausente')
     or exists (select 1 from jsonb_array_elements(j->'ausencias') x where x->>'tipo' = 'baja_medica') then
    raise exception 'PRUEBA L1A2 · 5: el encargado ve el motivo de una baja.';
  end if;
  begin
    perform public.informe_registro_jornada(lejano, current_date - 10, current_date);
    raise exception 'PRUEBA L1A2 · 5: el encargado saca el informe de una persona de otro local.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro'); j jsonb;
begin
  j := public.informe_registro_jornada(otro, current_date - 10, current_date);
  if j->'persona'->>'dni' is distinct from '11111111H' then raise exception 'PRUEBA L1A2 · 5: el administrador no ve el DNI en el informe.'; end if;
  if not exists (select 1 from jsonb_array_elements(j->'ausencias') x where x->>'tipo' = 'baja_medica') then
    raise exception 'PRUEBA L1A2 · 5: el administrador no ve la baja.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.informe_registro_jornada((select v::uuid from _s where clave = 'otro'), current_date - 10, current_date);
    raise exception 'PRUEBA L1A2 · 5: otra cuenta saca el informe.';
  exception when insufficient_privilege then null; end;
  raise notice '5 · el informe: el encargado sin DNI y con «ausente»; el administrador, todo; otra cuenta, nada';
end $$;
reset role;

-- ── 6 · El enlace ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.crear_enlace_inspeccion((select v::uuid from _s where clave = 'otro'), current_date - 10, current_date, 30);
    raise exception 'PRUEBA L1A2 · 6: el encargado crea un enlace para la Inspección.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  begin
    perform public.crear_enlace_inspeccion((select v::uuid from _s where clave = 'otro'), current_date - 10, current_date, 0);
    raise exception 'PRUEBA L1A2 · 6: un enlace que no caduca nunca.';
  exception when invalid_parameter_value then null; end;
  r := public.crear_enlace_inspeccion((select v::uuid from _s where clave = 'otro'), current_date - 10, current_date, 30);
  insert into _s values ('token', r->>'token');
  r := public.crear_enlace_inspeccion((select v::uuid from _s where clave = 'otro'), current_date - 10, current_date, 30);
  insert into _s values ('token_retirado', r->>'token');
  perform public.revocar_enlace_inspeccion(r->>'token');
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
declare j jsonb;
begin
  j := public.informe_por_enlace((select v from _s where clave = 'token'));
  if j->'persona'->>'dni' is distinct from '11111111H' or j->'enlace'->>'caduca_at' is null then
    raise exception 'PRUEBA L1A2 · 6: el enlace no abre el informe con el DNI y su caducidad.';
  end if;
  if exists (select 1 from jsonb_array_elements(j->'ausencias') x where x->>'tipo' = 'baja_medica') then
    raise exception 'PRUEBA L1A2 · 6: el enlace enseña el motivo de una baja.';
  end if;
  begin perform public.informe_por_enlace((select v from _s where clave = 'token_retirado')); raise exception 'PRUEBA L1A2 · 6: abre un enlace retirado.';
  exception when insufficient_privilege then null; end;
  begin perform public.informe_por_enlace('inventado'); raise exception 'PRUEBA L1A2 · 6: abre un enlace inventado.';
  exception when insufficient_privilege then null; end;
  begin perform public.informe_registro_jornada((select v::uuid from _s where clave = 'otro'), current_date - 10, current_date); raise exception 'PRUEBA L1A2 · 6: sin sesión se saca el informe sin enlace.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.registro_jornada_enlace set caduca_at = now() - interval '1 minute' where token = (select v from _s where clave = 'token');
set local role anon;
do $$
begin
  begin perform public.informe_por_enlace((select v from _s where clave = 'token')); raise exception 'PRUEBA L1A2 · 6: abre un enlace caducado.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
  if (select abierto_veces from public.registro_jornada_enlace where token = (select v from _s where clave = 'token')) <> 1 then
    raise exception 'PRUEBA L1A2 · 6: el enlace no cuenta las veces que se abre.';
  end if;
  raise notice '6 · el enlace: lo crea el administrador, abre sin sesión con DNI y sin el motivo de la baja; caducado o retirado, no';
end $$;

-- ── 7 · Las jornadas para revisar ───────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); otro uuid := (select v::uuid from _s where clave = 'otro'); lejano uuid := (select v::uuid from _s where clave = 'lejano');
begin
  -- La entrada de hace 30 h de «otro» la cerró el encargado (paso 3): ya no está.
  if exists (select 1 from public.jornadas_para_revisar(a) j where j.employee_id = otro and j.tipo = 'sin_salida' and j.entrada > now() - interval '31 hours') then
    raise exception 'PRUEBA L1A2 · 7: sigue para revisar una entrada que ya tiene su salida.';
  end if;
  if exists (select 1 from public.jornadas_para_revisar(a) j where j.employee_id = lejano) then
    raise exception 'PRUEBA L1A2 · 7: el encargado ve las jornadas de otro local.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); lejano uuid := (select v::uuid from _s where clave = 'lejano');
begin
  if not exists (select 1 from public.jornadas_para_revisar(a) j where j.employee_id = lejano and j.tipo = 'larga' and j.horas = 13.0) then
    raise exception 'PRUEBA L1A2 · 7: no sale la jornada de 13 h.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform * from public.jornadas_para_revisar((select v::uuid from _s where clave = 'cuenta'));
    raise exception 'PRUEBA L1A2 · 7: el trabajador ve las jornadas para revisar.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Una entrada sin salida antes de la siguiente: dos entradas seguidas de «lejano».
select set_config('request.jwt.claims', '', true);
insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, location_id_at_clock)
values ((select v::uuid from _s where clave = 'lejano'), 'entrada', now() - interval '2 days', now() - interval '2 days', 'movil', (select v::uuid from _s where clave = 'mercado')),
       ((select v::uuid from _s where clave = 'lejano'), 'entrada', now() - interval '26 hours', now() - interval '26 hours', 'movil', (select v::uuid from _s where clave = 'mercado'));
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); lejano uuid := (select v::uuid from _s where clave = 'lejano');
begin
  if (select count(*) from public.jornadas_para_revisar(a) j where j.employee_id = lejano and j.tipo = 'sin_salida') <> 2 then
    raise exception 'PRUEBA L1A2 · 7: no salen las dos entradas sin salida (la de antes de otra entrada y la de más de un día).';
  end if;
  raise notice '7 · para revisar: la de más de 12 h y las entradas sin salida; el encargado, solo las suyas';
end $$;
reset role;

-- ── 8 · Una sola firma de cada función ──────────────────────────────────────
do $$
declare v_mal text;
begin
  select string_agg(proname || ' (' || n || ')', ', ') into v_mal from (
    select p.proname, count(*) n from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('edit_clock_entry', 'void_clock_entry', 'resolve_clock_correction', 'request_clock_correction', 'export_gestoria_mensual',
                         'responder_correccion', 'firmar_registro_mes', 'informe_registro_jornada', 'crear_enlace_inspeccion',
                         'revocar_enlace_inspeccion', 'informe_por_enlace', 'jornadas_para_revisar')
     group by p.proname having count(*) > 1) x;
  if v_mal is not null then raise exception 'PRUEBA L1A2 · 8: hay sobrecargas: %.', v_mal; end if;
  raise notice '8 · una sola firma de cada función';
end $$;

-- ── 9 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T0706_l1a_corregir_con_conformidad.down.sql
\i supabase/vuelta-atras/20261028T0705_l1a_correcciones_firma_e_informe.down.sql
\i supabase/vuelta-atras/20261028T0700_l1a_cerrar_escritura_directa.down.sql
do $$
declare v_mal text;
begin
  select string_agg(split_part(s.clave, ':', 2), ', ') into v_mal from _s s
   where s.clave like 'huella:%' and md5(pg_get_functiondef(to_regprocedure(split_part(s.clave, ':', 2)))) is distinct from s.v;
  if v_mal is not null then raise exception 'PRUEBA L1A2 · 9: la vuelta atrás no deja como estaban: %.', v_mal; end if;
  if to_regclass('public.registro_jornada_firma') is not null or to_regclass('public.registro_jornada_enlace') is not null
     or to_regprocedure('public.informe_registro_jornada(uuid,date,date)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clock_entry_audit' and column_name in ('conformidad', 'peticion_id'))
     or exists (select 1 from pg_trigger where tgname in ('trg_clock_audit_conformidad', 'trg_registro_firma_invalidar')) then
    raise exception 'PRUEBA L1A2 · 9: la vuelta atrás deja cosas de la 0705 o la 0706.';
  end if;
  if not has_table_privilege('authenticated', 'public.clock_entries', 'INSERT') or not has_table_privilege('authenticated', 'public.clock_entries', 'DELETE')
     or (select count(*) from pg_policy where polrelid = 'public.clock_entries'::regclass and polname in ('clock_entries_insert', 'clock_entries_modify', 'clock_entries_delete')) <> 3 then
    raise exception 'PRUEBA L1A2 · 9: la vuelta atrás no devuelve los permisos y las políticas de antes.';
  end if;
  raise notice '9 · la vuelta atrás: las cinco funciones como estaban, los permisos de antes y nada de lo nuevo';
end $$;

rollback;
