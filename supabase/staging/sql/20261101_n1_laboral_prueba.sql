-- supabase/staging/sql/20261101_n1_laboral_prueba.sql
--
-- SOLO STAGING. Prueba de la tanda del N1 · PR 1 (1937 el modelo, 1938 el
-- volcado de Cegid, 1939 public.empleados_datos_privados con el permiso de
-- Laboral), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role): el
-- administrador y el encargado de la cuenta A, y el administrador de la B.
-- Todo INVENTADO: NIF 00000000T…, nombres «Persona Inventada …».
--
--   0 · lo de antes: nada de la tanda; la 0850 y la 0950, puestas.
--   1 · el permiso de Laboral: el encargado no ve lo privado por ser
--       encargado; con el permiso, sí (empleados_datos_privados y las tablas
--       lab_*); sin él otra vez, no. Solo el administrador lo da.
--   2 · el volcado con un centro sin confirmar: nadie de ese centro entra, y
--       la fila lo dice.
--   3 · confirmado el centro: la persona que ya estaba se completa sin pisar
--       nada; la baja que faltaba entra de baja, en su local, sin cursos de
--       bienvenida, con su contrato cerrado; la de alta que falta no se crea
--       y lo dice; los conceptos, convenio + pactado, y si no cuadra con la
--       nómina de Cegid, las dos cifras.
--   4 · otra vez: no duplica nada.
--   5 · nadie más: ni el encargado, ni el administrador de otra cuenta.
--   6 · la vuelta atrás, en orden inverso.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
-- La 1937 y la 1938 solo añaden y pueden estar ya de verdad (W05); la 1939
-- solo si se aplicó (entonces lleva current_user_ve_laboral).
select position('current_user_ve_laboral' in pg_get_functiondef('public.empleados_datos_privados(uuid)'::regprocedure)) > 0 as n1_1939 \gset
\if :n1_1939
\i supabase/vuelta-atras/20261101T1939_n1_datos_privados_laboral.down.sql
\endif
select to_regprocedure('public.lab_volcar_lote(uuid)') is not null as n1_1938 \gset
\if :n1_1938
\i supabase/vuelta-atras/20261101T1938_n1_volcado_cegid.down.sql
\endif
select to_regclass('public.lab_permiso') is not null as n1_1937 \gset
\if :n1_1937
\i supabase/vuelta-atras/20261101T1937_n1_laboral_modelo.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert, update on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_emp uuid; v_loc1 uuid; v_loc2 uuid;
begin
  if to_regclass('public.lab_import_lote') is null or to_regprocedure('public.lab_import_cargar_filas(uuid,text,integer,jsonb)') is null then
    raise exception 'PRUEBA N1 · 0: falta la 0850 o la 0950 (el importador de Cegid).';
  end if;
  if to_regclass('public.lab_permiso') is not null or to_regprocedure('public.lab_volcar_lote(uuid)') is not null then
    raise exception 'PRUEBA N1 · 0: ya hay algo de la tanda antes de aplicarla.';
  end if;
  select id into v_loc1 from public.locations where account_id = a order by name limit 1;
  select id into v_loc2 from public.locations where account_id = a and id <> v_loc1 order by name limit 1;
  select id into v_emp from public.employees where account_id = a and active order by created_at limit 1;
  if v_loc1 is null or v_emp is null then raise exception 'PRUEBA N1 · 0: la cuenta A necesita un local y una persona activa.'; end if;
  -- La persona que ya está, con un NIF inventado y en el primer local.
  update public.employees set dni = '00000000-t', email = null, location_id = v_loc1 where id = v_emp;
  -- Un itinerario de bienvenida inventado, para que «sin cursos» pueda fallar:
  -- una ficha nueva normal (control, con su local) sí lo recibe.
  insert into public.training_path (account_id, name, roles, business_types, active) values (a, 'Bienvenida inventada N1', '{}', '{}', true);
  insert into public.employees (account_id, location_id, name, active) values (a, v_loc1, 'Control Inventado N1', true) returning id into v_emp;
  if not exists (select 1 from public.training_path_progress where employee_id = v_emp) then
    raise exception 'PRUEBA N1 · 0: el control no recibe la bienvenida: la comprobación de la baja no podría fallar.';
  end if;
  update public.employees set active = false where id = v_emp;  -- se queda (ROLLBACK), apartado
  select id into v_emp from public.employees where account_id = a and active order by created_at limit 1;
  insert into _s values ('emp', v_emp::text), ('loc1', v_loc1::text), ('loc1_nombre', (select name from public.locations where id = v_loc1)),
                        ('loc2', coalesce(v_loc2, v_loc1)::text);
  raise notice '0 · lo de antes: nada de la tanda; la 0850 y la 0950 puestas';
