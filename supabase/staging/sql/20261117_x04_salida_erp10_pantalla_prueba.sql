-- supabase/staging/sql/20261117_x04_salida_erp10_pantalla_prueba.sql
--
-- SOLO STAGING. Prueba del X04 (20261117T1530_x04_salida_erp10_pantalla), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con
-- ROLLBACK: staging no cambia. Con dos empresas inventadas (cuentas A y B), creadas
-- aquí, y los asientos validados por el camino de verdad (journal_entry_validar).
--
--   0. La forma: la columna admite nulos; las dos funciones, con sus permisos;
--      la de las recibidas solo lee.
--   1. La carpeta: sin la salida configurada no se pone; una que no vale, no;
--      se guarda y se lee; vacía, vuelve a la de siempre; desde otra cuenta, no.
--   2. Las recibidas que salen traen cada campo: una de proveedor (con su factura,
--      su NIF, su PDF y la ficha del proveedor con su cuenta de gasto habitual),
--      una intracomunitaria de servicios y una de bienes (por su cuenta de gasto
--      del grupo 60). Un banco no viene (no es recibida).
--   3. Una empresa no ve lo de la otra.
--   4. La vuelta atrás: no queda ni la columna ni las funciones.
--
-- Sin datos reales (T11): nombres y NIF inventados, que se ven inventados.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X04: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La forma ---------------------------------------------------------------------------------
do $$
declare f text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_salida_empresa'
                   and column_name = 'carpeta_pdf' and data_type = 'text' and is_nullable = 'YES') then
    raise exception 'PRUEBA X04 · 0: falta carpeta_pdf o no admite nulos.';
  end if;
  foreach f in array array['public.conta_erp10_salida_carpeta(uuid, text, text)', 'public.conta_erp10_recibidas_por_salir(uuid, date)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA X04 · 0: anon puede ejecutar %.', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA X04 · 0: authenticated no puede ejecutar %.', f; end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'PRUEBA X04 · 0: % no es security definer.', f; end if;
  end loop;
  if (select provolatile from pg_proc where oid = 'public.conta_erp10_recibidas_por_salir(uuid, date)'::regprocedure) <> 's' then
    raise exception 'PRUEBA X04 · 0: conta_erp10_recibidas_por_salir no es stable (solo lee).';
  end if;
  -- La firma de la X02 no ha cambiado (regla 2).
  if to_regprocedure('public.conta_erp10_salida_poner(uuid, boolean, text, integer, date, text)') is null
     or (select count(*) from pg_proc where proname = 'conta_erp10_salida_poner') <> 1 then
    raise exception 'PRUEBA X04 · 0: conta_erp10_salida_poner ya no tiene su firma de la X02, o tiene dos.';
  end if;
  raise notice 'PRUEBA X04 · 0 bien: la columna, dos funciones con sus permisos y la de la X02 intacta.';
end $$;

-- Las dos empresas inventadas ------------------------------------------------------------------
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c uuid; d uuid; y uuid; x record; s uuid;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X04 Uno, S.L.') returning id into c;
  insert into public.company (account_id, legal_name) values (b, 'Empresa Inventada X04 Dos, S.L.') returning id into d;
  perform set_config('x04.c', c::text, true);
  perform set_config('x04.d', d::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  perform set_config('x04.y', y::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (b, d, '2026', '2026-01-01', '2026-12-31');
  for x in select * from (values
      ('60000000', '600', 'Compras de mercaderías', 'template'), ('62900000', '629', 'Otros servicios', 'template'),
      ('47200000', '472', 'IVA soportado', 'template'), ('47700000', '477', 'IVA repercutido', 'template'),
      ('57200001', '572', 'Banco inventado', 'own'),
      ('40000001', '4000', 'Proveedor Inventado X04', 'own'), ('40000002', '4000', 'Proveedor UE Inventado X04', 'own')
    ) v(codigo, plantilla, nombre, clase) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (b, d, 'pymes', x.codigo, x.plantilla, x.nombre, x.clase, 'manual');
  end loop;
  -- El proveedor, con su ficha enlazada a la 40000001 y su cuenta de gasto habitual, la 62900000.
  insert into public.supplier (account_id, name, legal_name, tax_id) values (a, 'Proveedor Inventado X04', 'Proveedor Inventado X04, S.L.', 'B00000000') returning id into s;
  perform set_config('x04.s', s::text, true);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, c, id, 'supplier', s::text, 'principal', 'manual' from public.company_account where company_id = c and code = '40000001';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, c, id, 'supplier', s::text, 'gasto', 'manual' from public.company_account where company_id = c and code = '62900000';
end $$;

-- 1 · La carpeta (administrador de A) ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare c constant uuid := current_setting('x04.c')::uuid; r jsonb; v_msg text;
begin
  begin perform public.conta_erp10_salida_carpeta(c, 'C:\ERP10\Documentos');
        raise exception 'PRUEBA X04 · 1: se puso la carpeta sin la salida configurada.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'Primero enciende la salida a ERP10 con el código de la empresa.' then raise exception 'PRUEBA X04 · 1: sin salida dice «%».', v_msg; end if;

  perform public.conta_erp10_salida_poner(c, true, '0007', 8, '2026-10-01');
  begin perform public.conta_erp10_salida_carpeta(c, 'C:\ERP10\Docu*mentos');
        raise exception 'PRUEBA X04 · 1: se puso una carpeta con un asterisco.';
  exception when invalid_parameter_value then v_msg := sqlerrm; end;
  if v_msg <> 'Esa carpeta no vale: como mucho 200 caracteres y sin < > " | ? *.' then raise exception 'PRUEBA X04 · 1: la carpeta mala dice «%».', v_msg; end if;

  r := public.conta_erp10_salida_carpeta(c, '  C:\ERP10\Documentos\0007  ');
  if r ->> 'carpeta' <> 'C:\ERP10\Documentos\0007' or r ->> 'texto' <> 'Los PDF irán a la carpeta C:\ERP10\Documentos\0007.'
     or (select carpeta_pdf from public.conta_erp10_salida_empresa where company_id = c) <> 'C:\ERP10\Documentos\0007' then
    raise exception 'PRUEBA X04 · 1: la carpeta devuelve % y guarda %.', r, (select carpeta_pdf from public.conta_erp10_salida_empresa where company_id = c);
  end if;
  r := public.conta_erp10_salida_carpeta(c, '');
  if r ->> 'carpeta' is not null or r ->> 'texto' <> 'Los PDF irán a la carpeta de siempre, C:\Sumied\0007\.' then
    raise exception 'PRUEBA X04 · 1: vacía devuelve %.', r;
  end if;
  perform public.conta_erp10_salida_carpeta(c, 'C:\ERP10\Documentos\0007');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text;
begin
  begin perform public.conta_erp10_salida_carpeta(current_setting('x04.c')::uuid, 'C:\Otra');
        raise exception 'PRUEBA X04 · 1: un usuario de B cambió la carpeta de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X04 · 1: B sobre A dice «%».', v_msg; end if;
  if (select carpeta_pdf from public.conta_erp10_salida_empresa where company_id = current_setting('x04.c')::uuid) <> 'C:\ERP10\Documentos\0007' then
    raise exception 'PRUEBA X04 · 1: la carpeta de A cambió.';
  end if;
  perform public.conta_erp10_salida_poner(current_setting('x04.d')::uuid, true, '0008', 8, '2026-10-01');
  raise notice 'PRUEBA X04 · 1 bien: sin salida, con asterisco y desde otra cuenta, no; se guarda, se lee y vacía vuelve a la de siempre.';
end $$;

-- 2 · Las recibidas que salen (administrador de A) --------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := current_setting('x04.c')::uuid;
  y constant uuid := current_setting('x04.y')::uuid;
  t21 uuid; tue uuid; si uuid; e uuid; cu jsonb; k record;
begin
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select id into tue from public.tax_rate where is_system and code = 'ue_compra' and valid_to is null;
  if t21 is null or tue is null then raise exception 'PRUEBA X04 · 2: faltan los tipos de IVA del sistema (iva_general, ue_compra).'; end if;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;

  -- La de proveedor, con su factura, su NIF y su PDF.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, status, tax_base_total, tax_total, grand_total)
  values (a, c, current_setting('x04.s')::uuid, 'X04-R-1', '2026-10-03', 'aprobada', 100, 21, 121) returning id into si;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id)
  values (a, c, y, 2, '2026-10-05', 'Recibida inventada X04', 'supplier_invoice', si) returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible)
  values (a, c, e, 1, (cu ->> '62900000')::uuid, 100, 0, null, null, null, null),
         (a, c, e, 2, (cu ->> '47200000')::uuid, 21, 0, t21, 100, 'received', 'yes'),
         (a, c, e, 3, (cu ->> '40000001')::uuid, 0, 121, null, null, null, null);
  perform public.journal_entry_validar(e);
  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes)
  values (a, c, e, 'factura_recibida', 'inventado/x04/factura-x04-r-1.pdf', 'factura-x04-r-1.pdf', repeat('0', 64), 1234);
  perform set_config('x04.proveedor', e::text, true);

  -- Dos intracomunitarias: una de servicios (62900000) y una de bienes (60000000).
  for k in select * from (values ('servicios', '62900000', 'X04-UE-S'), ('bienes', '60000000', 'X04-UE-B')) v(clave, gasto, numero) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
    values (a, c, y, 4, '2026-10-06', 'Intracomunitaria inventada X04 · ' || k.clave, 'manual', k.numero, '2026-10-02') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date)
    values (a, c, e, 1, (cu ->> k.gasto)::uuid, 100, 0, null, null, null, null, null, null),
           (a, c, e, 2, (cu ->> '47200000')::uuid, 21, 0, tue, 100, 'received', 'yes', k.numero, '2026-10-02'),
           -- La autorrepercusión: la 477, sin tipo (así la pide journal_entry_validar).
           (a, c, e, 3, (cu ->> '47700000')::uuid, 0, 21, null, null, null, null, null, null),
           (a, c, e, 4, (cu ->> '40000002')::uuid, 0, 100, null, null, null, null, null, null);
    perform public.journal_entry_validar(e);
    perform set_config('x04.ue_' || k.clave, e::text, true);
  end loop;

  -- Un banco: no es recibida, no viene.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, c, y, 4, '2026-10-08', 'Banco inventado X04', 'bank') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
  values (a, c, e, 1, (cu ->> '40000001')::uuid, 121, 0), (a, c, e, 2, (cu ->> '57200001')::uuid, 0, 121);
  perform public.journal_entry_validar(e);
  perform set_config('x04.banco', e::text, true);
