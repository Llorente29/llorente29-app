-- supabase/staging/sql/20261117_x02_salida_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X02 (20261117T1010_x02_salida_erp10_tablas y
-- 20261117T1011_x02_salida_erp10_funciones), que el ensayo de staging pone
-- delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no
-- cambia. Con dos empresas inventadas, una en la cuenta A y otra en la B, creadas
-- aquí dentro, y los asientos validados por el camino de verdad
-- (journal_entry_validar, con su libro de IVA).
--
--   0. La forma: las cuatro tablas con RLS, el índice único de las partidas vivas
--      y los permisos de las cinco funciones (ni anon ni public).
--   1. La conversión del largo: un código que cabe (rellenando y quitando ceros
--      por el medio) y otro que no.
--   2. Encender: sin código o con un largo de 13 falla; con el envío a Diez
--      encendido falla con su mensaje; un usuario de B no enciende la de A; bien
--      encendida dice cómo ha quedado.
--   3. Lo que sale, y como qué: una recibida, una emitida a mano, un día de
--      ventas, un banco y una nómina; no salen la de apertura, la traída de otro
--      programa, la de antes de «desde» ni la de otro mes. Una que usa una cuenta
--      que no cabe sale en la lista, avisada y sin salir. Las cuentas nuevas, con
--      su código convertido.
--   4. Apuntar un lote lo quita de «por salir» y apunta sus cuentas; el mismo
--      asiento no entra en otro lote (y el segundo no deja nada); la que no puede
--      salir no se apunta.
--   5. Anular un asiento que salió lo lleva a «cambiadas» y su contraasiento no
--      sale.
--   6. Una empresa no ve lo de la otra (funciones y tablas).
--   7. Las dos vueltas atrás: no queda ninguna tabla ni función del X02.
--
-- Sin datos reales (T11): nombres y NIF inventados, que se ven inventados.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X02: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La forma ---------------------------------------------------------------------------------
do $$
declare t text; f text;
begin
  foreach t in array array['conta_erp10_salida_empresa', 'conta_erp10_salida_lote', 'conta_erp10_salida_partida', 'conta_erp10_subcuenta_salida'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'PRUEBA X02 · 0: % no tiene RLS.', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'insert')
       or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete') then
      raise exception 'PRUEBA X02 · 0: % se puede escribir desde el navegador o leer sin sesión.', t;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'conta_erp10_salida_partida_viva_uq'
                   and indexdef like 'CREATE UNIQUE INDEX%(entry_id) WHERE (estado = ''salida''::text)') then
    raise exception 'PRUEBA X02 · 0: falta el índice único de las partidas vivas.';
  end if;
  foreach f in array array['public.conta_erp10_salida_poner(uuid, boolean, text, integer, date, text)', 'public.conta_erp10_por_salir(uuid, date)',
                           'public.conta_erp10_cambiadas(uuid)', 'public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA X02 · 0: anon puede ejecutar %.', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA X02 · 0: authenticated no puede ejecutar %.', f; end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'PRUEBA X02 · 0: % no es security definer.', f; end if;
  end loop;
  if (select provolatile from pg_proc where oid = 'public.conta_erp10_por_salir(uuid, date)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'public.conta_erp10_cambiadas(uuid)'::regprocedure) <> 's' then
    raise exception 'PRUEBA X02 · 0: por_salir o cambiadas no son stable (solo leen).';
  end if;
  raise notice 'PRUEBA X02 · 0 bien: 4 tablas con RLS, el índice único y 4 funciones con sus permisos.';
end $$;

-- 1 · La conversión del largo --------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
      ('40000001', '4000', 8, '40000001'),       -- ya tiene el largo
      ('40000001', '4000', 10, '4000000001'),    -- rellena por el medio
      ('4000000123', '4000', 8, '40000123'),     -- quita ceros por el medio
      ('70000000', '700', 6, '700000'),          -- la de plantilla
      ('5720000001', '572', 8, '57200001'),
      ('4000123456', '4000', 8, null),           -- no cabe
      ('6290012345', '6290', 6, null)            -- no cabe
    ) v(codigo, plantilla, largo, esperado) loop
    if public.conta_erp10_subcuenta(r.codigo, r.plantilla, r.largo) is distinct from r.esperado then
      raise exception 'PRUEBA X02 · 1: % (plantilla %) a % cifras da % y es %.', r.codigo, r.plantilla, r.largo,
        public.conta_erp10_subcuenta(r.codigo, r.plantilla, r.largo), r.esperado;
    end if;
  end loop;
  raise notice 'PRUEBA X02 · 1 bien: 7 conversiones (5 caben, 2 no).';
end $$;

-- 2 · Las dos empresas inventadas, con lo que necesitan sus asientos -------------------------------
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c uuid; d uuid; y uuid;
  x record;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X02 Uno, S.L.') returning id into c;
  insert into public.company (account_id, legal_name) values (b, 'Empresa Inventada X02 Dos, S.L.') returning id into d;
  perform set_config('x02.c', c::text, true);
  perform set_config('x02.d', d::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  perform set_config('x02.y', y::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (b, d, '2026', '2026-01-01', '2026-12-31');
  for x in select * from (values
      ('60000000', '600', 'Compras de mercaderías', 'template'),
      ('62900000', '629', 'Otros servicios', 'template'),
      ('64000000', '640', 'Sueldos y salarios', 'template'),
      ('70000000', '700', 'Ventas de mercaderías', 'template'),
      ('47200000', '472', 'IVA soportado', 'template'),
      ('47700000', '477', 'IVA repercutido', 'template'),
      ('46500000', '465', 'Remuneraciones pendientes', 'template'),
      ('57200001', '572', 'Banco inventado', 'own'),
      ('5720123456', '572', 'Banco inventado largo', 'own'),
      ('40000001', '4000', 'Proveedor Inventado X02', 'own'),
      ('43000001', '4300', 'Cliente Inventado X02', 'own'),
      ('43000002', '4300', 'Plataforma Inventada X02', 'own')
    ) v(codigo, plantilla, nombre, clase) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (b, d, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
  end loop;
end $$;

-- 3 · Encender (como el administrador de A) --------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x02.c')::uuid;
  r jsonb; v_msg text;
begin
  begin perform public.conta_erp10_salida_poner(c, true, null, 8, '2026-10-01');
        raise exception 'PRUEBA X02 · 2: se encendió sin código de empresa.';
  exception when invalid_parameter_value then v_msg := sqlerrm; end;
  if v_msg <> 'Falta el código de la empresa en ERP10.' then raise exception 'PRUEBA X02 · 2: sin código dice «%».', v_msg; end if;

  begin perform public.conta_erp10_salida_poner(c, true, 'E01', 13, '2026-10-01');
        raise exception 'PRUEBA X02 · 2: se encendió con 13 cifras.';
  exception when invalid_parameter_value then v_msg := sqlerrm; end;
  if v_msg <> 'La subcuenta de ERP10 tiene entre 6 y 12 cifras (has puesto 13).' then raise exception 'PRUEBA X02 · 2: con 13 cifras dice «%».', v_msg; end if;

  -- Con el envío a Diez encendido, no.
  insert into public.conta_diez_envio_empresa (company_id, account_id, enviar, desde) values (c, 'c01a0000-0000-4000-8000-00000000000a', true, '2026-10-01');
  begin perform public.conta_erp10_salida_poner(c, true, 'E01', 8, '2026-10-01');
        raise exception 'PRUEBA X02 · 2: se encendió con el envío a Diez encendido.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'Esta empresa ya envía a Diez. Apaga ese envío antes de encender la salida a ERP10.' then
    raise exception 'PRUEBA X02 · 2: con Diez encendido dice «%».', v_msg;
  end if;
  if exists (select 1 from public.conta_erp10_salida_empresa where company_id = c) then raise exception 'PRUEBA X02 · 2: el intento con Diez dejó fila.'; end if;
  delete from public.conta_diez_envio_empresa where company_id = c;

  -- Sin encender, «por salir» lo dice.
  begin perform public.conta_erp10_por_salir(c, '2026-10-01');
        raise exception 'PRUEBA X02 · 2: por salir contestó sin la salida encendida.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'La salida a ERP10 no está encendida en esta empresa.' then raise exception 'PRUEBA X02 · 2: apagada dice «%».', v_msg; end if;

  r := public.conta_erp10_salida_poner(c, true, 'E01', 8, '2026-10-01');
  if not (r ->> 'encendida')::boolean or r ->> 'codigo' <> 'E01' or (r ->> 'largo')::int <> 8 or r ->> 'desde' <> '2026-10-01'
     or r ->> 'texto' <> 'Encendida: sale a ERP10 lo validado desde el 01/10/2026, con el código de empresa E01 y subcuentas de 8 cifras.' then
    raise exception 'PRUEBA X02 · 2: encendida devuelve %.', r;
  end if;
  raise notice 'PRUEBA X02 · 2: %', r ->> 'texto';
end $$;

-- Un administrador de B no enciende la de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text;
begin
  begin perform public.conta_erp10_salida_poner(current_setting('x02.c')::uuid, false);
        raise exception 'PRUEBA X02 · 2: un usuario de B apagó la de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X02 · 2: B sobre A dice «%».', v_msg; end if;
  -- Y B enciende la suya.
  perform public.conta_erp10_salida_poner(current_setting('x02.d')::uuid, true, 'E02', 8, '2026-10-01');
  raise notice 'PRUEBA X02 · 2 bien: sin código, 13 cifras, con Diez y desde otra cuenta, no; encendidas las dos.';
end $$;

-- 4 · Los asientos, validados por el camino de verdad (administrador de A) -------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := current_setting('x02.c')::uuid;
  y constant uuid := current_setting('x02.y')::uuid;
  t21 uuid; si uuid; ci uuid; e uuid;
  k record;
  cu jsonb;
begin
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  if t21 is null then raise exception 'PRUEBA X02 · 3: no está el IVA general del sistema.'; end if;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;

  -- Una recibida (con su factura de proveedor).
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, issuer_name, issuer_tax_id, status, tax_base_total, tax_total, grand_total)
  values (a, c, 'X02-R-1', '2026-10-04', 'Proveedor Inventado X02', 'B00000000', 'aprobada', 100, 21, 121) returning id into si;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id)
  values (a, c, y, 2, '2026-10-05', 'Recibida inventada X02', 'supplier_invoice', si) returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible)
  values (a, c, e, 1, (cu ->> '60000000')::uuid, 100, 0, null, null, null, null),
         (a, c, e, 2, (cu ->> '47200000')::uuid, 21, 0, t21, 100, 'received', 'yes'),
         (a, c, e, 3, (cu ->> '40000001')::uuid, 0, 121, null, null, null, null);
  perform public.journal_entry_validar(e);
  perform set_config('x02.recibida', e::text, true);

  -- Una emitida a mano (una factura de cliente hecha en Sumied).
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
  values (a, c, y, 1, '2026-10-06', 'Emitida inventada X02', 'customer_invoice', 'X02-E-1', '2026-10-06') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, document_ref, document_date)
  values (a, c, e, 1, (cu ->> '43000001')::uuid, 242, 0, null, null, null, null, null),
         (a, c, e, 2, (cu ->> '70000000')::uuid, 0, 200, null, null, null, null, null),
         (a, c, e, 3, (cu ->> '47700000')::uuid, 0, 42, t21, 200, 'issued', 'X02-E-1', '2026-10-06');
  perform public.journal_entry_validar(e);
  perform set_config('x02.emitida', e::text, true);

  -- Un día de ventas (resumen de tiques).
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, c, y, 1, '2026-10-07', 'Ventas del día inventadas X02', 'sales_day') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, tax_documents)
  values (a, c, e, 1, (cu ->> '43000002')::uuid, 121, 0, null, null, null, 1),
         (a, c, e, 2, (cu ->> '70000000')::uuid, 0, 100, null, null, null, 1),
         (a, c, e, 3, (cu ->> '47700000')::uuid, 0, 21, t21, 100, 'issued', 3);
  perform public.journal_entry_validar(e);
  perform set_config('x02.ventas', e::text, true);

  -- Un banco, una nómina y el banco con la cuenta que no cabe; y una de antes de «desde».
  for k in select * from (values
      ('banco', 'bank', '2026-10-08'::date, '62900000', '57200001', 30.00),
      ('nomina', 'payroll', '2026-10-30'::date, '64000000', '46500000', 1000.00),
      ('largo', 'bank', '2026-10-09'::date, '62900000', '5720123456', 12.00),
      ('antes', 'bank', '2026-09-20'::date, '62900000', '57200001', 5.00),
      ('noviembre', 'bank', '2026-11-03'::date, '62900000', '57200001', 7.00)
    ) v(clave, origen, fecha, debe, haber, importe) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, c, y, 4, k.fecha, 'Inventado X02 · ' || k.clave, k.origen) returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
    values (a, c, e, 1, (cu ->> k.debe)::uuid, k.importe, 0), (a, c, e, 2, (cu ->> k.haber)::uuid, 0, k.importe);
    perform public.journal_entry_validar(e);
    perform set_config('x02.' || k.clave, e::text, true);
  end loop;

  -- La de apertura y la traída de otro programa: validadas, y no salen.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, c, y, 9, '2026-10-01', 'Apertura inventada X02', 'opening') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
  values (a, c, e, 1, (cu ->> '57200001')::uuid, 500, 0), (a, c, e, 2, (cu ->> '40000001')::uuid, 0, 500);
  perform public.journal_entry_validar(e);
  perform set_config('x02.apertura', e::text, true);