end $$;

\i supabase/migrations/20261101T1937_n1_laboral_modelo.sql
\i supabase/migrations/20261101T1938_n1_volcado_cegid.sql
\i supabase/migrations/20261101T1939_n1_datos_privados_laboral.sql
-- Solo añaden (la 1939 cambia con la misma firma): se pueden pasar dos veces.
\i supabase/migrations/20261101T1937_n1_laboral_modelo.sql
\i supabase/migrations/20261101T1938_n1_volcado_cegid.sql

-- ── 1 · El permiso de Laboral ───────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); enc uuid := (select v::uuid from _s where clave = 'encargado');
begin
  if public.current_user_ve_laboral(a) then raise exception 'PRUEBA N1 · 1: el encargado ve Laboral sin permiso.'; end if;
  if exists (select 1 from public.empleados_datos_privados(a)) then raise exception 'PRUEBA N1 · 1: el encargado lee lo privado sin permiso.'; end if;
  begin
    perform public.lab_dar_permiso(a, enc);
    raise exception 'PRUEBA N1 · 1: el encargado se da el permiso a sí mismo.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); r jsonb;
begin
  if not public.current_user_ve_laboral(a) then raise exception 'PRUEBA N1 · 1: el administrador no ve Laboral.'; end if;
  if not exists (select 1 from public.empleados_datos_privados(a)) then raise exception 'PRUEBA N1 · 1: el administrador no lee lo privado.'; end if;
  r := public.lab_dar_permiso(a, (select v::uuid from _s where clave = 'encargado'));
  if (r ->> 'con_permiso')::int <> 1 then raise exception 'PRUEBA N1 · 1: dar el permiso devuelve %.', r; end if;
  begin
    perform public.lab_dar_permiso(a, (select v::uuid from _s where clave = 'admin_b'));
    raise exception 'PRUEBA N1 · 1: se da el permiso a alguien de otra cuenta.';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta');
begin
  if not public.current_user_ve_laboral(a) then raise exception 'PRUEBA N1 · 1: con el permiso, el encargado no ve Laboral.'; end if;
  if not exists (select 1 from public.empleados_datos_privados(a) where dni = '00000000-t') then
    raise exception 'PRUEBA N1 · 1: con el permiso, el encargado no lee el DNI.';
  end if;
  begin
    insert into public.lab_persona (employee_id, account_id) values ((select v::uuid from _s where clave = 'emp'), a);
    raise exception 'PRUEBA N1 · 1: con el permiso se escribe directo en lab_persona.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); r jsonb;
begin
  r := public.lab_quitar_permiso(a, (select v::uuid from _s where clave = 'encargado'));
  if (r ->> 'con_permiso')::int <> 0 then raise exception 'PRUEBA N1 · 1: quitar el permiso devuelve %.', r; end if;
  raise notice '1 · el permiso: el encargado no ve lo privado; con el permiso, sí; sin él, no. Solo lo da el administrador';
end $$;