end $$;

do $$
declare
  c constant uuid := current_setting('x04.c')::uuid;
  r jsonb; p jsonb; v_n int;
begin
  r := public.conta_erp10_recibidas_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'recibidas') <> 3 then raise exception 'PRUEBA X04 · 2: vienen % recibidas y son 3: %.', jsonb_array_length(r -> 'recibidas'), r -> 'recibidas'; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'recibidas') x where x ->> 'entryId' = current_setting('x04.banco')) then
    raise exception 'PRUEBA X04 · 2: el banco viene como recibida.';
  end if;
  if r ->> 'codigo' <> '0007' or (r ->> 'largo')::int <> 8 then raise exception 'PRUEBA X04 · 2: código y largo son % y %.', r -> 'codigo', r -> 'largo'; end if;

  -- La de proveedor, campo a campo.
  select x into p from jsonb_array_elements(r -> 'recibidas') x where x ->> 'entryId' = current_setting('x04.proveedor');
  if p ->> 'fecha' <> '2026-10-05' or p -> 'factura' ->> 'numero' <> 'X04-R-1' or p -> 'factura' ->> 'fecha' <> '2026-10-03'
     or p -> 'proveedor' ->> 'nombre' <> 'Proveedor Inventado X04, S.L.' or p -> 'proveedor' ->> 'nif' <> 'B00000000'
     or p ->> 'operacion' <> 'interior' or not (p ->> 'tienePdf')::boolean
     or p -> 'pdf' ->> 'ruta' <> 'inventado/x04/factura-x04-r-1.pdf' or p -> 'pdf' ->> 'nombre' <> 'factura-x04-r-1.pdf' then
    raise exception 'PRUEBA X04 · 2: la de proveedor viene como %.', p - 'lineas';
  end if;
  if jsonb_array_length(p -> 'lineas') <> 3
     or p -> 'lineas' -> 0 <> jsonb_build_object('cuenta', '62900000', 'plantilla', '629', 'debe', 100.00, 'haber', 0.00, 'tipoIva', null, 'baseIva', null, 'deducible', null, 'recargo', null, 'modeloRetencion', null)
     or p -> 'lineas' -> 1 <> jsonb_build_object('cuenta', '47200000', 'plantilla', '472', 'debe', 21.00, 'haber', 0.00, 'tipoIva', 21.00, 'baseIva', 100.00, 'deducible', 'yes', 'recargo', null, 'modeloRetencion', null)
     or p -> 'lineas' -> 2 ->> 'cuenta' <> '40000001' or p -> 'lineas' -> 2 ->> 'plantilla' <> '4000' or (p -> 'lineas' -> 2 ->> 'haber')::numeric <> 121 then
    raise exception 'PRUEBA X04 · 2: las líneas de la de proveedor son %.', p -> 'lineas';
  end if;

  -- Las intracomunitarias: servicios sale como tal; bienes, por su 60.
  select x into p from jsonb_array_elements(r -> 'recibidas') x where x ->> 'entryId' = current_setting('x04.ue_servicios');
  if p ->> 'operacion' <> 'intra_servicios' or p -> 'factura' ->> 'numero' <> 'X04-UE-S' or (p ->> 'tienePdf')::boolean or p -> 'pdf' <> 'null'::jsonb
     or jsonb_array_length(p -> 'lineas') <> 4 then
    raise exception 'PRUEBA X04 · 2: la de servicios de la UE viene como %.', p;
  end if;
  select x into p from jsonb_array_elements(r -> 'recibidas') x where x ->> 'entryId' = current_setting('x04.ue_bienes');
  if p ->> 'operacion' <> 'intra_bienes' then raise exception 'PRUEBA X04 · 2: la de bienes de la UE viene como «%».', p ->> 'operacion'; end if;

  -- Las cuentas: la del proveedor, con su NIF y su gasto habitual; las demás, sin.
  select x into p from jsonb_array_elements(r -> 'cuentas') x where x ->> 'codigo' = '40000001';
  if p <> jsonb_build_object('codigo', '40000001', 'plantilla', '4000', 'nombre', 'Proveedor Inventado X04', 'nif', 'B00000000', 'gastoHabitual', '62900000') then
    raise exception 'PRUEBA X04 · 2: la cuenta del proveedor viene como %.', p;
  end if;
  select count(*) into v_n from jsonb_array_elements(r -> 'cuentas') x where x ->> 'nif' is not null;
  if v_n <> 1 or jsonb_array_length(r -> 'cuentas') <> 6 then raise exception 'PRUEBA X04 · 2: las cuentas son %.', r -> 'cuentas'; end if;
  if r -> 'yaSalidas' <> '{}'::jsonb then raise exception 'PRUEBA X04 · 2: ya salidas, sin lote, es %.', r -> 'yaSalidas'; end if;

  -- Después de un lote, la recibida que salió ya no viene, y sus cuentas están en «ya salidas».
  perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "recibidas.xlsx", "filas": 1, "huella": "h"}]',
    jsonb_build_array(jsonb_build_object('entry_id', current_setting('x04.proveedor'), 'clase', 'recibida', 'huella', 'h1')));
  r := public.conta_erp10_recibidas_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'recibidas') <> 2 or r -> 'yaSalidas' ->> '40000001' <> '40000001' then
    raise exception 'PRUEBA X04 · 2: después del lote vienen % y ya salidas %.', jsonb_array_length(r -> 'recibidas'), r -> 'yaSalidas';
  end if;
  raise notice 'PRUEBA X04 · 2 bien: 3 recibidas campo a campo (proveedor con PDF y ficha, UE de servicios y de bienes), sin el banco; lo salido ya no viene.';
