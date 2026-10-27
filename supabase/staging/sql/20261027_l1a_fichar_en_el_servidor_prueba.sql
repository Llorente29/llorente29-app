-- supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
--
-- SOLO STAGING. Prueba de la 1905 (L1a · PR 1: fichar en el servidor, permisos
-- por papel y conservación), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia.
--
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role
-- authenticated), en la cuenta A: el trabajador (enlazado dentro de la
-- transacción a una ficha limpia), el encargado (con el local «Norte Centro»
-- asignado dentro de la transacción), el administrador, y el administrador de
-- la cuenta B. Personas inventadas: «yo» y «otro» en Norte Centro (con
-- coordenadas y en modo avisar), «lejano» en Norte Mercado (modo bloquear).
--
--   0 · lo de antes: si el manifiesto ya pasó la 1905, su vuelta atrás; y las
--       cuatro funciones que cambia, con la huella de producción.
--   1 · el trabajador: ficha por sí mismo con la hora del servidor; sin
--       cobertura, con su hora declarada y la de llegada; fuera del radio, se
--       marca la distancia y no se bloquea; no ficha por otro, ni «a mano», ni
--       como tablet; ve solo lo suyo, y su baja como baja.
--   2 · el encargado: ve a las personas de su local y no a las del otro; no ve
--       el salario, el DNI ni la fecha de nacimiento (datos privados: cero
--       filas), ni nóminas, ni documentos; la baja del compañero, como
--       «ausente»; ficha en la tablet con PIN en su local (no en otro, ni con
--       el PIN mal); pone una marca a mano con motivo a los suyos, no a otros.
--   3 · el administrador: todo, con el salario y la baja.
--   4 · otra cuenta: nada de la cuenta A.
--   5 · la conservación: las coordenadas de más de 3 meses se borran y quedan
--       la distancia y «dentro o fuera»; lo de más de 4 años se anonimiza; cada
--       pasada deja su fila, y el vigía lo ve.
--   6 · una sola firma de cada función.
--   7 · la vuelta atrás: las cuatro huellas de producción y nada de la 1905.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L1A: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261027T1905_l1a_fichar_en_el_servidor') as l1a_aplicada \gset
\if :l1a_aplicada
\i supabase/vuelta-atras/20261027T1905_l1a_fichar_en_el_servidor.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('centro', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('mercado', 'e0200000-0000-4000-8000-0000000000a3'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7'), ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare v_mal text;
begin
  select string_agg(f, ', ') into v_mal from (values
    ('public._clock_entry_quien_y_hora()', '5d27e9182dfb6d35220baaaf604b8885'),
    ('public.add_manual_clock_entry(uuid,text,timestamp with time zone,text,text,boolean)', '1964b700cda80e50b1d4b41c55e23bc8'),
    ('public.employee_clock_status(uuid)', '9bee9822d1f56951a751e49e55707455'),
    ('public._documento_trabajador_puede(text,boolean)', 'f291fb28f539fac6c35378ee8e541ad9')) x(f, h)
   where (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(x.f)) is distinct from x.h;
  if v_mal is not null then raise exception 'PRUEBA L1A · 0: no son las de producción: %.', v_mal; end if;
  if to_regprocedure('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)') is not null then
    raise exception 'PRUEBA L1A · 0: fichar() ya existe antes de la 1905.';
  end if;
  raise notice '0 · lo de antes: las cuatro funciones con la huella de producción, y sin fichar()';
end $$;

-- Los usuarios de prueba existen, con su papel.
do $$
declare v_falta text;
begin
  select string_agg(x.c, ', ') into v_falta
    from (values ('admin', 'admin', 'cuenta'), ('encargado', 'manager', 'cuenta'), ('trabajador', 'worker', 'cuenta')) x(c, rol, cta)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = x.cta) and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA L1A · faltan los usuarios de prueba de la cuenta A: %.', v_falta; end if;
  if not exists (select 1 from public.user_profiles where user_id = (select v::uuid from _s where clave = 'admin_b') and role = 'admin' and active) then
    raise exception 'PRUEBA L1A · falta el administrador de la cuenta B.';
  end if;
end $$;

-- Los locales, las personas y lo suyo, inventados.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
        centro uuid := (select v::uuid from _s where clave = 'centro'); mercado uuid := (select v::uuid from _s where clave = 'mercado');
        yo uuid; otro uuid; lejano uuid; antiguo uuid;
begin
  update public.locations set lat = 40.4168, lng = -3.7038, clock_geofence_mode = 'warn', clock_radius_m = 200 where id = centro;
  update public.locations set lat = 40.4500, lng = -3.6900, clock_geofence_mode = 'block', clock_radius_m = 200 where id = mercado;
  insert into public.employees (name, location_id, account_id, "position", salary, dni)
  values ('Trabajador de la prueba L1a', centro, a, 'Cocina', 1000, '00000000T') returning id into yo;
  insert into public.employees (name, location_id, account_id, "position", salary, dni, birth_date)
  values ('Compañero de la prueba L1a', centro, a, 'Sala', 1999.99, '11111111H', date '1990-01-01') returning id into otro;
  insert into public.employees (name, location_id, account_id, "position", salary, dni)
  values ('Persona de otro local, prueba L1a', mercado, a, 'Sala', 1500, '22222222J') returning id into lejano;
  insert into public.employees (name, location_id, account_id, "position")
  values ('Persona antigua, prueba L1a', centro, a, 'Sala') returning id into antiguo;
  update public.user_profiles set employee_id = yo where user_id = (select v::uuid from _s where clave = 'trabajador') and account_id = a;
  insert into public.manager_locations (user_profile_id, location_id)
  select up.id, centro from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = 'encargado') and up.account_id = a;
  insert into public.employee_kiosk_pin (employee_id, pin) values (otro, '4321'), (lejano, '5555');
  insert into public.vacations (employee_id, account_id, type, start_date, end_date, days, status, notes)
  values (otro, a, 'baja_medica', current_date, current_date + 3, 4, 'aprobada', 'Parte de baja de la prueba'),
         (yo, a, 'baja_medica', current_date + 40, current_date + 41, 2, 'aprobada', 'Mi parte'),
         (otro, a, 'vacaciones', current_date + 30, current_date + 31, 2, 'aprobada', null);
  insert into public.payroll_cost (account_id, employee_id, period_year, period_month, status, gross, source)
  values (a, otro, 2026, 9, 'definitiva', 1999.99, 'nomina_upload'), (a, yo, 2026, 9, 'definitiva', 1000, 'nomina_upload');
  insert into public.documents (employee_id, type, name, file_path, file_size_kb, uploaded_role)
  values (otro, 'nomina', 'Nómina del compañero', otro::text || '/n.pdf', 10, 'gestor'),
         (yo, 'nomina', 'Mi nómina', yo::text || '/n.pdf', 10, 'gestor');
  insert into public.clock_correction_request (account_id, employee_id, requested_by_employee_id, kind, reason)
  values (a, otro, otro, 'add', 'Olvido del compañero'), (a, lejano, lejano, 'add', 'Olvido de otro local'), (a, yo, yo, 'add', 'Mi olvido');
  insert into public.employee_notifications (employee_id, account_id, type, title, body)
  values (otro, a, 'aviso', 'Para el compañero', 'Privado'), (lejano, a, 'aviso', 'Para otro local', 'Privado'), (yo, a, 'aviso', 'Para mí', 'Mío');
  insert into public.monthly_balance_closures (employee_id, location_id, account_id, period_label, period_start, period_end)
  values (otro, centro, a, '2026-09', date '2026-09-01', date '2026-09-30'), (lejano, mercado, a, '2026-09', date '2026-09-01', date '2026-09-30'),
         (yo, centro, a, '2026-09', date '2026-09-01', date '2026-09-30');
  -- Para la conservación: un fichaje de hace 4 meses con coordenadas (a 50 m
  -- de Norte Centro) y una marca de hace 5 años con un texto libre.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, lat, lng, location_id_at_clock, created_at)
  values (antiguo, 'entrada', now() - interval '4 months', now() - interval '4 months', 'movil', 40.4172, -3.7038, centro, now() - interval '4 months'),
         (antiguo, 'salida', now() - interval '4 months' + interval '6 hours', now() - interval '4 months' + interval '6 hours', 'movil', 40.4300, -3.7038, centro, now() - interval '4 months' + interval '6 hours');
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, address, location_id_at_clock, created_at)
  values (antiguo, 'entrada', now() - interval '5 years', now() - interval '5 years', 'manual', 'Manual · texto libre de la prueba · por Alguien', centro, now() - interval '5 years');
  insert into _s values ('yo', yo), ('otro', otro), ('lejano', lejano), ('antiguo', antiguo);
