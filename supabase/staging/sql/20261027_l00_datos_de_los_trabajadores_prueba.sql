-- supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
--
-- SOLO STAGING. Prueba de la 1215 (L00 · Respuesta 1 · cerrar los datos de los
-- trabajadores), con \i dentro de la transacción y ROLLBACK: staging no cambia.
--
-- Entra COMO CADA UNO (regla 10: por los caminos, no por el texto), en la cuenta
-- A, con su sesión de verdad (request.jwt.claims + role authenticated):
--   · el trabajador de prueba (a.trabajador@, rol worker), enlazado DENTRO de la
--     transacción a una ficha limpia, sin fichajes;
--   · el encargado de prueba (a.encargado@, rol manager);
--   · el administrador de la cuenta A.
-- Y un compañero inventado en el mismo local, con salario, DNI, PIN, una baja,
-- una nómina, un documento y un fichaje.
--
-- LO QUE VE CADA UNO (la lista va también en el PR):
--   trabajador · ve: su ficha, sus fichajes, sus vacaciones, su nómina, sus
--                documentos, sus peticiones de corrección, sus avisos, su bolsa
--                de horas, los compañeros (nombre, foto y puesto) por
--                companeros_de_trabajo, su estado de fichaje.
--              · no ve: la ficha del compañero (ni salario, ni DNI, ni PIN),
--                sus fichajes ni su GPS ni su rastro, su baja, su nómina, sus
--                documentos, sus peticiones, sus avisos, su bolsa de horas, el
--                estado de fichaje del compañero, la bandeja de nóminas, ningún PIN.
--              · no puede: fichar por otro, poner una marca «manual», leer o
--                subir los PDF de otro, subir los suyos, llamar a las cuatro
--                funciones sin guarda.
--              · ficha: con la hora del servidor aunque mande otra, y deja rastro.
--   encargado  · ve lo de hoy: las fichas con salario, los fichajes, las bajas,
--                las nóminas; lee los PDF de la cuenta (no sube ni borra).
--              · comprueba el PIN en el servidor (kiosko_comprobar_pin) y ficha
--                por el compañero desde el kiosko, con rastro «para otra persona».
--   administrador · sube y borra los PDF; guarda un PIN nuevo (va a la tabla
--                aparte; employees.pin queda vacío); su corrección manual deja un
--                solo «create_manual», sin duplicar.
--   y al final, la vuelta atrás deja la huella de antes.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L00 DATOS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('local', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7'), ('md5_estado', '63df15da0ba31c9c188996755be51d11');

-- Los tres usuarios de prueba existen, con su papel.
do $$
declare v_falta text;
begin
  select string_agg(x.c || ' (' || x.rol || ')', ', ') into v_falta
    from (values ('admin', 'admin'), ('encargado', 'manager'), ('trabajador', 'worker')) x(c, rol)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = 'cuenta') and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA L00 DATOS · faltan los usuarios de prueba de la cuenta A: %.', v_falta; end if;
end $$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.employee_clock_status(uuid)'::regprocedure) is distinct from (select v from _s where clave = 'md5_estado') then
    raise exception 'PRUEBA L00 DATOS · 0: employee_clock_status no es la de producción.';
  end if;
  raise notice '0 · lo de antes: employee_clock_status con el md5 de producción';
end $$;

-- La ficha limpia del trabajador y el compañero, inventados.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l uuid := (select v::uuid from _s where clave = 'local');
        yo uuid; otro uuid;
