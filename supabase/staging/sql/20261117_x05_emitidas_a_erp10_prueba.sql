-- supabase/staging/sql/20261117_x05_emitidas_a_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X05 (20261117T2230_x05_por_salir_emitidas y
-- 20261117T2231_x05_emitidas_por_salir), que el ensayo de staging pone delante en
-- la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra
-- los objetos: public.conta_erp10_por_salir(uuid,date) (cambia) y
-- public.conta_erp10_emitidas_por_salir(uuid,date) (nueva).
--
-- Con dos empresas inventadas (cuentas A y B), creadas aquí. Las facturas de venta,
-- por el camino de verdad: conta_venta_guardar, conta_venta_emitir y
-- conta_venta_corregir, como el administrador de A.
--
--   0. La forma: la función nueva, con sus permisos y solo lee; por_salir, una sola firma.
--   1. Las emitidas que salen traen cada campo: una de un tipo (con su PDF de la
--      factura de venta) y una de dos tipos y dos cuentas de ingreso; la cuenta del
--      cliente, con su NIF.
--   2. Lo que no sale por aquí: una traída de otro programa (origin «traida») y una
--      con import_run_id no salen en ninguna parte; un día de ventas del TPV sale
--      en por_salir como emitida pero no viene en las emitidas.
--   3. Los arreglos de por_salir: una recibida con 3 cuentas de gasto no sale, con
--      «ERP10 admite 2»; el PDF de la factura de venta cuenta como «tiene PDF» (en 1).
--   4. Lo salido no vuelve a salir, y lo corregido después de salir se dice (la
--      rectificativa viene como rectificativa).
--   5. Una empresa no ve lo de la otra.
--   6. La vuelta atrás: sin la función nueva y por_salir como la dejó el X04a.
--
-- Sin datos reales (T11): nombres y NIF inventados, que se ven inventados.
--
-- sin usuario: las facturas, las anotaciones y las salidas se hacen como el usuario a1
-- de la cuenta A (request.jwt.claims), por las funciones de verdad. Dos cosas no las
-- puede hacer un usuario y las hace la prueba por debajo: dejar el PDF de una factura
-- sin subirlo al almacén y dar de alta lo traído de otro programa. Por eso no va con «set local role
-- authenticated»; la sección 5 lo usa para mirar las tablas como B.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La forma ---------------------------------------------------------------------------------
do $$
declare f constant text := 'public.conta_erp10_emitidas_por_salir(uuid, date)';
begin
  if to_regprocedure(f) is null then raise exception 'PRUEBA X05 · 0: falta %.', f; end if;
  if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA X05 · 0: anon puede ejecutar %.', f; end if;
  if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA X05 · 0: authenticated no puede ejecutar %.', f; end if;
  if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'PRUEBA X05 · 0: % no es security definer.', f; end if;
  if (select provolatile from pg_proc where oid = f::regprocedure) <> 's' then raise exception 'PRUEBA X05 · 0: % no es stable (solo lee).', f; end if;
  if (select count(*) from pg_proc where proname = 'conta_erp10_por_salir') <> 1 then
    raise exception 'PRUEBA X05 · 0: conta_erp10_por_salir tiene más de una firma (regla 2).';
  end if;
  raise notice 'PRUEBA X05 · 0 bien: la función nueva con sus permisos, solo lee; por_salir con una sola firma.';
end $$;