end $$;
set constraints all immediate;

\i supabase/migrations/20261027T1905_l1a_fichar_en_el_servidor.sql

-- ── 1 · El trabajador ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
set constraints clock_entry_audit_alta immediate;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); otro uuid := (select v::uuid from _s where clave = 'otro');
        centro uuid := (select v::uuid from _s where clave = 'centro'); r jsonb; v_n int; e public.clock_entries;
begin
  -- Sin cobertura: entrada con la hora del móvil de hace 3 horas.
  r := public.fichar(yo, 'entrada', 'movil', centro, 40.4169, -3.7038, null, now() - interval '3 hours');
  select * into e from public.clock_entries where id = (r->>'id')::uuid;
  if e.declared_at is null or abs(extract(epoch from (e.real_datetime - (now() - interval '3 hours')))) > 5 then
    raise exception 'PRUEBA L1A · 1: sin cobertura no guarda la hora declarada (declarada %, real %).', e.declared_at, e.real_datetime;
  end if;
  if e.source <> 'movil' or e.within_radius is distinct from true or e.distance_m > 50 then
    raise exception 'PRUEBA L1A · 1: el origen o la distancia no son los esperados (%, %, %).', e.source, e.within_radius, e.distance_m;
  end if;
  if not exists (select 1 from public.clock_entry_audit a where a.clock_entry_id = e.id and a.action = 'create'
                  and a.reason like 'Fichaje propio desde el móvil · sin cobertura%' and a.after->>'via' = 'movil'
                  and (a.after->>'para_otra_persona')::boolean = false and a.after->>'hora_declarada' is not null) then
    raise exception 'PRUEBA L1A · 1: el rastro del fichaje sin cobertura no dice quién, por qué vía ni la hora declarada.';
  end if;
  if (select count(*) from public.clock_entry_audit a where a.clock_entry_id = e.id and a.action in ('create', 'create_manual')) <> 1 then
    raise exception 'PRUEBA L1A · 1: el alta tiene más de un rastro.';
  end if;
  -- Con cobertura, fuera del radio (a ~1,1 km) y en modo avisar: se ficha, con la distancia; la hora, la del servidor aunque mande otra.
  r := public.fichar(yo, 'salida', 'movil', centro, 40.4268, -3.7038, now() - interval '2 hours');
  select * into e from public.clock_entries where id = (r->>'id')::uuid;
  if abs(extract(epoch from (e.real_datetime - now()))) > 5 or abs(extract(epoch from (e.datetime - now()))) > 5 or e.declared_at is not null then
    raise exception 'PRUEBA L1A · 1: con cobertura la hora no es la del servidor.';
  end if;
  if e.within_radius is distinct from false or e.distance_m < 1000 then
    raise exception 'PRUEBA L1A · 1: fuera del radio no queda marcado (%, % m).', e.within_radius, e.distance_m;
  end if;
  -- Lo que no puede.
  begin perform public.fichar(otro, 'entrada', 'movil', centro); raise exception 'PRUEBA L1A · 1: ficha por otro.';
  exception when insufficient_privilege then null; end;
  begin perform public.fichar(yo, 'entrada', 'manual', centro); raise exception 'PRUEBA L1A · 1: ficha «a mano».';
  exception when invalid_parameter_value then null; end;
  begin perform public.fichar(yo, 'entrada', 'tablet', centro, null, null, null, null, null, false, null, null, '4321'); raise exception 'PRUEBA L1A · 1: ficha como tablet.';
  exception when insufficient_privilege then null; end;
  begin perform public.fichar(yo, 'entrada', 'movil', centro, null, null, null, now() - interval '80 hours'); raise exception 'PRUEBA L1A · 1: acepta una hora declarada de hace 80 h.';
  exception when invalid_parameter_value then null; end;
  -- El INSERT directo por otra persona sigue cerrado (1215).
  begin
    insert into public.clock_entries (employee_id, type, datetime, source) values (otro, 'entrada', now(), 'movil');
    raise exception 'PRUEBA L1A · 1: el trabajador inserta un fichaje para otro.';
  exception when insufficient_privilege then null; end;
  -- Lo que ve.
  select count(*) into v_n from public.employees where id <> yo;
  if v_n <> 0 then raise exception 'PRUEBA L1A · 1: el trabajador ve % fichas que no son la suya.', v_n; end if;
  if exists (select 1 from public.empleados_datos_privados((select v::uuid from _s where clave = 'cuenta'))) then
    raise exception 'PRUEBA L1A · 1: el trabajador lee datos privados.';
  end if;
  if not exists (select 1 from public.ausencias_visibles() x where x.employee_id = yo and x.type = 'baja_medica' and not x.motivo_oculto) then
    raise exception 'PRUEBA L1A · 1: no ve su baja como baja.';
  end if;
  if exists (select 1 from public.ausencias_visibles() x where x.employee_id <> yo) then raise exception 'PRUEBA L1A · 1: ve ausencias de otros.'; end if;
  if exists (select 1 from public.clock_correction_request where employee_id <> yo)
     or exists (select 1 from public.employee_notifications where employee_id <> yo)
     or exists (select 1 from public.monthly_balance_closures where employee_id <> yo) then
    raise exception 'PRUEBA L1A · 1: ve peticiones, avisos o bolsa de otros.';
  end if;
  if not exists (select 1 from public.clock_correction_request where employee_id = yo)
     or not exists (select 1 from public.employee_notifications where employee_id = yo)
     or not exists (select 1 from public.monthly_balance_closures where employee_id = yo) then
    raise exception 'PRUEBA L1A · 1: no ve sus peticiones, sus avisos o su bolsa.';
  end if;
  raise notice '1 · trabajador: ficha por sí mismo (hora del servidor; sin cobertura, con la hora declarada); fuera del radio queda marcado; no ficha por otro, ni a mano, ni como tablet; ve solo lo suyo';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 2 · El encargado (local Norte Centro) ──────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