end $$;
\echo '>>> asientos validados'

-- La traída de otro programa (N02 · #701: la factura con source «traida»), validada: no sale.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := current_setting('x02.c')::uuid;
  y constant uuid := current_setting('x02.y')::uuid;
  t21 uuid; si uuid; e uuid; cu jsonb;
begin
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, issuer_name, issuer_tax_id, status, source, tax_base_total, tax_total, grand_total)
  values (a, c, 'X02-T-1', '2026-10-10', 'Proveedor Inventado X02', 'B00000000', 'aprobada', 'traida', 50, 10.5, 60.5) returning id into si;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id)
  values (a, c, y, 2, '2026-10-10', 'Traída inventada X02', 'supplier_invoice', si) returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible)
  values (a, c, e, 1, (cu ->> '60000000')::uuid, 50, 0, null, null, null, null),
         (a, c, e, 2, (cu ->> '47200000')::uuid, 10.5, 0, t21, 50, 'received', 'yes'),
         (a, c, e, 3, (cu ->> '40000001')::uuid, 0, 60.5, null, null, null, null);
  perform public.journal_entry_validar(e);
  perform set_config('x02.traida', e::text, true);
end $$;

-- 3 · Lo que sale, y como qué ---------------------------------------------------------------------
do $$
declare
  c constant uuid := current_setting('x02.c')::uuid;
  r jsonb; p jsonb; k record; v_n int;
