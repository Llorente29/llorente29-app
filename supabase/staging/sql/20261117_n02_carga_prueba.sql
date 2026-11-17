-- supabase/staging/sql/20261117_n02_carga_prueba.sql
--
-- SOLO STAGING. Prueba del N02 (20261117T0832_n02_carga_abierta y
-- 20261117T0833_n02_dia_de_inicio), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los tres objetos que cambian: public.import_run, public.supplier_invoice
-- y public.customer_invoice.
--
--   1. conta_dia_de_inicio solo la ejecuta service_role (como _conta_corte).
--   2. La medida de después (regla 31): de las empresas con _conta_corte no
--      nulo, cuántas dan lo mismo con conta_dia_de_inicio. Tienen que ser todas.
--   3. Los CHECK ampliados: cada valor nuevo entra, los de antes siguen
--      entrando y uno fuera de la lista sigue fallando, en import_run (program,
--      kind, status), supplier_invoice.source y customer_invoice.origin. Una
--      carga de ERP10 se crea de verdad; una «en prueba» sin lectura terminada,
--      no (import_run_check1 sigue igual).
--   4. import_run_id en supplier_invoice, customer_invoice y vat_book_entry:
--      admite nulos y apunta a import_run con «on delete set null».
--   5. El día de inicio, con el corte de verdad (conta_fijar_corte y los
--      ajustes del banco) en una empresa de la cuenta A sin nada traído:
--        a) corte el 31/12/2025: _conta_corte nulo (el hueco), el día de
--           inicio el 01/01/2026;
--        b) corte el 30/06/2026: los dos, el 01/07/2026;
--        c) con corte del banco el 01/03/2026: los dos, ese día;
--        d) sin corte ninguno: los dos, nulo.
--   6. Diez sigue entrando igual: una lectura con program = 'diez' trae un
--      asiento inventado (conta_diez_ejercicio, conta_diez_subcuentas,
--      conta_diez_importar), validado y con su import_run_id; y después el día
--      de inicio es el de _conta_corte.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N02: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · Permisos ------------------------------------------------------------------------
do $$ begin
  if has_function_privilege('authenticated', 'public.conta_dia_de_inicio(uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_dia_de_inicio(uuid)', 'execute') then
    raise exception 'PRUEBA N02 · 1: conta_dia_de_inicio la puede ejecutar un usuario.';
  end if;
  if not has_function_privilege('service_role', 'public.conta_dia_de_inicio(uuid)', 'execute') then
    raise exception 'PRUEBA N02 · 1: service_role no puede ejecutar conta_dia_de_inicio.';
  end if;
  if (select provolatile from pg_proc where oid = 'public.conta_dia_de_inicio(uuid)'::regprocedure) <> 's' then
    raise exception 'PRUEBA N02 · 1: conta_dia_de_inicio no es stable (solo lee).';
  end if;
end $$;

-- 2 · La medida de después (la misma vara que 20261117_n02_medida_antes.sql) -----------
do $$
declare v_total int; v_n int; v_iguales int;
begin
  select count(*), count(*) filter (where public._conta_corte(c.id) is not null),
         count(*) filter (where public._conta_corte(c.id) is not null and public.conta_dia_de_inicio(c.id) = public._conta_corte(c.id))
    into v_total, v_n, v_iguales from public.company c;
  raise notice 'MEDIDA N02 · después · empresas = % · con _conta_corte no nulo = % · de ellas, iguales con conta_dia_de_inicio = %', v_total, v_n, v_iguales;
  if v_iguales <> v_n then
    raise exception 'PRUEBA N02 · 2: % de % empresas con corte dan otro día con conta_dia_de_inicio.', v_n - v_iguales, v_n;
  end if;
end $$;