-- Las dos empresas inventadas ------------------------------------------------------------------
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c uuid; d uuid; y uuid; x record; p uuid;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X05 Uno, S.L.') returning id into c;
  insert into public.company (account_id, legal_name) values (b, 'Empresa Inventada X05 Dos, S.L.') returning id into d;
  perform set_config('x05.c', c::text, true);
  perform set_config('x05.d', d::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  perform set_config('x05.y', y::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (b, d, '2026', '2026-01-01', '2026-12-31');
  for x in select * from (values
      ('70000000', '700', 'Ventas de mercaderías', 'template'), ('70500000', '705', 'Prestaciones de servicios', 'template'),
      ('47700021', '477', 'IVA repercutido 21 %', 'own'), ('47700010', '477', 'IVA repercutido 10 %', 'own'),
      ('62700000', '627', 'Publicidad', 'template'), ('62800000', '628', 'Suministros', 'template'), ('62900000', '629', 'Otros servicios', 'template'),
      ('47200000', '472', 'IVA soportado', 'template'),
      ('43000001', '4300', 'Cliente Inventado X05', 'own'), ('40000001', '4000', 'Proveedor Inventado X05', 'own')
    ) v(codigo, plantilla, nombre, clase) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (b, d, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
  end loop;
  -- El cliente, con su NIF, enlazado a la 43000001.
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Inventado X05, S.L.', 'B00000000') returning id into p;
  perform set_config('x05.p', p::text, true);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, c, id, 'customer', p::text, 'principal', 'manual' from public.company_account where company_id = c and code = '43000001';
end $$;

-- 1 · Las emitidas que salen (administrador de A) ---------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x05.c')::uuid;
  t21 uuid; t10 uuid; cu jsonb; r jsonb; f1 uuid; f2 uuid;
begin
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select id into t10 from public.tax_rate where is_system and code = 'iva_reducido' and valid_to is null;
  if t21 is null or t10 is null then raise exception 'PRUEBA X05 · 1: faltan los tipos de IVA del sistema (iva_general, iva_reducido).'; end if;
  perform set_config('x05.t21', t21::text, true);
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;
  perform set_config('x05.cu', cu::text, true);
  perform public.conta_erp10_salida_poner(c, true, '0007', 8, '2026-10-01');

  -- F1: una línea al 21 %.
  r := public.conta_venta_guardar(c, null, jsonb_build_object('cliente_id', current_setting('x05.p'), 'fecha', '2026-10-05'),
         jsonb_build_array(jsonb_build_object('concepto', 'Servicio inventado X05', 'cantidad', 1, 'precio', 100, 'tipo_id', t21, 'cuenta_id', cu ->> '70000000')));
  f1 := (r ->> 'id')::uuid;
  perform public.conta_venta_emitir(f1);
  -- F2: dos tipos y dos cuentas de ingreso.
  r := public.conta_venta_guardar(c, null, jsonb_build_object('cliente_id', current_setting('x05.p'), 'fecha', '2026-10-06'),
         jsonb_build_array(jsonb_build_object('concepto', 'Venta inventada X05', 'cantidad', 1, 'precio', 100, 'tipo_id', t21, 'cuenta_id', cu ->> '70000000'),
                           jsonb_build_object('concepto', 'Servicio inventado X05', 'cantidad', 2, 'precio', 25, 'tipo_id', t10, 'cuenta_id', cu ->> '70500000')));
  f2 := (r ->> 'id')::uuid;
  perform public.conta_venta_emitir(f2);
  perform set_config('x05.f1', f1::text, true);
  perform set_config('x05.f2', f2::text, true);
  perform set_config('x05.e1', (select entry_id::text from public.customer_invoice where id = f1), true);
  perform set_config('x05.e2', (select entry_id::text from public.customer_invoice where id = f2), true);
end $$;

-- El PDF de F1, como lo deja conta_venta_pdf_guardar (sin subirlo al almacén: la prueba no sube ficheros).
update public.customer_invoice set pdf_path = 'c01a0000-0000-4000-8000-00000000000a/ventas/' || id || '/factura-inventada-x05.pdf', pdf_sha256 = repeat('0', 64), pdf_bytes = 1234
 where id = current_setting('x05.f1')::uuid;

do $$
declare
  c constant uuid := current_setting('x05.c')::uuid;
  r jsonb; p jsonb; ps jsonb; v_num1 text; v_num2 text;
begin
  select number_text into v_num1 from public.customer_invoice where id = current_setting('x05.f1')::uuid;
  select number_text into v_num2 from public.customer_invoice where id = current_setting('x05.f2')::uuid;
  r := public.conta_erp10_emitidas_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'emitidas') <> 2 then raise exception 'PRUEBA X05 · 1: vienen % emitidas y son 2: %.', jsonb_array_length(r -> 'emitidas'), r -> 'emitidas'; end if;
  if r ->> 'codigo' <> '0007' or (r ->> 'largo')::int <> 8 then raise exception 'PRUEBA X05 · 1: código y largo son % y %.', r -> 'codigo', r -> 'largo'; end if;

  select x into p from jsonb_array_elements(r -> 'emitidas') x where x ->> 'entryId' = current_setting('x05.e1');
  if p ->> 'fecha' <> '2026-10-05' or p -> 'factura' ->> 'numero' <> v_num1 or p -> 'factura' ->> 'fecha' <> '2026-10-05'
     or p -> 'cliente' ->> 'nombre' <> 'Cliente Inventado X05, S.L.' or p -> 'cliente' ->> 'nif' <> 'B00000000'
     or p ->> 'origen' <> 'a_mano' or (p ->> 'rectificativa')::boolean or p ->> 'tipoFactura' <> 'F1' or p ->> 'operacion' <> 'interior'
     or (p ->> 'recargo')::numeric <> 0 or (p ->> 'retencion')::numeric <> 0 or not (p ->> 'tienePdf')::boolean
     or p -> 'pdf' ->> 'ruta' <> 'c01a0000-0000-4000-8000-00000000000a/ventas/' || current_setting('x05.f1') || '/factura-inventada-x05.pdf'
     or p -> 'pdf' ->> 'nombre' <> 'factura-inventada-x05.pdf' then
    raise exception 'PRUEBA X05 · 1: F1 viene como %.', p - 'lineas';
  end if;
  if jsonb_array_length(p -> 'lineas') <> 3
     or not exists (select 1 from jsonb_array_elements(p -> 'lineas') l where l = jsonb_build_object('cuenta', '43000001', 'plantilla', '4300', 'debe', 121.00, 'haber', 0.00, 'tipoIva', null, 'baseIva', null, 'conLibro', false))
     or not exists (select 1 from jsonb_array_elements(p -> 'lineas') l where l = jsonb_build_object('cuenta', '70000000', 'plantilla', '700', 'debe', 0.00, 'haber', 100.00, 'tipoIva', null, 'baseIva', null, 'conLibro', false))
     or not exists (select 1 from jsonb_array_elements(p -> 'lineas') l where l = jsonb_build_object('cuenta', '47700021', 'plantilla', '477', 'debe', 0.00, 'haber', 21.00, 'tipoIva', 21.00, 'baseIva', 100.00, 'conLibro', true)) then
    raise exception 'PRUEBA X05 · 1: las líneas de F1 son %.', p -> 'lineas';
  end if;

  select x into p from jsonb_array_elements(r -> 'emitidas') x where x ->> 'entryId' = current_setting('x05.e2');
  if p -> 'factura' ->> 'numero' <> v_num2 or (p ->> 'tienePdf')::boolean or p -> 'pdf' <> 'null'::jsonb or jsonb_array_length(p -> 'lineas') <> 5
     or (select count(*) from jsonb_array_elements(p -> 'lineas') l where l ->> 'tipoIva' is not null) <> 2
     or (select count(*) from jsonb_array_elements(p -> 'lineas') l where l ->> 'cuenta' like '7%') <> 2 then
    raise exception 'PRUEBA X05 · 1: F2 viene como %.', p;
  end if;

  -- La cuenta del cliente, con su NIF.
  select x into p from jsonb_array_elements(r -> 'cuentas') x where x ->> 'codigo' = '43000001';
  if p <> jsonb_build_object('codigo', '43000001', 'plantilla', '4300', 'nombre', 'Cliente Inventado X05', 'nif', 'B00000000', 'gastoHabitual', null) then
    raise exception 'PRUEBA X05 · 1: la cuenta del cliente viene como %.', p;
  end if;
  if r -> 'yaSalidas' <> '{}'::jsonb or r -> 'corregidas' <> '[]'::jsonb then raise exception 'PRUEBA X05 · 1: sin lote, ya salidas % y corregidas %.', r -> 'yaSalidas', r -> 'corregidas'; end if;

  -- En por_salir, F1 tiene PDF (el de la factura de venta) y F2 no, con su aviso.
  ps := public.conta_erp10_por_salir(c, '2026-10-01');
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x05.e1');
  if not (p ->> 'tiene_pdf')::boolean or p -> 'avisos' <> '[]'::jsonb or not (p ->> 'sale')::boolean or p ->> 'clase' <> 'emitida' then
    raise exception 'PRUEBA X05 · 1: F1 en por_salir es %.', p;
  end if;
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x05.e2');
  if (p ->> 'tiene_pdf')::boolean or p -> 'avisos' <> '["No tiene su PDF en Sumied: sale igual, y el PDF se pone después."]'::jsonb then
    raise exception 'PRUEBA X05 · 1: F2 en por_salir es %.', p;
  end if;
  raise notice 'PRUEBA X05 · 1 bien: 2 emitidas campo a campo (un tipo con su PDF; dos tipos y dos ingresos), y el cliente con su NIF.';
end $$;

-- 2 · Lo que no sale por aquí -------------------------------------------------------------------------
-- Una traída (origin «traida») y una con import_run_id: su asiento es uno normal, validado, con libro de expedidas.
reset role;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := current_setting('x05.c')::uuid;
  y constant uuid := current_setting('x05.y')::uuid;
  cu constant jsonb := current_setting('x05.cu')::jsonb;
  t21 constant uuid := current_setting('x05.t21')::uuid;
  e uuid; k record; v_run uuid;
begin
  insert into public.import_run (account_id, company_id, program, kind, status, finished_at)
  values (a, c, 'erp10', 'emitidas', 'hecho', now()) returning id into v_run;
  for k in select * from (values ('traida', 'X05-T-1', 'traida', null::uuid), ('carga', 'X05-T-2', 'a_mano', v_run), ('tpv', null, null, null)) v(clave, numero, origen, run) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
    values (a, c, y, 1, '2026-10-07', 'Emitida inventada X05 · ' || k.clave, case k.clave when 'tpv' then 'sales_day' else 'manual' end, k.numero, '2026-10-07') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, document_ref, document_date)
    values (a, c, e, 1, (cu ->> '43000001')::uuid, 121, 0, null, null, null, null, null),
           (a, c, e, 2, (cu ->> '70000000')::uuid, 0, 100, null, null, null, null, null),
           (a, c, e, 3, (cu ->> '47700021')::uuid, 0, 21, t21, 100, 'issued', coalesce(k.numero, 'X05-TPV'), '2026-10-07');
    perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
    perform public.journal_entry_validar(e);
    perform set_config('request.jwt.claims', '', true);
    if k.origen is not null then
      insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, customer,
                                           base, tax, total, entry_id, import_run_id)
      values (a, c, 'emitida', k.origen, 'T', 2026, case k.clave when 'traida' then 1 else 2 end, k.numero, '2026-10-07',
              jsonb_build_object('nombre', 'Cliente Inventado X05, S.L.', 'nif', 'B00000000'), 100, 21, 121, e, k.run);
    end if;
    perform set_config('x05.' || k.clave, e::text, true);
  end loop;