begin
  r := public.conta_erp10_por_salir(c, '2026-10-01');
  for k in select * from (values ('recibida', 'recibida', true), ('emitida', 'emitida', true), ('ventas', 'emitida', true),
                                 ('banco', 'asiento', true), ('nomina', 'asiento', true), ('largo', 'asiento', false)) v(clave, clase, sale) loop
    select x into p from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x02.' || k.clave);
    if p is null then raise exception 'PRUEBA X02 · 3: «%» no está en lo que sale.', k.clave; end if;
    if p ->> 'clase' <> k.clase or (p ->> 'sale')::boolean <> k.sale then
      raise exception 'PRUEBA X02 · 3: «%» sale como «%» (sale: %) y es «%» (sale: %).', k.clave, p ->> 'clase', p ->> 'sale', k.clase, k.sale;
    end if;
  end loop;
  foreach k.clave in array array['apertura', 'traida', 'antes', 'noviembre'] loop
    if exists (select 1 from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x02.' || k.clave)) then
      raise exception 'PRUEBA X02 · 3: «%» está en lo que sale en octubre y no tiene que estar.', k.clave;
    end if;
  end loop;
  if jsonb_array_length(r -> 'partidas') <> 6 then raise exception 'PRUEBA X02 · 3: salen % partidas y son 6.', jsonb_array_length(r -> 'partidas'); end if;
  -- La de la cuenta larga, avisada con su porqué.
  select x into p from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x02.largo');
  if p -> 'avisos' ->> 0 <> 'Usa la cuenta 5720123456, que no se puede pasar a ERP10: no sale.' then
    raise exception 'PRUEBA X02 · 3: la de la cuenta larga dice %.', p -> 'avisos';
  end if;
  -- Las cuentas nuevas: 11 caben y la larga no, con su aviso; y una convertida igual.
  select x into p from jsonb_array_elements(r -> 'cuentas_nuevas') x where x ->> 'codigo' = '5720123456';
  if (p ->> 'cabe')::boolean or p ->> 'codigo_erp10' is not null or p ->> 'aviso' <> 'La cuenta 5720123456 no cabe en ERP10, que usa 8 cifras.' then
    raise exception 'PRUEBA X02 · 3: la cuenta larga sale como %.', p;
  end if;
  select count(*) into v_n from jsonb_array_elements(r -> 'cuentas_nuevas') x where (x ->> 'cabe')::boolean;
  if v_n <> 11 or (r -> 'resumen' ->> 'cuentas_nuevas')::int <> 11 or (r -> 'resumen' ->> 'cuentas_que_no_caben')::int <> 1 then
    raise exception 'PRUEBA X02 · 3: % cuentas nuevas que caben (resumen %) y son 11.', v_n, r -> 'resumen';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'cuentas_nuevas') x where x ->> 'codigo' = '40000001' and x ->> 'codigo_erp10' = '40000001') then
    raise exception 'PRUEBA X02 · 3: la 40000001 no sale como 40000001.';
  end if;
  if (r -> 'resumen' ->> 'recibidas')::int <> 1 or (r -> 'resumen' ->> 'emitidas')::int <> 2 or (r -> 'resumen' ->> 'asientos')::int <> 2
     or (r -> 'resumen' ->> 'no_salen')::int <> 1 or (r -> 'resumen' ->> 'recibidas_importe')::numeric <> 121
     or (r -> 'resumen' ->> 'emitidas_importe')::numeric <> 363 or (r -> 'resumen' ->> 'sin_pdf')::int <> 3 then
    raise exception 'PRUEBA X02 · 3: el resumen es %.', r -> 'resumen';
  end if;
  -- Noviembre trae la suya, y lo de octubre que no salió, marcado «de otro mes».
  r := public.conta_erp10_por_salir(c, '2026-11-15');
  if not exists (select 1 from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x02.noviembre') and not (x ->> 'de_otro_mes')::boolean)
     or not exists (select 1 from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' = current_setting('x02.banco') and (x ->> 'de_otro_mes')::boolean) then
    raise exception 'PRUEBA X02 · 3: noviembre no trae lo suyo y lo de octubre sin salir.';
  end if;
  raise notice 'PRUEBA X02 · 3 bien: 1 recibida, 2 emitidas (a mano y ventas del día), 2 asientos (banco y nómina), 1 avisada; fuera apertura, traída, antes de «desde» y otro mes; 11 cuentas nuevas y 1 que no cabe.';
end $$;

-- 4 · Apuntar un lote --------------------------------------------------------------------------------
do $$
declare
  c constant uuid := current_setting('x02.c')::uuid;
  r jsonb; v_msg text; v_lotes int; v_partidas int;
  f constant jsonb := '[{"nombre": "subcuentas.xlsx", "filas": 11, "huella": "h-sub"}, {"nombre": "recibidas.xlsx", "filas": 1, "huella": "h-rec"}]';
begin
  r := public.conta_erp10_lote_apuntar(c, '2026-10-01', f, jsonb_build_array(
         jsonb_build_object('entry_id', current_setting('x02.recibida'), 'clase', 'recibida', 'huella', 'h1'),
         jsonb_build_object('entry_id', current_setting('x02.emitida'), 'clase', 'emitida', 'huella', 'h2'),
         jsonb_build_object('entry_id', current_setting('x02.ventas'), 'clase', 'emitida', 'huella', 'h3'),
         jsonb_build_object('entry_id', current_setting('x02.banco'), 'clase', 'asiento', 'huella', 'h4'),
         jsonb_build_object('entry_id', current_setting('x02.nomina'), 'clase', 'asiento', 'huella', 'h5')));
  if (r ->> 'recibidas')::int <> 1 or (r ->> 'emitidas')::int <> 2 or (r ->> 'asientos')::int <> 2 or (r ->> 'cuentas_nuevas')::int <> 11
     or r ->> 'texto' <> 'Apuntado lo que sale de 10/2026: 1 factura recibida, 2 facturas emitidas, 2 asientos y 11 cuentas nuevas.' then
    raise exception 'PRUEBA X02 · 4: el lote devuelve %.', r;
  end if;
  raise notice 'PRUEBA X02 · 4: %', r ->> 'texto';
  perform set_config('x02.lote', r ->> 'lote', true);
  r := public.conta_erp10_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'partidas') <> 1 or r -> 'partidas' -> 0 ->> 'entry_id' <> current_setting('x02.largo')
     or jsonb_array_length(r -> 'cuentas_nuevas') <> 1 then
    raise exception 'PRUEBA X02 · 4: después del lote queda por salir %.', r;
  end if;
  if (select count(*) from public.conta_erp10_subcuenta_salida where company_id = c) <> 11
     or (select codigo_erp10 from public.conta_erp10_subcuenta_salida where company_id = c and codigo = '43000002') <> '43000002' then
    raise exception 'PRUEBA X02 · 4: las subcuentas salidas no son las 11.';
  end if;

  -- El mismo asiento no entra en otro lote, y el intento no deja nada.
  select count(*) into v_lotes from public.conta_erp10_salida_lote where company_id = c;
  select count(*) into v_partidas from public.conta_erp10_salida_partida where company_id = c;
  begin
    perform public.conta_erp10_lote_apuntar(c, '2026-11-01', f, jsonb_build_array(
      jsonb_build_object('entry_id', current_setting('x02.noviembre'), 'clase', 'asiento', 'huella', 'h6'),
      jsonb_build_object('entry_id', current_setting('x02.banco'), 'clase', 'asiento', 'huella', 'h4')));
    raise exception 'PRUEBA X02 · 4: el mismo asiento entró en dos lotes.';
  exception when unique_violation then v_msg := sqlerrm; end;
  if v_msg <> 'El asiento 4/1 ya salió a ERP10: no se apunta nada.' then raise exception 'PRUEBA X02 · 4: dos veces dice «%».', v_msg; end if;
  if (select count(*) from public.conta_erp10_salida_lote where company_id = c) <> v_lotes
     or (select count(*) from public.conta_erp10_salida_partida where company_id = c) <> v_partidas then
    raise exception 'PRUEBA X02 · 4: el intento con un asiento ya salido dejó algo apuntado.';
  end if;
  -- La que no puede salir, tampoco.
  begin
    perform public.conta_erp10_lote_apuntar(c, '2026-10-01', f, jsonb_build_array(
      jsonb_build_object('entry_id', current_setting('x02.largo'), 'clase', 'asiento', 'huella', 'h7')));
    raise exception 'PRUEBA X02 · 4: se apuntó la de la cuenta que no cabe.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'El asiento 4/3 no puede salir (Usa la cuenta 5720123456, que no se puede pasar a ERP10: no sale.): no se apunta nada.' then
    raise exception 'PRUEBA X02 · 4: la que no cabe dice «%».', v_msg;
  end if;
  -- Ni con otra clase de la que le toca.
  begin
    perform public.conta_erp10_lote_apuntar(c, '2026-11-01', f, jsonb_build_array(
      jsonb_build_object('entry_id', current_setting('x02.noviembre'), 'clase', 'recibida', 'huella', 'h8')));
    raise exception 'PRUEBA X02 · 4: se apuntó un asiento como recibida.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg not like 'El asiento 4/% sale como «asiento», no como «recibida»: no se apunta nada.' then
    raise exception 'PRUEBA X02 · 4: con otra clase dice «%».', v_msg;
  end if;
  -- Y lo que ya salió no cambia ni el código ni el largo.
  begin
    perform public.conta_erp10_salida_poner(c, true, 'E01', 10);
    raise exception 'PRUEBA X02 · 4: cambió el largo después de un lote.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'Ya han salido cuentas con 8 cifras: el largo de la subcuenta no se puede cambiar.' then
    raise exception 'PRUEBA X02 · 4: cambiar el largo dice «%».', v_msg;
  end if;
  raise notice 'PRUEBA X02 · 4 bien: el lote quita lo suyo de «por salir»; dos veces, la que no cabe, otra clase y otro largo, no, sin dejar nada.';
end $$;

-- 5 · Anular lo que salió --------------------------------------------------------------------------
do $$
declare
  c constant uuid := current_setting('x02.c')::uuid;
  r jsonb; v_n int; v_q text; v_contra uuid;
begin
  select count(*) into v_n from public.conta_erp10_cambiadas(c);
  if v_n <> 0 then raise exception 'PRUEBA X02 · 5: hay % cambiadas antes de anular nada.', v_n; end if;
  perform public.journal_entry_anular(current_setting('x02.banco')::uuid, 'Prueba X02: anulado después de salir', '2026-11-05');
  select count(*), min(q.que_hacer), min(q.contraasiento_id::text)::uuid into v_n, v_q, v_contra
    from public.conta_erp10_cambiadas(c) q where q.entry_id = current_setting('x02.banco')::uuid and q.lote_id = current_setting('x02.lote')::uuid;
  if v_n <> 1 or v_q <> 'Salió a ERP10 y en Sumied está anulado: anúlalo a mano en ERP10. No se vuelve a mandar.' or v_contra is null then
    raise exception 'PRUEBA X02 · 5: el anulado sale en cambiadas % veces («%»).', v_n, v_q;
  end if;
  if (select count(*) from public.conta_erp10_cambiadas(c)) <> 1 then raise exception 'PRUEBA X02 · 5: hay más de una cambiada.'; end if;
  r := public.conta_erp10_por_salir(c, '2026-11-01');
  if exists (select 1 from jsonb_array_elements(r -> 'partidas') x where x ->> 'entry_id' in (v_contra::text, current_setting('x02.banco'))) then
    raise exception 'PRUEBA X02 · 5: el anulado o su contraasiento vuelven a salir.';
  end if;
  raise notice 'PRUEBA X02 · 5 bien: el banco anulado después de salir está en cambiadas, y ni él ni su contraasiento vuelven a salir.';
end $$;

-- 6 · Una empresa no ve lo de la otra (administrador de B) ---------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x02.c')::uuid;
  d constant uuid := current_setting('x02.d')::uuid;
  v_msg text; r jsonb;
begin
  begin perform public.conta_erp10_por_salir(c, '2026-10-01'); raise exception 'PRUEBA X02 · 6: B leyó lo que sale de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X02 · 6: B en por_salir de A dice «%».', v_msg; end if;
  begin perform * from public.conta_erp10_cambiadas(c); raise exception 'PRUEBA X02 · 6: B leyó las cambiadas de A.';
  exception when no_data_found then null; end;
  begin
    perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "x.xlsx", "filas": 1, "huella": "h"}]',
      jsonb_build_array(jsonb_build_object('entry_id', current_setting('x02.noviembre'), 'clase', 'asiento', 'huella', 'h')));
    raise exception 'PRUEBA X02 · 6: B apuntó un lote de A.';
  exception when no_data_found then null; end;
  -- Ni un asiento de A en un lote de B.
  begin
    perform public.conta_erp10_lote_apuntar(d, '2026-10-01', '[{"nombre": "x.xlsx", "filas": 1, "huella": "h"}]',
      jsonb_build_array(jsonb_build_object('entry_id', current_setting('x02.noviembre'), 'clase', 'asiento', 'huella', 'h')));
    raise exception 'PRUEBA X02 · 6: un asiento de A entró en un lote de B.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'Un asiento del lote no es de esta empresa: no se apunta nada.' then raise exception 'PRUEBA X02 · 6: el de A en B dice «%».', v_msg; end if;
  r := public.conta_erp10_por_salir(d, '2026-10-01');
  if jsonb_array_length(r -> 'partidas') <> 0 then raise exception 'PRUEBA X02 · 6: la empresa de B ve partidas que no son suyas: %.', r -> 'partidas'; end if;