-- 3 · Los CHECK ampliados -----------------------------------------------------------------
-- Copias de las tablas con sus restricciones (sin claves ajenas ni disparadores): se mide
-- el CHECK de verdad sin pasar por lo que hace cada tabla al guardar.
create temp table n02_si (like public.supplier_invoice including defaults including constraints) on commit drop;
create temp table n02_ci (like public.customer_invoice including defaults including constraints) on commit drop;
create temp table n02_ir (like public.import_run including defaults including constraints) on commit drop;

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_run uuid; v text; v_ok boolean;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA N02 · 3: la cuenta A no tiene empresa.'; end if;

  -- supplier_invoice.source: las cuatro de antes y «traida»; otra, no.
  foreach v in array array['manual', 'ocr', 'lote', 'liquidacion', 'traida'] loop
    insert into n02_si (account_id, source) values (v_acc, v);
  end loop;
  v_ok := false;
  begin insert into n02_si (account_id, source) values (v_acc, 'traído'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA N02 · 3: supplier_invoice.source admite un valor fuera de la lista.'; end if;

  -- customer_invoice.origin: las seis de antes y «traida»; otra, no.
  foreach v in array array['a_mano', 'recurrente', 'presupuesto', 'cierre_dia', 'tienda', 'automatica', 'traida'] loop
    insert into n02_ci (account_id, company_id, origin) values (v_acc, c, v);
  end loop;
  v_ok := false;
  begin insert into n02_ci (account_id, company_id, origin) values (v_acc, c, 'erp10'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA N02 · 3: customer_invoice.origin admite un valor fuera de la lista.'; end if;

  -- import_run.program
  foreach v in array array['diez', 'erp10', 'otro'] loop
    insert into n02_ir (account_id, company_id, program, kind) values (v_acc, c, v, 'diario');
  end loop;
  v_ok := false;
  begin insert into n02_ir (account_id, company_id, program, kind) values (v_acc, c, 'a3', 'diario'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA N02 · 3: import_run.program admite un programa fuera de la lista.'; end if;

  -- import_run.kind
  foreach v in array array['historico', 'al_dia', 'documentos', 'sumas_saldos',
                           'plan_cuentas', 'terceros', 'inmovilizado', 'diario', 'recibidas', 'emitidas', 'declaraciones'] loop
    insert into n02_ir (account_id, company_id, program, kind) values (v_acc, c, 'erp10', v);
  end loop;
  v_ok := false;
  begin insert into n02_ir (account_id, company_id, program, kind) values (v_acc, c, 'erp10', 'fichas'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA N02 · 3: import_run.kind admite un tipo fuera de la lista.'; end if;

  -- import_run.status: en_curso sin terminar; los demás, con la lectura terminada.
  insert into n02_ir (account_id, company_id, program, kind, status) values (v_acc, c, 'erp10', 'diario', 'en_curso');
  foreach v in array array['hecho', 'fallido', 'en_prueba', 'dada_por_buena', 'deshecha'] loop
    insert into n02_ir (account_id, company_id, program, kind, status, finished_at) values (v_acc, c, 'erp10', 'diario', v, now());
  end loop;
  v_ok := false;
  begin insert into n02_ir (account_id, company_id, program, kind, status, finished_at) values (v_acc, c, 'erp10', 'diario', 'probada', now());
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA N02 · 3: import_run.status admite un estado fuera de la lista.'; end if;
  v_ok := false;
  begin insert into n02_ir (account_id, company_id, program, kind, status) values (v_acc, c, 'erp10', 'diario', 'en_prueba');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA N02 · 3: una carga en prueba sin la lectura terminada entra (import_run_check1 cambió).'; end if;

  -- Y una carga de ERP10 de verdad, en la tabla: se crea y pasa a «en prueba».
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to)
  values (v_acc, c, 'erp10', 'recibidas', '2026-01-01', '2026-12-31') returning id into v_run;
  update public.import_run set status = 'en_prueba', finished_at = now() where id = v_run;
  if (select status from public.import_run where id = v_run) <> 'en_prueba' then
    raise exception 'PRUEBA N02 · 3: la carga de ERP10 no quedó en prueba.';
  end if;
end $$;

-- 4 · import_run_id -----------------------------------------------------------------------
do $$
declare t text; v_n int;
begin
  foreach t in array array['supplier_invoice', 'customer_invoice', 'vat_book_entry'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t
                     and column_name = 'import_run_id' and data_type = 'uuid' and is_nullable = 'YES') then
      raise exception 'PRUEBA N02 · 4: %.import_run_id no está o no admite nulos.', t;
    end if;
    select count(*) into v_n from pg_constraint k
     where k.contype = 'f' and k.conrelid = ('public.' || t)::regclass and k.confrelid = 'public.import_run'::regclass
       and k.confdeltype = 'n'
       and k.conkey = array[(select attnum from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'import_run_id')];
    if v_n <> 1 then raise exception 'PRUEBA N02 · 4: %.import_run_id no apunta a import_run con «on delete set null».', t; end if;
  end loop;
end $$;

-- 5 · El día de inicio con el corte de verdad ---------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y int;
begin
  -- Una empresa de la cuenta A sin nada traído (conta_fijar_corte no cambia el corte si lo hay).
  select co.id into c from public.company co
   where co.account_id = v_acc and not exists (select 1 from public.journal_entry e where e.company_id = co.id and e.source_type = 'migrated')
   order by co.created_at, co.id limit 1;
  if c is null then raise exception 'PRUEBA N02 · 5: la cuenta A no tiene ninguna empresa sin asientos traídos.'; end if;
  perform set_config('n02.empresa', c::text, true);

  -- Sin corte del banco, y con los ejercicios 2025 y 2026 (si faltan, se crean).
  update public.bank_settings set cutover_date = null where company_id = c;
  foreach y in array array[2025, 2026] loop
    if not exists (select 1 from public.fiscal_year where company_id = c and starts_on <= make_date(y, 12, 31) and ends_on >= make_date(y, 1, 1)) then
      insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, y::text, make_date(y, 1, 1), make_date(y, 12, 31));
    end if;
  end loop;
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on = '2025-01-01' and ends_on = '2025-12-31') then
    raise exception 'PRUEBA N02 · 5: el ejercicio de 2025 de la empresa no va del 01/01 al 31/12.';
  end if;

  -- a) Corte en el último día de un ejercicio: el hueco.
  perform public.conta_fijar_corte(c, '2025-12-31', 'otro');
  if public._conta_corte(c) is not null then
    raise exception 'PRUEBA N02 · 5a: _conta_corte ya no tiene el hueco del 31/12 (da %): revisa la prueba.', public._conta_corte(c);
  end if;
  if public.conta_dia_de_inicio(c) is distinct from date '2026-01-01' then
    raise exception 'PRUEBA N02 · 5a: con el corte el 31/12/2025, el día de inicio es % y es el 01/01/2026.', public.conta_dia_de_inicio(c);
  end if;

  -- b) Corte a mitad de ejercicio.
  perform public.conta_fijar_corte(c, '2026-06-30', 'otro');
  if public._conta_corte(c) is distinct from date '2026-07-01' or public.conta_dia_de_inicio(c) is distinct from date '2026-07-01' then
    raise exception 'PRUEBA N02 · 5b: con el corte el 30/06/2026, _conta_corte da % y conta_dia_de_inicio %; los dos el 01/07/2026.',
      public._conta_corte(c), public.conta_dia_de_inicio(c);
  end if;

  -- c) El corte del banco manda, como en _conta_corte.
  insert into public.bank_settings (company_id, account_id, cutover_date) values (c, v_acc, '2026-03-01')
  on conflict (company_id) do update set cutover_date = excluded.cutover_date;
  if public._conta_corte(c) is distinct from date '2026-03-01' or public.conta_dia_de_inicio(c) is distinct from date '2026-03-01' then
    raise exception 'PRUEBA N02 · 5c: con el corte del banco el 01/03/2026, _conta_corte da % y conta_dia_de_inicio %.',
      public._conta_corte(c), public.conta_dia_de_inicio(c);
  end if;

  -- d) Sin corte ninguno: nulo los dos.
  update public.bank_settings set cutover_date = null where company_id = c;
  perform public.conta_fijar_corte(c, null, 'otro');
  if public._conta_corte(c) is not null or public.conta_dia_de_inicio(c) is not null then
    raise exception 'PRUEBA N02 · 5d: sin corte, _conta_corte da % y conta_dia_de_inicio %; los dos nulos.',
      public._conta_corte(c), public.conta_dia_de_inicio(c);
  end if;