end $$;

-- Una recibida de tres cuentas de gasto.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := current_setting('x05.c')::uuid;
  y constant uuid := current_setting('x05.y')::uuid;
  cu constant jsonb := current_setting('x05.cu')::jsonb;
  e uuid;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
  values (a, c, y, 2, '2026-10-08', 'Recibida inventada X05 de tres gastos', 'manual', 'X05-R-3', '2026-10-08') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date)
  values (a, c, e, 1, (cu ->> '62700000')::uuid, 10, 0, null, null, null, null, null, null),
         (a, c, e, 2, (cu ->> '62800000')::uuid, 20, 0, null, null, null, null, null, null),
         (a, c, e, 3, (cu ->> '62900000')::uuid, 70, 0, null, null, null, null, null, null),
         (a, c, e, 4, (cu ->> '47200000')::uuid, 21, 0, current_setting('x05.t21')::uuid, 100, 'received', 'yes', 'X05-R-3', '2026-10-08'),
         (a, c, e, 5, (cu ->> '40000001')::uuid, 0, 121, null, null, null, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform public.journal_entry_validar(e);
  perform set_config('x05.tres', e::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x05.c')::uuid;
  ps jsonb; r jsonb; p jsonb;
begin
  ps := public.conta_erp10_por_salir(c, '2026-10-01');
  if exists (select 1 from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' in (current_setting('x05.traida'), current_setting('x05.carga'))) then
    raise exception 'PRUEBA X05 · 2: lo traído (por origen o por import_run_id) está en por_salir.';
  end if;
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x05.tpv');
  if p ->> 'clase' <> 'emitida' or p ->> 'origen' <> 'sales_day' then raise exception 'PRUEBA X05 · 2: el día del TPV en por_salir es %.', p; end if;
  r := public.conta_erp10_emitidas_por_salir(c, '2026-10-01');
  if exists (select 1 from jsonb_array_elements(r -> 'emitidas') x where x ->> 'entryId' in (current_setting('x05.traida'), current_setting('x05.carga'), current_setting('x05.tpv'))) then
    raise exception 'PRUEBA X05 · 2: en las emitidas viene lo traído o el día del TPV.';
  end if;

  -- 3 · Los arreglos de por_salir.
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x05.tres');
  if (p ->> 'sale')::boolean or p -> 'avisos' -> 0 #>> '{}' <> 'Esta factura reparte el gasto en 3 cuentas y ERP10 admite 2 al importar. Métela a mano en ERP10.' then
    raise exception 'PRUEBA X05 · 3: la recibida de tres gastos en por_salir es %.', p;
  end if;
  raise notice 'PRUEBA X05 · 2 y 3 bien: lo traído no sale, el día del TPV no viene en las emitidas; la recibida de 3 gastos dice «admite 2».';
end $$;

-- 4 · Lo salido no vuelve, y lo corregido después se dice ------------------------------------------------
do $$
declare
  c constant uuid := current_setting('x05.c')::uuid;
  r jsonb; v_rid uuid; p jsonb; v_rect text;
begin
  perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "expedidas.xlsx", "filas": 1, "huella": "h"}]',
    jsonb_build_array(jsonb_build_object('entry_id', current_setting('x05.e1'), 'clase', 'emitida', 'huella', 'h1')));
  if (select emitidas from public.conta_erp10_salida_lote where company_id = c) <> 1 then
    raise exception 'PRUEBA X05 · 4: el lote no cuenta la emitida.';
  end if;
  r := public.conta_erp10_emitidas_por_salir(c, '2026-10-01');
  if exists (select 1 from jsonb_array_elements(r -> 'emitidas') x where x ->> 'entryId' = current_setting('x05.e1')) then
    raise exception 'PRUEBA X05 · 4: F1 vuelve a salir después de salir.';
  end if;
  if r -> 'yaSalidas' ->> '43000001' <> '43000001' then raise exception 'PRUEBA X05 · 4: la 430 no está en ya salidas: %.', r -> 'yaSalidas'; end if;

  -- F1 se corrige después de salir: una rectificativa de importes (80 en vez de 100).
  r := public.conta_venta_corregir(current_setting('x05.f1')::uuid, 'importes', 'Precio inventado mal puesto');
  v_rid := (r ->> 'id')::uuid;
  perform public.conta_venta_guardar(c, v_rid, jsonb_build_object('cliente_id', current_setting('x05.p'), 'fecha', '2026-10-20', 'motivo', 'Precio inventado mal puesto'),
    jsonb_build_array(jsonb_build_object('concepto', 'Servicio inventado X05', 'cantidad', 1, 'precio', 80, 'tipo_id', current_setting('x05.t21'), 'cuenta_id', current_setting('x05.cu')::jsonb ->> '70000000')));
  perform public.conta_venta_emitir(v_rid);
  select number_text into v_rect from public.customer_invoice where id = v_rid;

  r := public.conta_erp10_emitidas_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'corregidas') <> 1 or r -> 'corregidas' -> 0 ->> 'entryId' <> current_setting('x05.e1')
     or r -> 'corregidas' -> 0 ->> 'rectificativa' <> v_rect
     or r -> 'corregidas' -> 0 ->> 'queHacer' <> format('Salió a ERP10 y después se corrigió con la %s: métela a mano en ERP10. No se vuelve a mandar.', v_rect) then
    raise exception 'PRUEBA X05 · 4: las corregidas son %.', r -> 'corregidas';
  end if;
  select x into p from jsonb_array_elements(r -> 'emitidas') x where x -> 'factura' ->> 'numero' = v_rect;
  if p is null or not (p ->> 'rectificativa')::boolean or p ->> 'tipoFactura' <> 'R4' then
    raise exception 'PRUEBA X05 · 4: la rectificativa viene como %.', p - 'lineas';
  end if;
  raise notice 'PRUEBA X05 · 4 bien: lo salido no vuelve, la 430 queda salida, la corrección después de salir se dice y la rectificativa viene como tal.';