end $$;
-- Y por las tablas, con la RLS de verdad.
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_erp10_salida_partida where company_id = current_setting('x02.c')::uuid)
     or exists (select 1 from public.conta_erp10_salida_lote where company_id = current_setting('x02.c')::uuid)
     or exists (select 1 from public.conta_erp10_subcuenta_salida where company_id = current_setting('x02.c')::uuid)
     or exists (select 1 from public.conta_erp10_salida_empresa where company_id = current_setting('x02.c')::uuid) then
    raise exception 'PRUEBA X02 · 6: el administrador de B ve filas de la empresa de A en las tablas.';
  end if;
  if not exists (select 1 from public.conta_erp10_salida_empresa where company_id = current_setting('x02.d')::uuid) then
    raise exception 'PRUEBA X02 · 6: el administrador de B no ve su propia empresa.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.conta_erp10_salida_partida where company_id = current_setting('x02.c')::uuid) <> 5 then
    raise exception 'PRUEBA X02 · 6: el administrador de A no ve sus 5 partidas.';
  end if;
  raise notice 'PRUEBA X02 · 6 bien: B no lee, no apunta ni ve en las tablas nada de A; A ve lo suyo.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · Las vueltas atrás ------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261117T1011_x02_salida_erp10_funciones.down.sql
\i supabase/vuelta-atras/20261117T1010_x02_salida_erp10_tablas.down.sql
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'conta\_erp10\_%') then
    raise exception 'PRUEBA X02 · 7: la vuelta atrás dejó funciones: %.',
      (select string_agg(proname, ', ') from pg_proc where pronamespace = 'public'::regnamespace and proname like 'conta\_erp10\_%');
  end if;
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'conta\_erp10\_%') then
    raise exception 'PRUEBA X02 · 7: la vuelta atrás dejó tablas o índices.';
  end if;
  raise notice 'PRUEBA X02: 8 de 8 bien (0 a 7).';
end $$;

rollback;
