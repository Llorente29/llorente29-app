-- supabase/staging/sql/20261116_c06b_recibida_abierta_prueba.sql
--
-- SOLO STAGING. Después de la 0760 (recibidas abiertas en C0008, aplicada en
-- producción el 16/10, run #98): lo que conta-diez-enviar LEE de la base para
-- decidir si manda una recibida, en la forma que tiene hoy producción. Todo en
-- una transacción con ROLLBACK: staging no cambia. Datos inventados; la base
-- de Diez es la inventada C0099 (aquí no se habla con Diez).
--
--   1. Una factura recibida de OCTUBRE de A, aprobada, propuesta, validada y
--      con su PDF guardado (factura_recibida), como usuario: conta_recibida_envio
--      la da validada, con su documento y con fecha desde el 01/10.
--   2. La autorización de empresa como la dejó la 0750 (desde el 01/10, sin
--      recibidas), leída con el MISMO filtro que la función (cuenta, empresa y
--      nombre_bd sin mayúsculas): incluye_recibidas = false → la función para.
--   3. El mismo cambio que la 0760 (solo esa fila; motivo || nota), y leída
--      igual: true y desde el 01/10 → la función la manda. La de asiento de
--      otro asiento sigue sin recibidas.
--   4. Un usuario sigue sin leer conta_diez_autorizo (lo lee la función con la
--      clave de servicio).
--
-- La decisión con esas filas (autorizacionCubre) y lo que contesta el envío
-- los prueba tests/conta/d01/enviarRecibida.test.ts, con estas mismas filas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA recibida abierta: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 1 · Como el administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_sub text; v_i uuid; r jsonb; v_entry uuid; v_ruta text;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Abierta Prueba C06b', 'Abierta Prueba C06b, S.L.', 'B00000066', true, 'Prueba C06b') returning id into v_p;
  v_sub := public.company_account_add(v_e, '4000', 'Abierta Prueba C06b', null, 'supplier', v_p::text, 'Prueba C06b')->>'code';
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_p, v_e, 'PC06B-A-1', '2026-10-13', 'aprobada', 'manual', 110, 100, 10, 'Prueba C06b') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-10-14', 'concepto', 'Factura Abierta Prueba C06b · PC06B-A-1', 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba C06b', 'documento', 'PC06B-A-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PC06B-A-1'),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PC06B-A-1',
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', 'PC06B-A-1')),
    null, 'Prueba C06b');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba C06b');
  v_ruta := v_acc::text || '/' || v_entry::text || '/0123456789abcdef.pdf';
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 2048, "mimetype": "application/pdf"}');
  perform public.conta_documento_factura_guardar(v_entry, v_ruta, 'PC06B-A-1.pdf', repeat('ab', 32), 2048, 'Prueba C06b');

  r := public.conta_recibida_envio(v_entry);
  if r->>'estado' <> 'validado' or r->>'fecha' <> '2026-10-14' or r->'factura'->>'fecha' <> '2026-10-13' or r->'factura'->>'numero' <> 'PC06B-A-1'
     or r->'documento'->>'ruta' <> v_ruta or r->'documento'->>'sha256' <> repeat('ab', 32)
     or r->'proveedor'->>'nif' <> 'B00000066' or jsonb_array_length(r->'lineas') <> 3 then
    raise exception 'PRUEBA recibida abierta · 1: %', r;
  end if;
  perform set_config('prueba_abierta.entry', v_entry::text, true);
  raise notice 'PRUEBA recibida abierta · 1: la recibida de octubre, validada (fecha %), con su PDF y % líneas: es lo que lee el envío.', r->>'fecha', jsonb_array_length(r->'lineas');
end $$;
reset role;

-- 2 y 3 · Como la función (clave de servicio: aquí, el dueño de la base).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_entry constant uuid := current_setting('prueba_abierta.entry')::uuid;
  v_otro uuid; f record; n int;
begin
  delete from public.conta_diez_autorizo where company_id = v_e and upper(nombre_bd) = 'C0099';
  select id into v_otro from public.journal_entry where account_id = v_acc and company_id = v_e and id <> v_entry and status = 'validado' limit 1;
  -- Las dos filas que tiene hoy producción, con la empresa como la dejó la 0750.
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo, desde)
  values (v_acc, v_e, 'empresa', null, 'C0099', 'Prueba C06b', 'Empresa desde el 01/10 (prueba)', '2026-10-01');
  if v_otro is not null then
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo)
    values (v_acc, v_e, 'asiento', v_otro, 'C0099', 'Prueba C06b', 'Un asiento de ventas (prueba)');
  end if;

  -- 2 · El filtro de la función: .eq(account_id).eq(company_id).ilike(nombre_bd).
  select * into f from public.conta_diez_autorizo where account_id = v_acc and company_id = v_e and nombre_bd ilike 'c0099' and alcance = 'empresa';
  if f.incluye_recibidas is distinct from false or f.desde <> date '2026-10-01' then
    raise exception 'PRUEBA recibida abierta · 2: la de empresa antes de la 0760 no es desde el 01/10 sin recibidas (%, %).', f.desde, f.incluye_recibidas;
  end if;
  raise notice 'PRUEBA recibida abierta · 2: antes, la de empresa (desde %) sin recibidas: la función para («cerrado para facturas recibidas»).', f.desde;

  -- 3 · El cambio de la 0760, con su misma condición.
  update public.conta_diez_autorizo
     set incluye_recibidas = true, motivo = motivo || ' · 15/10: Julio abre también las recibidas (incluye_recibidas).'
   where account_id = v_acc and company_id = v_e and alcance = 'empresa' and upper(nombre_bd) = 'C0099'
     and desde = date '2026-10-01' and incluye_recibidas = false;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PRUEBA recibida abierta · 3: el cambio de la 0760 ha tocado % filas.', n; end if;

  if (select count(*) from public.conta_diez_autorizo where account_id = v_acc and company_id = v_e and nombre_bd ilike 'c0099'
        and alcance = 'empresa' and incluye_recibidas and desde = date '2026-10-01') <> 1 then
    raise exception 'PRUEBA recibida abierta · 3: no hay UNA de empresa con recibidas desde el 01/10.';
  end if;
  if (select count(*) from public.conta_diez_autorizo where account_id = v_acc and company_id = v_e and nombre_bd ilike 'c0099' and alcance = 'asiento' and incluye_recibidas) <> 0 then
    raise exception 'PRUEBA recibida abierta · 3: la de asiento ha quedado con recibidas.';
  end if;
  raise notice 'PRUEBA recibida abierta · 3: después, la de empresa con recibidas desde el 01/10 y la de asiento sin ellas (%). Con la recibida del 14/10: se manda.',
    case when v_otro is null then 'no había otro asiento validado' else 'probado' end;
end $$;

-- 4
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_falla text;
begin
  begin perform count(*) from public.conta_diez_autorizo; v_falla := null;
  exception when insufficient_privilege then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA recibida abierta · 4: un usuario lee conta_diez_autorizo.'; end if;
  raise notice 'PRUEBA recibida abierta · 4: un usuario no la lee.';
end $$;
reset role;

\echo '>>> Prueba de la recibida abierta en verde. ROLLBACK: no queda nada.'
rollback;