end $$;

-- 5 · Una empresa no ve lo de la otra (administrador de B) ----------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text; r jsonb;
begin
  begin perform public.conta_erp10_emitidas_por_salir(current_setting('x05.c')::uuid, '2026-10-01');
        raise exception 'PRUEBA X05 · 5: B leyó las emitidas de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X05 · 5: B en las emitidas de A dice «%».', v_msg; end if;
  perform public.conta_erp10_salida_poner(current_setting('x05.d')::uuid, true, '0008', 8, '2026-10-01');
  r := public.conta_erp10_emitidas_por_salir(current_setting('x05.d')::uuid, '2026-10-01');
  if jsonb_array_length(r -> 'emitidas') <> 0 or jsonb_array_length(r -> 'cuentas') <> 0 or r -> 'yaSalidas' <> '{}'::jsonb or r -> 'corregidas' <> '[]'::jsonb then
    raise exception 'PRUEBA X05 · 5: la empresa de B ve %.', r;
  end if;
end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_erp10_salida_partida where company_id = current_setting('x05.c')::uuid) then
    raise exception 'PRUEBA X05 · 5: el administrador de B ve lo que salió de la empresa de A.';
  end if;
  raise notice 'PRUEBA X05 · 5 bien: B no lee las emitidas ni lo salido de A, y la suya sale vacía.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás ------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261117T2231_x05_emitidas_por_salir.down.sql
\i supabase/vuelta-atras/20261117T2230_x05_por_salir_emitidas.down.sql
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare ps jsonb; p jsonb;
begin
  if to_regprocedure('public.conta_erp10_emitidas_por_salir(uuid, date)') is not null then
    raise exception 'PRUEBA X05 · 6: la vuelta atrás dejó la función nueva.';
  end if;
  -- Como la dejó el X04a: la recibida de tres gastos vuelve a salir (el tope era 4).
  ps := public.conta_erp10_por_salir(current_setting('x05.c')::uuid, '2026-10-01');
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x05.tres');
  if not (p ->> 'sale')::boolean then raise exception 'PRUEBA X05 · 6: después de la vuelta atrás, la de tres gastos es %.', p; end if;
  raise notice 'PRUEBA X05: 7 de 7 bien (0 a 6).';
end $$;

rollback;