set constraints clock_entry_audit_alta immediate;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
        yo uuid := (select v::uuid from _s where clave = 'yo'); otro uuid := (select v::uuid from _s where clave = 'otro');
        lejano uuid := (select v::uuid from _s where clave = 'lejano');
        centro uuid := (select v::uuid from _s where clave = 'centro'); mercado uuid := (select v::uuid from _s where clave = 'mercado');
        r jsonb;
begin
  if not exists (select 1 from public.employees where id = otro) or not exists (select 1 from public.employees where id = yo) then
    raise exception 'PRUEBA L1A · 2: el encargado no ve a las personas de su local.';
  end if;
  if exists (select 1 from public.employees where id = lejano) then raise exception 'PRUEBA L1A · 2: el encargado ve a una persona de otro local.'; end if;
  if exists (select 1 from public.empleados_datos_privados(a)) then raise exception 'PRUEBA L1A · 2: el encargado lee salario, DNI o nacimiento.'; end if;
  if exists (select 1 from public.payroll_cost) then raise exception 'PRUEBA L1A · 2: el encargado ve nóminas.'; end if;
  if exists (select 1 from public.payroll_inbox) then raise exception 'PRUEBA L1A · 2: el encargado ve la bandeja de nóminas.'; end if;
  if exists (select 1 from public.documents) then raise exception 'PRUEBA L1A · 2: el encargado ve documentos (contratos y nóminas).'; end if;
  if exists (select 1 from public.vacations where type = 'baja_medica') then raise exception 'PRUEBA L1A · 2: el encargado lee una baja médica.'; end if;
  if not exists (select 1 from public.ausencias_visibles() x where x.employee_id = otro and x.type = 'ausente' and x.motivo_oculto and x.notes is null) then
    raise exception 'PRUEBA L1A · 2: la baja del compañero no sale como «ausente».';
  end if;
  if exists (select 1 from public.ausencias_visibles() x where x.type = 'baja_medica') then raise exception 'PRUEBA L1A · 2: ausencias_visibles enseña una baja al encargado.'; end if;
  if not exists (select 1 from public.clock_correction_request where employee_id = otro)
     or not exists (select 1 from public.employee_notifications where employee_id = otro)
     or not exists (select 1 from public.monthly_balance_closures where employee_id = otro) then
    raise exception 'PRUEBA L1A · 2: el encargado no ve las peticiones, los avisos o la bolsa de los suyos.';
  end if;
  if exists (select 1 from public.clock_correction_request where employee_id = lejano)
     or exists (select 1 from public.employee_notifications where employee_id = lejano)
     or exists (select 1 from public.monthly_balance_closures where employee_id = lejano)
     or exists (select 1 from public.clock_entries where employee_id = lejano) then
    raise exception 'PRUEBA L1A · 2: el encargado ve peticiones, avisos, bolsa o fichajes de otro local.';
  end if;
  begin perform public.employee_clock_status(lejano); raise exception 'PRUEBA L1A · 2: ve el estado de fichaje de otro local.';
  exception when raise_exception then if sqlerrm like 'PRUEBA%' then raise; end if; end;
  -- La tablet de su local, con PIN.
  r := public.fichar(otro, 'entrada', 'tablet', centro, null, null, null, null, null, false, null, null, '4321');
  if (select source from public.clock_entries where id = (r->>'id')::uuid) <> 'tablet' then raise exception 'PRUEBA L1A · 2: la tablet no guarda «tablet».'; end if;
  if not exists (select 1 from public.clock_entry_audit a where a.clock_entry_id = (r->>'id')::uuid and a.action = 'create'
                  and a.actor_label = 'manager' and a.reason = 'Fichaje en la tablet del local, con PIN' and (a.after->>'para_otra_persona')::boolean) then
    raise exception 'PRUEBA L1A · 2: el rastro de la tablet no dice quién, por qué ni para quién.';
  end if;
  begin perform public.fichar(lejano, 'entrada', 'tablet', mercado, null, null, null, null, null, false, null, null, '5555'); raise exception 'PRUEBA L1A · 2: ficha en la tablet de otro local.';
  exception when insufficient_privilege then null; end;
  begin perform public.fichar(otro, 'salida', 'tablet', centro, null, null, null, null, null, false, null, null, '0000'); raise exception 'PRUEBA L1A · 2: ficha con el PIN mal.';
  exception when insufficient_privilege then null; end;
  -- La marca a mano: una corrección con motivo, para los suyos.
  perform public.add_manual_clock_entry(otro, 'salida', now() + interval '1 minute', 'Falló el GPS', 'Encargado de la prueba');
  begin perform public.add_manual_clock_entry(lejano, 'entrada', now(), 'Prueba', 'Encargado de la prueba'); raise exception 'PRUEBA L1A · 2: pone una marca a mano a una persona de otro local.';
  exception when raise_exception then if sqlerrm not like 'NO_AUTORIZADO%' then raise; end if; end;
  raise notice '2 · encargado: ve a los de su local y no a los de otro; sin salario, DNI, nacimiento, nóminas ni documentos; la baja, «ausente»; tablet con PIN en su local; marca a mano con motivo a los suyos';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 3 · El administrador ───────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); otro uuid := (select v::uuid from _s where clave = 'otro');
        lejano uuid := (select v::uuid from _s where clave = 'lejano');