-- ── 2 · Un lote inventado, con un centro sin confirmar ──────────────────────
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l jsonb; c text := (select v from _s where clave = 'loc1_nombre'); r jsonb;
begin
  l := public.lab_import_leer_cabeceras(a, 'paquete n1 inventado.xlsx', repeat('cd', 32),
    '[{"nombre":"Trabajadores","columnas":["trabajador","nombre","nif"],"filas":4},{"nombre":"Contratos","columnas":["trabajador","contrato_n"],"filas":3}]',
    '{"completa":true}');
  insert into _s values ('lote', l ->> 'id');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'empresa', 1,
    '[{"campo":"CCC","valor":"28000000000"},{"campo":"convenio","valor":"CONV1"}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'convenio', 1,
    '[{"campo":"código ERP10","valor":"CONV1"},{"campo":"nombre","valor":"Convenio inventado"},{"campo":"horas anuales","valor":1780}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'tablas_salariales', 1,
    '[{"convenio":"CONV1","categoria":"AYU","categoria_nombre":"Ayudante","concepto":"001","concepto_nombre":"Salario base","importe":1200,"modo_pago":"Mensual"},'
    '{"convenio":"CONV1","categoria":"AYU","concepto":"013","concepto_nombre":"Paga extra","importe":1200,"modo_pago":"Paga"}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'conceptos', 1,
    '[{"codigo":"001","concepto":"Salario base","tipo":"Devengo"},{"codigo":"050","concepto":"Plus pactado","tipo":"Devengo"},{"codigo":"900","concepto":"IRPF","tipo":"Deducción"}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'trabajadores', 1, jsonb_build_array(
    jsonb_build_object('trabajador', '1', 'nombre', 'Persona Inventada Uno', 'nif', '00000000T', 'naf', '280000000000', 'iban', 'ES0099990000000000000000',
                       'centro', c, 'convenio', 'CONV1', 'categoria', 'AYU', 'puesto', 'Ayudante', 'email', 'uno@prueba.test', 'en_alta_hoy', 'S'),
    jsonb_build_object('trabajador', '2', 'nombre', 'Persona Inventada Dos', 'nif', '00000001R', 'nacimiento', '1990-01-01',
                       'centro', c, 'convenio', 'CONV1', 'categoria', 'AYU', 'puesto', 'Ayudante', 'en_alta_hoy', 'N'),
    jsonb_build_object('trabajador', '3', 'nombre', 'Persona Inventada Tres', 'nif', '00000002W', 'centro', c, 'en_alta_hoy', 'S'),
    jsonb_build_object('trabajador', '4', 'nombre', 'Persona Inventada Cuatro', 'nif', '00000003A', 'centro', 'Centro que no existe', 'en_alta_hoy', 'N')));
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'contratos', 1,
    '[{"trabajador":"1","contrato_n":"1","fecha_alta":"2024-03-01","tipo_contrato":"100","grupo_cotizacion":"7","puesto":"Ayudante","convenio":"CONV1"},'
    '{"trabajador":"2","contrato_n":"1","fecha_alta":"2023-01-10","fecha_fin":"2024-06-30","tipo_contrato":"401","coef_parcial":500,"convenio":"CONV1"},'
    '{"trabajador":"4","contrato_n":"1","fecha_alta":"2022-01-01","fecha_fin":"2022-12-31","tipo_contrato":"401"}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'nominas', 1,
    '[{"anio":2026,"mes":9,"trabajador":"1","Devengado":1400,"Retención":150,"Base I.R.P.F.":1400},'
    '{"anio":2026,"mes":8,"trabajador":"1","Devengado":1350}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'nominas_conceptos', 1,
    '[{"anio":2026,"mes":9,"trabajador":"1","tipo":"Devengo","concepto_codigo":"001","concepto":"Salario base","importe":1200},'
    '{"anio":2026,"mes":9,"trabajador":"1","tipo":"Devengo","concepto_codigo":"050","concepto":"Plus pactado","importe":150},'
    '{"anio":2026,"mes":9,"trabajador":"1","tipo":"Deducción","concepto_codigo":"900","concepto":"IRPF","importe":150}]');

  r := public.lab_centros_del_lote((l ->> 'id')::uuid);
  if jsonb_array_length(r) <> 2 or (select count(*) from jsonb_array_elements(r) x where x -> 'confirmado' <> 'null'::jsonb) <> 0 then
    raise exception 'PRUEBA N1 · 2: los centros del lote salen %.', r;
  end if;
  if (select (x -> 'propuesto' ->> 'id') from jsonb_array_elements(r) x where x ->> 'centro' = c) <> (select v from _s where clave = 'loc1') then
    raise exception 'PRUEBA N1 · 2: el local propuesto por el nombre no es el suyo: %.', r;
  end if;

  r := public.lab_volcar_lote((l ->> 'id')::uuid);
  if (r ->> 'personas')::int <> 0 or jsonb_array_length(r -> 'centros_sin_confirmar') <> 2 then
    raise exception 'PRUEBA N1 · 2: sin centros confirmados ha entrado alguien: %.', r;
  end if;
  if not exists (select 1 from public.lab_import_fila where lote_id = (l ->> 'id')::uuid and hoja = 'trabajadores' and estado = 'aviso'
                    and mensajes[1] like '%no tiene local confirmado%') then
    raise exception 'PRUEBA N1 · 2: la fila no dice que falta confirmar el centro.';
  end if;
  raise notice '2 · sin el centro confirmado, nadie entra, y la fila lo dice';