begin
  insert into public.employees (name, location_id, account_id, "position", salary, dni, pin)
  values ('Trabajador de la prueba L00', l, a, 'Cocina', 1000, '00000000T', null) returning id into yo;
  insert into public.employees (name, location_id, account_id, "position", salary, dni, pin, birth_date)
  values ('Compañero de la prueba L00', l, a, 'Sala', 1999.99, '11111111H', '4321', date '1990-01-01') returning id into otro;
  update public.user_profiles set employee_id = yo
   where user_id = (select v::uuid from _s where clave = 'trabajador') and account_id = a;
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, lat, lng)
  values (otro, 'entrada', now() - interval '2 hours', now() - interval '2 hours', 'movil', 40.4, -3.6);
  insert into public.vacations (employee_id, account_id, type, start_date, end_date, days, status)
  values (otro, a, 'baja_medica', current_date, current_date + 3, 4, 'aprobada'),
         (yo, a, 'vacaciones', current_date + 30, current_date + 31, 2, 'aprobada');
  insert into public.payroll_cost (account_id, employee_id, period_year, period_month, status, gross, source)
  values (a, otro, 2026, 9, 'definitiva', 1999.99, 'nomina_upload'), (a, yo, 2026, 9, 'definitiva', 1000, 'nomina_upload');
  insert into public.documents (employee_id, type, name, file_path, file_size_kb, uploaded_role)
  values (otro, 'nomina', 'Nómina del compañero', otro::text || '/n.pdf', 10, 'gestor'),
         (yo, 'nomina', 'Mi nómina', yo::text || '/n.pdf', 10, 'gestor');
  insert into public.clock_correction_request (account_id, employee_id, requested_by_employee_id, kind, reason)
  values (a, otro, otro, 'add', 'Olvido del compañero'), (a, yo, yo, 'add', 'Mi olvido');
  insert into public.employee_notifications (employee_id, account_id, type, title, body)
  values (otro, a, 'aviso', 'Para el compañero', 'Privado'), (yo, a, 'aviso', 'Para mí', 'Mío');
  insert into public.monthly_balance_closures (employee_id, location_id, account_id, period_label, period_start, period_end)
  values (otro, l, a, '2026-09', date '2026-09-01', date '2026-09-30'), (yo, l, a, '2026-09', date '2026-09-01', date '2026-09-30');
  insert into _s values ('yo', yo::text), ('otro', otro::text);
end $$;

-- ── 1 · Con la 1215 ─────────────────────────────────────────────────────────
\i supabase/migrations/20261027T1215_l00_datos_de_los_trabajadores.sql

do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro');
begin
  if (select pin from public.employees where id = otro) is not null then raise exception 'PRUEBA L00 DATOS · 1: el PIN sigue en employees.'; end if;
  if (select pin from public.employee_kiosk_pin where employee_id = otro) is distinct from '4321' then raise exception 'PRUEBA L00 DATOS · 1: el PIN no ha pasado a employee_kiosk_pin.'; end if;
  if (select public from storage.buckets where id = 'employee-documents') then raise exception 'PRUEBA L00 DATOS · 1: el almacén sigue público.'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon_all_employee_documents') then raise exception 'PRUEBA L00 DATOS · 1: sigue anon_all.'; end if;
  raise notice '1 · aplicada: el almacén privado y sin anon_all; el PIN, fuera de employees';
end $$;

-- ── 2 · Como el TRABAJADOR ──────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare yo uuid := (select v::uuid from _s where clave = 'yo'); otro uuid := (select v::uuid from _s where clave = 'otro');
        l uuid := (select v::uuid from _s where clave = 'local'); v_n int; v_ok boolean; r record; v_entrada uuid;