begin
  if not exists (select 1 from public.employees where id = lejano) then raise exception 'PRUEBA L1A · 3: el administrador no ve a todos.'; end if;
  if (select salary from public.empleados_datos_privados(a) x where x.id = otro) is distinct from 1999.99 then
    raise exception 'PRUEBA L1A · 3: el administrador no lee el salario.';
  end if;
  if not exists (select 1 from public.ausencias_visibles() x where x.employee_id = otro and x.type = 'baja_medica') then
    raise exception 'PRUEBA L1A · 3: el administrador no ve la baja como baja.';
  end if;
  if not exists (select 1 from public.payroll_cost where employee_id = otro) then raise exception 'PRUEBA L1A · 3: el administrador no ve las nóminas.'; end if;
  raise notice '3 · administrador: todo, con el salario y la baja';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 4 · Otra cuenta ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); otro uuid := (select v::uuid from _s where clave = 'otro');
        centro uuid := (select v::uuid from _s where clave = 'centro');
begin
  if exists (select 1 from public.employees where account_id = a) then raise exception 'PRUEBA L1A · 4: otra cuenta ve personas de la cuenta A.'; end if;
  if exists (select 1 from public.empleados_datos_privados(a)) then raise exception 'PRUEBA L1A · 4: otra cuenta lee datos privados de la A.'; end if;
  begin perform public.fichar(otro, 'salida', 'tablet', centro, null, null, null, null, null, false, null, null, '4321'); raise exception 'PRUEBA L1A · 4: otra cuenta ficha por una persona de la A.';
  exception when insufficient_privilege then null; end;
  raise notice '4 · otra cuenta: nada de la cuenta A';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 5 · La conservación ────────────────────────────────────────────────────