end $$;

-- ── 3 · Confirmado el centro, el volcado ────────────────────────────────────
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); loc uuid := (select v::uuid from _s where clave = 'loc1');
begin
  perform public.lab_confirmar_centro(lote, (select v from _s where clave = 'loc1_nombre'), loc);
  insert into _s values ('r1', public.lab_volcar_lote(lote)::text);
end $$;
-- Lo que ha dejado, mirado como postgres (el DNI de employees está cerrado a la sesión).
reset role;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); emp uuid := (select v::uuid from _s where clave = 'emp');
        loc uuid := (select v::uuid from _s where clave = 'loc1'); r jsonb := (select v::jsonb from _s where clave = 'r1');
        v_baja public.employees; n int;
begin
  if (r ->> 'personas')::int <> 2 or (r ->> 'nuevas_de_baja')::int <> 1 or (r ->> 'ya_estaban')::int <> 1 or (r ->> 'contratos')::int <> 2 then
    raise exception 'PRUEBA N1 · 3: el volcado devuelve %.', r;
  end if;
  -- La que ya estaba: lo vacío relleno, lo demás igual.
  if (select email from public.employees where id = emp) <> 'uno@prueba.test' or (select dni from public.employees where id = emp) <> '00000000-t' then
    raise exception 'PRUEBA N1 · 3: la persona que ya estaba no se ha completado bien.';
  end if;
  if (select naf from public.lab_persona where employee_id = emp) <> '280000000000' then raise exception 'PRUEBA N1 · 3: sin su NAF en lab_persona.'; end if;
  -- La baja que faltaba.
  select e.* into v_baja from public.employees e where e.account_id = a and public._lab_nif(e.dni) = '00000001R';
  if v_baja.id is null or v_baja.active or v_baja.location_id is distinct from loc or v_baja.birth_date <> date '1990-01-01' then
    raise exception 'PRUEBA N1 · 3: la baja no ha entrado como baja en su local.';
  end if;
  select count(*) into n from public.training_path_progress where employee_id = v_baja.id;
  if n > 0 then raise exception 'PRUEBA N1 · 3: a la baja le han tocado % itinerarios de bienvenida.', n; end if;
  if (select fecha_baja from public.lab_contrato where employee_id = v_baja.id) <> date '2024-06-30' then
    raise exception 'PRUEBA N1 · 3: el contrato de la baja no está cerrado con su fecha.';
  end if;
  if (select jornada from public.lab_contrato_condicion cc join public.lab_contrato c on c.id = cc.contrato_id where c.employee_id = v_baja.id) <> 'parcial' then
    raise exception 'PRUEBA N1 · 3: el contrato con coeficiente 500 no sale a jornada parcial.';
  end if;
  -- La de alta que falta: no se crea, y lo dice.
  if exists (select 1 from public.employees where account_id = a and public._lab_nif(dni) = '00000002W') then
    raise exception 'PRUEBA N1 · 3: se ha creado una persona de alta que no estaba (no lo decidió Julio).';
  end if;
  if not exists (select 1 from jsonb_array_elements_text(r -> 'mensajes') m where m like 'Persona Inventada Tres: en Cegid está de alta%') then
    raise exception 'PRUEBA N1 · 3: no dice que la de alta que falta no se crea: %.', r -> 'mensajes';
  end if;
  -- Lo que cobra: convenio (1200 al mes + una paga) y pactado (150); la nómina de Cegid, 1400: no cuadra por 50.
  if (select count(*) from public.lab_persona_concepto where employee_id = emp and origen = 'convenio') <> 2
     or (select importe from public.lab_persona_concepto where employee_id = emp and origen = 'pactado') <> 150
     or exists (select 1 from public.lab_persona_concepto where employee_id = emp and concepto_codigo = '900') then
    raise exception 'PRUEBA N1 · 3: los conceptos de la persona no son convenio + pactado.';
  end if;
  if (select bruto_cegid_mes from public.lab_persona where employee_id = emp) <> 1400
     or (select bruto_conceptos_mes from public.lab_persona where employee_id = emp) <> 1350
     or (select bruto_cegid_periodo from public.lab_persona where employee_id = emp) <> '09/2026'
     or (select irpf_cegid_pct from public.lab_persona where employee_id = emp) <> 10.71 then
    raise exception 'PRUEBA N1 · 3: la comparación con la nómina de Cegid sale mal.';
  end if;
  if jsonb_array_length(r -> 'no_cuadra') <> 1 then raise exception 'PRUEBA N1 · 3: no dice que no cuadra: %.', r -> 'no_cuadra'; end if;
  raise notice '3 · el volcado: la que estaba, completada; la baja, de baja en su local y sin cursos; la de alta que falta, no se crea; convenio + pactado, y no cuadra por 50';