end $$;
select set_config('request.jwt.claims', '', true);

-- 6 · Diez sigue entrando igual ------------------------------------------------------------
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := current_setting('n02.empresa')::uuid;
  v_run uuid; v_y uuid; r jsonb; v_e public.journal_entry;
  a jsonb := jsonb_build_object('ejercicio', '2019', 'serie', 2, 'numero', 7, 'fecha', '2019-05-02', 'concepto', 'Factura inventada N02',
    'tipoAsiento', 2, 'huella', 'h-n02', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '60000000', 'debe', 10000, 'haber', 0, 'negativoEnDiez', null),
      jsonb_build_object('posicion', 2, 'cuenta', '47200000', 'debe', 2100, 'haber', 0, 'negativoEnDiez', null),
      jsonb_build_object('posicion', 3, 'cuenta', '40000902', 'debe', 0, 'haber', 12100, 'negativoEnDiez', null)));
begin
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to)
  values (v_acc, c, 'diez', 'historico', '2019-01-01', '2019-12-31') returning id into v_run;
  v_y := public.conta_diez_ejercicio(c, '2019', '2019-01-01', '2019-12-31');
  r := public.conta_diez_subcuentas(c, v_run, '[{"code":"60000000","nombre":"Compras"},{"code":"47200000","nombre":"IVA soportado"},{"code":"40000902","nombre":"PROVEEDOR INVENTADO N02"}]');
  if jsonb_array_length(r -> 'rechazadas') <> 0 then raise exception 'PRUEBA N02 · 6: subcuentas rechazadas: %.', r; end if;
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(a));
  if (r ->> 'traidos')::int <> 1 or jsonb_array_length(r -> 'rechazados') <> 0 then
    raise exception 'PRUEBA N02 · 6: Diez ya no entra: %.', r;
  end if;
  select * into v_e from public.journal_entry where company_id = c and external_program = 'diez' and external_year = '2019'
     and external_series = '2' and external_number = '7';
  if v_e.status <> 'validado' or v_e.source_type <> 'migrated' or v_e.import_run_id is distinct from v_run or v_e.hash is null or v_e.hash = 'pendiente' then
    raise exception 'PRUEBA N02 · 6: el asiento de Diez quedó %.', to_jsonb(v_e) - 'reasons';
  end if;
  -- El ejercicio traído de Diez lleva imported_until = ends_on: los dos dan el día siguiente.
  if public._conta_corte(c) is distinct from date '2020-01-01' or public.conta_dia_de_inicio(c) is distinct from public._conta_corte(c) then
    raise exception 'PRUEBA N02 · 6: después de traer 2019 de Diez, _conta_corte da % y conta_dia_de_inicio %.',
      public._conta_corte(c), public.conta_dia_de_inicio(c);
  end if;
  raise notice 'PRUEBA N02: 6 de 6 bien.';
end $$;

rollback;