do $$
declare antiguo uuid := (select v::uuid from _s where clave = 'antiguo'); r jsonb; v_n int;
begin
  r := public.conservar_registro_de_jornada();
  if (r->>'coordenadas_borradas')::int < 2 then raise exception 'PRUEBA L1A · 5: no borra las coordenadas de hace 4 meses (%).', r; end if;
  if exists (select 1 from public.clock_entries where employee_id = antiguo and (lat is not null or lng is not null)) then
    raise exception 'PRUEBA L1A · 5: quedan coordenadas de más de 3 meses.';
  end if;
  if not exists (select 1 from public.clock_entries where employee_id = antiguo and type = 'entrada' and within_radius = true and distance_m between 30 and 60 and ubicacion_borrada_at is not null)
     or not exists (select 1 from public.clock_entries where employee_id = antiguo and type = 'salida' and within_radius = false and distance_m > 1000) then
    raise exception 'PRUEBA L1A · 5: al borrar las coordenadas no quedan la distancia y «dentro o fuera».';
  end if;
  if exists (select 1 from public.clock_entries where employee_id = antiguo and datetime < now() - interval '4 years' and (address is not null or anonimizado_at is null)) then
    raise exception 'PRUEBA L1A · 5: la marca de hace 5 años no se ha anonimizado.';
  end if;
  if exists (select 1 from public.clock_entry_audit a join public.clock_entries c on c.id = a.clock_entry_id
              where c.employee_id = antiguo and c.datetime < now() - interval '4 years'
                and (a.actor_user_id is not null or coalesce(a.before, '{}'::jsonb) ? 'address' or coalesce(a.after, '{}'::jsonb) ? 'address')) then
    raise exception 'PRUEBA L1A · 5: el rastro de la marca anonimizada guarda el texto o quién.';
  end if;
  -- La segunda pasada no hace nada, y también deja su fila.
  r := public.conservar_registro_de_jornada();
  select count(*) into v_n from public.registro_conservacion where ejecutado_at >= now() - interval '1 minute';
  if v_n < 2 then raise exception 'PRUEBA L1A · 5: cada pasada no deja su fila.'; end if;
  r := public.conservacion_vigia(48, true);
  if (r->>'aviso') is not null then raise exception 'PRUEBA L1A · 5: el vigía avisa recién pasada la limpieza: %.', r->>'aviso'; end if;
  raise notice '5 · conservación: coordenadas de más de 3 meses fuera (quedan la distancia y «dentro o fuera»), lo de más de 4 años anonimizado, una fila por pasada, el vigía tranquilo';