begin
  -- Lo suyo, sí.
  if not exists (select 1 from public.employees where id = yo) then raise exception 'PRUEBA L00 DATOS · 2: el trabajador no ve su ficha.'; end if;
  if not exists (select 1 from public.vacations where employee_id = yo) then raise exception 'PRUEBA L00 DATOS · 2: no ve sus vacaciones.'; end if;
  if not exists (select 1 from public.payroll_cost where employee_id = yo) then raise exception 'PRUEBA L00 DATOS · 2: no ve su nómina.'; end if;
  if not exists (select 1 from public.documents where employee_id = yo) then raise exception 'PRUEBA L00 DATOS · 2: no ve sus documentos.'; end if;
  perform public.employee_clock_status(yo);
  -- Lo del compañero, no.
  select count(*) into v_n from public.employees where id <> yo;
  if v_n <> 0 then raise exception 'PRUEBA L00 DATOS · 2: el trabajador ve % fichas que no son la suya.', v_n; end if;
  if exists (select 1 from public.clock_entries where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve los fichajes del compañero.'; end if;
  if exists (select 1 from public.vacations where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve la baja del compañero.'; end if;
  if exists (select 1 from public.payroll_cost where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve la nómina del compañero.'; end if;
  if exists (select 1 from public.documents where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve los documentos del compañero.'; end if;
  if exists (select 1 from public.payroll_inbox) then raise exception 'PRUEBA L00 DATOS · 2: ve la bandeja de nóminas.'; end if;
  if exists (select 1 from public.clock_correction_request where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve las peticiones de corrección del compañero.'; end if;
  if not exists (select 1 from public.clock_correction_request where employee_id = yo) then raise exception 'PRUEBA L00 DATOS · 2: no ve sus peticiones de corrección.'; end if;
  if exists (select 1 from public.employee_notifications where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve los avisos del compañero.'; end if;
  if not exists (select 1 from public.employee_notifications where employee_id = yo) then raise exception 'PRUEBA L00 DATOS · 2: no ve sus avisos.'; end if;
  if exists (select 1 from public.monthly_balance_closures where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve la bolsa de horas del compañero.'; end if;
  if not exists (select 1 from public.monthly_balance_closures where employee_id = yo) then raise exception 'PRUEBA L00 DATOS · 2: no ve su bolsa de horas.'; end if;
  if exists (select 1 from public.clock_entry_audit where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 2: ve el rastro de fichajes del compañero.'; end if;
  v_ok := false; begin perform public.employee_clock_status(otro); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: ve el estado de fichaje del compañero.'; end if;
  v_ok := false; begin perform 1 from public.employee_kiosk_pin; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: puede leer los PIN.'; end if;
  v_ok := false; begin perform public.kiosko_comprobar_pin(otro, '4321'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: puede probar el PIN de otro.'; end if;
  v_ok := false; begin perform public.migrate_locations_and_staff(gen_random_uuid(), gen_random_uuid(), false); exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: puede llamar a migrate_locations_and_staff.'; end if;
  v_ok := false; begin perform * from public.location_labor_cost(l, now() - interval '30 days', now()); exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: puede llamar a location_labor_cost.'; end if;
  -- Los compañeros: nombre, foto y puesto.
  select * into r from public.companeros_de_trabajo(array[l]) c where c.id = otro;
  if r.id is null or r.name is distinct from 'Compañero de la prueba L00' or r."position" is distinct from 'Sala' then
    raise exception 'PRUEBA L00 DATOS · 2: companeros_de_trabajo no da al compañero con su nombre y su puesto.';
  end if;
  -- Los PDF: los suyos sí, los del compañero no; subir, tampoco los suyos.
  if not public._documento_trabajador_puede(yo::text || '/n.pdf', false) then raise exception 'PRUEBA L00 DATOS · 2: no puede leer su PDF.'; end if;
  if public._documento_trabajador_puede(otro::text || '/n.pdf', false) then raise exception 'PRUEBA L00 DATOS · 2: puede leer el PDF del compañero.'; end if;
  if public._documento_trabajador_puede(yo::text || '/n.pdf', true) then raise exception 'PRUEBA L00 DATOS · 2: puede subir PDF.'; end if;
  if public._documento_trabajador_puede('_inbox/' || (select v from _s where clave = 'cuenta') || '/x.pdf', false) then raise exception 'PRUEBA L00 DATOS · 2: puede leer la bandeja de nóminas.'; end if;
  -- Fichar por otro, no; una marca «manual», no.
  v_ok := false;
  begin insert into public.clock_entries (employee_id, type, datetime, real_datetime, source) values (otro, 'salida', now(), now(), 'movil');
  exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: ha podido fichar por el compañero.'; end if;
  v_ok := false;
  begin insert into public.clock_entries (employee_id, type, datetime, real_datetime, source) values (yo, 'entrada', now(), now(), 'manual');
  exception when others then v_ok := sqlstate = '42501'; end;
  if not v_ok then raise exception 'PRUEBA L00 DATOS · 2: ha podido poner una marca manual.'; end if;
  -- Fichar por sí mismo, con la hora que mande: se queda la del servidor.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source)
  values (yo, 'entrada', timestamptz '2020-01-01 09:00+00', timestamptz '2020-01-01 09:00+00', 'movil') returning id into v_entrada;
  set constraints clock_entry_audit_alta immediate;
  insert into _s values ('entrada_yo', v_entrada::text);
  raise notice '2 · trabajador: ve lo suyo y nada del compañero; ficha solo por sí mismo';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set constraints clock_entry_audit_alta deferred;

do $$
declare v_id uuid := (select v::uuid from _s where clave = 'entrada_yo'); r record; a record;
begin
  select * into r from public.clock_entries where id = v_id;
  if abs(extract(epoch from (r.real_datetime - now()))) > 60 or abs(extract(epoch from (r.datetime - now()))) > 60 then
    raise exception 'PRUEBA L00 DATOS · 2: no se ha quedado la hora del servidor (real %, efectiva %).', r.real_datetime, r.datetime;
  end if;
  select * into a from public.clock_entry_audit where clock_entry_id = v_id and action = 'create';
  if a.id is null or a.reason is distinct from 'Fichaje propio' or (a.after->>'via') is distinct from 'movil' or (a.after->>'para_otra_persona')::boolean
     or a.actor_user_id is distinct from (select v::uuid from _s where clave = 'trabajador') then
    raise exception 'PRUEBA L00 DATOS · 2: el alta propia no deja el rastro esperado (%).', to_jsonb(a);
  end if;
  raise notice '2 · el fichaje propio: hora del servidor, y rastro «create · Fichaje propio · movil»';
end $$;

-- ── 3 · Como el ENCARGADO ───────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro'); v_entrada uuid; v_sal numeric;
begin
  select salary into v_sal from public.employees where id = otro;
  if v_sal is distinct from 1999.99 then raise exception 'PRUEBA L00 DATOS · 3: el encargado ya no ve el salario (ve %).', v_sal; end if;
  if not exists (select 1 from public.clock_entries where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no ve los fichajes.'; end if;
  if not exists (select 1 from public.vacations where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no ve las bajas.'; end if;
  if not exists (select 1 from public.payroll_cost where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no ve las nóminas.'; end if;
  if not exists (select 1 from public.clock_correction_request where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no ve las peticiones.'; end if;
  if not exists (select 1 from public.employee_notifications where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no ve los avisos.'; end if;
  if not exists (select 1 from public.monthly_balance_closures where employee_id = otro) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no ve la bolsa de horas.'; end if;
  perform public.employee_clock_status(otro);
  if not public._documento_trabajador_puede(otro::text || '/n.pdf', false) then raise exception 'PRUEBA L00 DATOS · 3: el encargado no lee los PDF.'; end if;
  if public._documento_trabajador_puede(otro::text || '/n.pdf', true) then raise exception 'PRUEBA L00 DATOS · 3: el encargado puede subir PDF.'; end if;
  if not public.kiosko_comprobar_pin(otro, '4321') then raise exception 'PRUEBA L00 DATOS · 3: el PIN bueno no entra.'; end if;
  if public.kiosko_comprobar_pin(otro, '0000') then raise exception 'PRUEBA L00 DATOS · 3: entra un PIN malo.'; end if;
  if not exists (select 1 from public.kiosko_con_pin(array[otro]) x where x = otro) then raise exception 'PRUEBA L00 DATOS · 3: kiosko_con_pin no lo da.'; end if;
  -- Desde el kiosko, ficha la salida del compañero.
  insert into public.clock_entries (employee_id, type, datetime, real_datetime, source, address)
  values (otro, 'salida', now(), now(), 'kiosko', 'Kiosko con PIN') returning id into v_entrada;
  set constraints clock_entry_audit_alta immediate;
  insert into _s values ('salida_otro', v_entrada::text);
  raise notice '3 · encargado: ve lo de hoy, comprueba el PIN en el servidor y ficha por el compañero';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set constraints clock_entry_audit_alta deferred;

do $$
declare a record;
begin
  select * into a from public.clock_entry_audit where clock_entry_id = (select v::uuid from _s where clave = 'salida_otro') and action = 'create';
  if a.id is null or not (a.after->>'para_otra_persona')::boolean or a.actor_label is distinct from 'manager' or a.reason is distinct from 'Kiosko con PIN' then
    raise exception 'PRUEBA L00 DATOS · 3: la marca para otra persona no deja el rastro esperado (%).', to_jsonb(a);
  end if;
  raise notice '3 · la marca para otra persona: rastro con quién (manager), por qué y por qué vía (kiosko)';
end $$;

-- ── 4 · Como el ADMINISTRADOR ───────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro'); v_m public.clock_entries;
begin
  if not public._documento_trabajador_puede(otro::text || '/n.pdf', true) then raise exception 'PRUEBA L00 DATOS · 4: el administrador no puede subir PDF.'; end if;
  if not public._documento_trabajador_puede('_inbox/' || (select v from _s where clave = 'cuenta') || '/x.pdf', false) then raise exception 'PRUEBA L00 DATOS · 4: el administrador no lee la bandeja.'; end if;
  -- Un PIN nuevo desde la ficha: va a la tabla aparte.
  update public.employees set pin = '5555' where id = otro;
  if (select pin from public.employees where id = otro) is not null then raise exception 'PRUEBA L00 DATOS · 4: el PIN nuevo se queda en employees.'; end if;
  if not public.kiosko_comprobar_pin(otro, '5555') then raise exception 'PRUEBA L00 DATOS · 4: el PIN nuevo no entra.'; end if;
  -- Guardar la ficha sin PIN (la ficha ya no lo ve) no borra el que había.
  update public.employees set pin = null, notes = 'guardada sin PIN' where id = otro;
  if not public.kiosko_comprobar_pin(otro, '5555') then raise exception 'PRUEBA L00 DATOS · 4: guardar la ficha sin PIN ha borrado el PIN.'; end if;
  -- Una corrección manual: un solo create_manual, sin «create» duplicado.
  select * into v_m from public.add_manual_clock_entry(otro, 'entrada', now() + interval '1 minute', 'Olvidó fichar (prueba L00)', 'admin de prueba', false);
  set constraints clock_entry_audit_alta immediate;
  insert into _s values ('manual_otro', v_m.id::text);
  raise notice '4 · administrador: sube PDF, guarda el PIN aparte y corrige a mano';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set constraints clock_entry_audit_alta deferred;

do $$
declare v_id uuid := (select v::uuid from _s where clave = 'manual_otro'); v_c int; v_m int;
begin
  select count(*) filter (where action = 'create'), count(*) filter (where action = 'create_manual') into v_c, v_m from public.clock_entry_audit where clock_entry_id = v_id;
  if v_c <> 0 or v_m <> 1 then raise exception 'PRUEBA L00 DATOS · 4: la corrección manual deja % create y % create_manual (tenía que ser 0 y 1).', v_c, v_m; end if;
  raise notice '4 · la corrección manual: un solo create_manual';
end $$;

-- ── 5 · Una sola firma de cada función ──────────────────────────────────────
do $$
declare v_mal text;
begin
  select string_agg(proname || ' (' || n || ')', ', ') into v_mal from (
    select proname, count(*) n from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('employee_clock_status', 'companeros_de_trabajo', 'kiosko_comprobar_pin', 'kiosko_con_pin', '_documento_trabajador_puede', '_clock_entry_quien_y_hora', '_clock_entry_audit_alta', '_employee_pin_guardar')
     group by proname) x where n <> 1;
  if v_mal is not null then raise exception 'PRUEBA L00 DATOS · 5: sobrecargas: %.', v_mal; end if;
  raise notice '5 · una sola firma de cada una';
end $$;

-- ── 6 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T1215_l00_datos_de_los_trabajadores.down.sql

do $$
declare otro uuid := (select v::uuid from _s where clave = 'otro');
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.employee_clock_status(uuid)'::regprocedure) is distinct from (select v from _s where clave = 'md5_estado') then
    raise exception 'PRUEBA L00 DATOS · 6: la vuelta atrás no deja employee_clock_status como estaba.';
  end if;
  if (select pin from public.employees where id = otro) is distinct from '5555' then raise exception 'PRUEBA L00 DATOS · 6: la vuelta atrás no devuelve el PIN a employees.'; end if;
  if not (select public from storage.buckets where id = 'employee-documents') then raise exception 'PRUEBA L00 DATOS · 6: la vuelta atrás no deja el almacén como estaba.'; end if;
  if to_regclass('public.employee_kiosk_pin') is not null or to_regprocedure('public.companeros_de_trabajo(uuid[])') is not null then
    raise exception 'PRUEBA L00 DATOS · 6: la vuelta atrás deja cosas de la 1215.';
  end if;
  if not has_function_privilege('authenticated', 'public.location_labor_cost(uuid,timestamptz,timestamptz)'::regprocedure, 'execute') then
    raise exception 'PRUEBA L00 DATOS · 6: la vuelta atrás no devuelve los permisos.';
  end if;
  raise notice '6 · la vuelta atrás: todo como estaba (y la auditoría sigue admitiendo «create», a propósito)';
end $$;

rollback;