end $$;

-- 3 · Una empresa no ve lo de la otra (administrador de B) ----------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text; r jsonb;
begin
  begin perform public.conta_erp10_recibidas_por_salir(current_setting('x04.c')::uuid, '2026-10-01');
        raise exception 'PRUEBA X04 · 3: B leyó las recibidas de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X04 · 3: B en las recibidas de A dice «%».', v_msg; end if;
  r := public.conta_erp10_recibidas_por_salir(current_setting('x04.d')::uuid, '2026-10-01');
  if jsonb_array_length(r -> 'recibidas') <> 0 or jsonb_array_length(r -> 'cuentas') <> 0 or r -> 'yaSalidas' <> '{}'::jsonb then
    raise exception 'PRUEBA X04 · 3: la empresa de B ve %.', r;
  end if;
end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_erp10_salida_empresa where carpeta_pdf is not null and company_id = current_setting('x04.c')::uuid) then
    raise exception 'PRUEBA X04 · 3: el administrador de B ve la carpeta de la empresa de A.';
  end if;
  raise notice 'PRUEBA X04 · 3 bien: B no lee las recibidas ni la carpeta de A, y la suya sale vacía.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 4 · La vuelta atrás ------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261117T1530_x04_salida_erp10_pantalla.down.sql
do $$
begin
  if to_regprocedure('public.conta_erp10_recibidas_por_salir(uuid, date)') is not null or to_regprocedure('public.conta_erp10_salida_carpeta(uuid, text, text)') is not null then
    raise exception 'PRUEBA X04 · 4: la vuelta atrás dejó alguna función.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_salida_empresa' and column_name = 'carpeta_pdf') then
    raise exception 'PRUEBA X04 · 4: la vuelta atrás dejó la columna.';
  end if;
  if to_regprocedure('public.conta_erp10_por_salir(uuid, date)') is null then
    raise exception 'PRUEBA X04 · 4: la vuelta atrás se llevó una función de la X02.';
  end if;
  raise notice 'PRUEBA X04: 5 de 5 bien (0 a 4).';
end $$;

rollback;