end $$;

-- ── 6 · Una sola firma ──────────────────────────────────────────────────────
do $$
declare v_mal text;
begin
  select string_agg(n, ', ') into v_mal from (values ('fichar'), ('add_manual_clock_entry'), ('employee_clock_status'), ('_clock_entry_quien_y_hora'),
         ('current_user_ve_persona'), ('ausencias_visibles'), ('empleados_datos_privados'), ('conservar_registro_de_jornada'), ('conservacion_vigia')) x(n)
   where (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = x.n) <> 1;
  if v_mal is not null then raise exception 'PRUEBA L1A · 6: más de una firma (o ninguna): %.', v_mal; end if;
  raise notice '6 · una sola firma de cada una';
end $$;

-- ── 7 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T1905_l1a_fichar_en_el_servidor.down.sql
do $$
declare v_mal text;
begin
  select string_agg(f, ', ') into v_mal from (values
    ('public._clock_entry_quien_y_hora()', '5d27e9182dfb6d35220baaaf604b8885'),
    ('public.add_manual_clock_entry(uuid,text,timestamp with time zone,text,text,boolean)', '1964b700cda80e50b1d4b41c55e23bc8'),
    ('public.employee_clock_status(uuid)', '9bee9822d1f56951a751e49e55707455'),
    ('public._documento_trabajador_puede(text,boolean)', 'f291fb28f539fac6c35378ee8e541ad9')) x(f, h)
   where (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(x.f)) is distinct from x.h;
  if v_mal is not null then raise exception 'PRUEBA L1A · 7: la vuelta atrás no deja como estaban: %.', v_mal; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fichar', 'current_user_ve_persona', 'ausencias_visibles', 'empleados_datos_privados', 'conservar_registro_de_jornada', 'conservacion_vigia'))
     or to_regclass('public.registro_conservacion') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clock_entries' and column_name in ('distance_m', 'within_radius', 'declared_at'))
     or exists (select 1 from public.funcion_respaldo where migracion = '20261027T1905_l1a_fichar_en_el_servidor') then
    raise exception 'PRUEBA L1A · 7: la vuelta atrás deja cosas de la 1905.';
  end if;
  raise notice '7 · la vuelta atrás: las cuatro funciones con la huella de producción, y nada de la 1905';
end $$;

rollback;