end $$;

-- ── 4 · Otra vez: no duplica nada ───────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); lote uuid := (select v::uuid from _s where clave = 'lote');
        r jsonb; n_emp int; n_con int; n_pc int;
begin
  select count(*) into n_emp from public.employees where account_id = a;
  select count(*) into n_con from public.lab_contrato where account_id = a;
  select count(*) into n_pc from public.lab_persona_concepto where account_id = a;
  r := public.lab_volcar_lote(lote);
  if (r ->> 'personas')::int <> 2 or (r ->> 'contratos')::int <> 2 or (r ->> 'nuevas_de_baja')::int <> 0 then
    raise exception 'PRUEBA N1 · 4: la segunda vez devuelve %.', r;
  end if;
  if (select count(*) from public.employees where account_id = a) <> n_emp or (select count(*) from public.lab_contrato where account_id = a) <> n_con
     or (select count(*) from public.lab_persona_concepto where account_id = a) <> n_pc then
    raise exception 'PRUEBA N1 · 4: la segunda vez ha duplicado algo.';
  end if;
  raise notice '4 · otra vez: las mismas personas, los mismos contratos y los mismos conceptos';
end $$;
reset role;

-- ── 5 · Nadie más ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote');
begin
  begin perform public.lab_volcar_lote(lote); raise exception 'PRUEBA N1 · 5: el encargado vuelca.';
  exception when insufficient_privilege then null; end;
  begin perform public.lab_confirmar_centro(lote, 'x', (select v::uuid from _s where clave = 'loc1')); raise exception 'PRUEBA N1 · 5: el encargado confirma un centro.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.lab_persona) or exists (select 1 from public.lab_contrato) or exists (select 1 from public.lab_persona_concepto) then
    raise exception 'PRUEBA N1 · 5: el encargado, sin el permiso, ve las tablas de Laboral.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote');
begin
  begin perform public.lab_volcar_lote(lote); raise exception 'PRUEBA N1 · 5: el administrador de otra cuenta vuelca.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.lab_persona where account_id = (select v::uuid from _s where clave = 'cuenta')) then
    raise exception 'PRUEBA N1 · 5: el administrador de otra cuenta ve las fichas de Laboral de la A.';
  end if;
  raise notice '5 · nadie más: ni el encargado ni el administrador de otra cuenta vuelcan ni ven';
end $$;
reset role;

-- ── 6 · La vuelta atrás, en orden inverso ───────────────────────────────────
\i supabase/vuelta-atras/20261101T1939_n1_datos_privados_laboral.down.sql
\i supabase/vuelta-atras/20261101T1938_n1_volcado_cegid.down.sql
\i supabase/vuelta-atras/20261101T1937_n1_laboral_modelo.down.sql
do $$ begin
  if to_regclass('public.lab_permiso') is not null or to_regprocedure('public.lab_volcar_lote(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'carpeta')
     or position('current_user_is_admin_of' in pg_get_functiondef('public.empleados_datos_privados(uuid)'::regprocedure)) = 0 then
    raise exception 'PRUEBA N1 · 6: la vuelta atrás no deja todo como estaba.';
  end if;
  raise notice '6 · la vuelta atrás: fuera las tablas, las funciones y las columnas; empleados_datos_privados, como estaba';
end $$;

rollback;
