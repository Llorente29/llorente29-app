-- supabase/staging/sql/20261021_d01_recepcion_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0310 (D01 R6): las facturas que ya entran
-- por la recepción. En la empresa de la cuenta A de pruebas, con recepciones,
-- lecturas y un asiento de Diez INVENTADOS, todo en una transacción con
-- ROLLBACK: no cambia staging. Lo que el servidor escribe (la recepción y su
-- lectura, su camino, lo traído de Diez) como dueño, con las mismas funciones
-- que en producción (conta_diez_ejercicio, conta_diez_subcuentas,
-- conta_diez_importar); lo que se lee, como usuario.
--
--   1. Antes del corte (un 2024 traído de Diez hasta el 31/12): la recepción
--      cuyo papel es «factura» sale «en Diez», enlazada con su asiento traído
--      (mismo proveedor, su número en el concepto y el mismo total); la de
--      «albarán-factura» que no casa sale «en Diez» y dice que no la encuentra.
--      Ninguna se puede apuntar (no traen botón de apuntar: son tipo
--      'recepcion', y la base no deja asentar antes del corte).
--   2. El albarán suelto no sale: no es factura.
--   3. Desde el corte, la que la recepción no pudo hacer factura (sin importes
--      por línea) sale «por aclarar» con su porqué: no se esconde (regla 7).
--   4. Desde el corte, la que sí es factura (hecha desde su recepción) sale UNA
--      vez, como factura, no también como recepción; y N23 trae lo que leyó la
--      recepción (sin volver a leer).
--   5. Repetidas: si luego llega la misma por correo o subida, la regla la
--      reconoce («repetida») y el disparador no deja meterla dos veces.
--   6. B: ni la ve.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 R6 recepción: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo que escribe el servidor: como dueño.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  c     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_s uuid; v_run uuid; r jsonb; v_i uuid;
  -- Una recepción con su lectura y su camino (el que deja Compras), como en producción.
  v_r uuid;
begin
  if exists (select 1 from public.fiscal_year where company_id = c and code = '2024') then
    raise exception 'PRUEBA D01 R6 recepción · 0: la empresa A ya tiene un 2024: la prueba necesita traerlo ella.';
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Recepción Prueba R6', 'Recepción Prueba R6, S.L.', 'B00000081', true, 'Prueba D01 R6') returning id into v_s;
  perform set_config('prueba.s', v_s::text, true);

  -- El 2024, traído de Diez (antes del corte), con un asiento de factura recibida.
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to)
  values (v_acc, c, 'diez', 'historico', '2024-01-01', '2024-12-31') returning id into v_run;
  perform public.conta_diez_ejercicio(c, '2024', '2024-01-01', '2024-12-31');
  perform public.conta_diez_subcuentas(c, v_run, '[{"code":"40000977","nombre":"RECEPCION PRUEBA R6"}]');
  -- La subcuenta 40000977 se le pone a su ficha como lo hace la pantalla: con
  -- company_account_link_set, como usuario (abajo, primero del bloque de usuario).
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(jsonb_build_object(
    'ejercicio', '2024', 'serie', 2, 'numero', 9001, 'fecha', '2024-12-12', 'concepto', 'Fra. RCP-24/77 Recepción Prueba R6',
    'tipoAsiento', 2, 'huella', 'h-r6', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '62100000', 'debe', 12100, 'haber', 0),
      jsonb_build_object('posicion', 2, 'cuenta', '40000977', 'debe', 0, 'haber', 12100)))));
  if (r->>'traidos')::int <> 1 then raise exception 'PRUEBA D01 R6 recepción · 0: no se trajo el asiento de Diez: %', r; end if;

  -- R1 · 2024, «factura», casa con el asiento de Diez por número y total.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"factura","doc_number":"RCP-24/77","doc_date":"2024-12-10","grand_total":121,"supplier_name":"Recepción Prueba R6"},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, supplier_doc_number, created_by_name)
  values (v_acc, v_loc, v_s, '2024-12-10', 'confirmado', v_acc::text || '/prueba-r6/r1.jpg', v_i, 'RCP-24/77', 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason)
  values (v_acc, v_r, 'factura', v_s, c, 'factura', 'Prueba D01 R6. Es anterior al corte (31/12/2024): la lleva el programa anterior.');
  perform set_config('prueba.r1', v_r::text, true);
  -- R2 · 2024, «albarán-factura», no está en Diez.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"albaran_factura","doc_number":"RCP-24/78","doc_date":"2024-12-11","grand_total":50,"supplier_name":"Recepción Prueba R6"},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2024-12-11', 'confirmado', v_acc::text || '/prueba-r6/r2.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason)
  values (v_acc, v_r, 'factura', v_s, c, 'albaran_factura', 'Prueba D01 R6.');
  perform set_config('prueba.r2', v_r::text, true);
  -- R3 · 2024, albarán suelto: no es factura.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"albaran","doc_number":"ALB-24/1","grand_total":20},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2024-12-12', 'confirmado', v_acc::text || '/prueba-r6/r3.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason)
  values (v_acc, v_r, 'pendiente_factura', v_s, c, 'albaran', 'Prueba D01 R6.');
  perform set_config('prueba.r3', v_r::text, true);

  -- R4 · Desde el corte (2026 es de Folvy), «factura» sin importes por línea: Compras no pudo hacerla.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"factura","doc_number":"RCP-26/79","doc_date":"2026-12-10","grand_total":30},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2026-12-10', 'confirmado', v_acc::text || '/prueba-r6/r4.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason, question)
  values (v_acc, v_r, 'factura', v_s, c, 'factura', 'Prueba D01 R6: sin importes por línea.', 'factura_sin_importes');
  perform set_config('prueba.r4', v_r::text, true);

  -- R5 · Desde el corte, «factura» que Compras sí hizo factura con su papel (0140), enlazada.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"factura","doc_number":"RCP-26/80","doc_date":"2026-12-11","grand_total":40,"supplier_name":"Recepción Prueba R6","supplier_tax_id":"B00000081"},"lines":[{"raw_text":"Género","line_amount":36.36,"vat_pct":10}],"confidence":0.95}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2026-12-11', 'confirmado', v_acc::text || '/prueba-r6/r5.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, raw_document_url, created_by_name)
  values (v_acc, v_s, c, 'RCP-26/80', '2026-12-11', 'en_revision', 'ocr', 40, v_acc::text || '/prueba-r6/r5.jpg', 'Prueba D01 R6') returning id into v_i;
  insert into public.supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id) values (v_i, v_r);
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason, supplier_invoice_id)
  values (v_acc, v_r, 'factura', v_s, c, 'factura', 'Prueba D01 R6.', v_i);
  perform set_config('prueba.i5', v_i::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_s   uuid := current_setting('prueba.s')::uuid;
  r jsonb; f jsonb; v_n int; v_ca uuid;
begin
  -- La subcuenta traída de Diez, en la ficha del proveedor (como la pantalla, con sus permisos).
  select id into v_ca from public.company_account where company_id = c and code = '40000977';
  perform public.company_account_link_set(c, 'supplier', v_s::text, 'principal', v_ca, 'Prueba D01 R6', 'manual');

  -- 1 y 2 · Antes del corte.
  r := public.conta_documentos_recibidos(c, '2024-12-01', '2024-12-31');
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r1');
  if f is null or f->>'tipo' <> 'recepcion' or f->>'estado' <> 'en_diez' or (f->'diez'->>'numero')::int <> 9001
     or not coalesce((f->'asiento'->>'diez')::boolean, false) or f->>'porque' not like '%ya está en Diez (asiento 2/9001%' or f->>'canal' <> 'cocina' then
    raise exception 'PRUEBA D01 R6 recepción · 1: la factura de antes del corte no sale enlazada con Diez: %', f;
  end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r2');
  if f is null or f->>'estado' <> 'en_diez' or f->'diez' <> 'null'::jsonb or f->>'porque' not like '%No la encuentro en Diez%' then
    raise exception 'PRUEBA D01 R6 recepción · 1: el albarán-factura de antes del corte que no casa: %', f;
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 1: antes del corte, «en Diez»: la que casa, con su asiento 2/9001; la que no, lo dice.';
  if exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r3')) then
    raise exception 'PRUEBA D01 R6 recepción · 2: el albarán suelto sale como factura.';
  end if;
  if (r->'cifras'->>'para_mirar')::int <> 0 or (r->'cifras'->>'por_aclarar')::int <> 0 then
    raise exception 'PRUEBA D01 R6 recepción · 1: lo de antes del corte cuenta como pendiente: %', r->'cifras';
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 2: el albarán suelto no sale; lo de Diez no cuenta como pendiente.';

  -- 3 y 4 · Desde el corte.
  r := public.conta_documentos_recibidos(c, '2026-12-01', '2026-12-31');
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r4');
  if f is null or f->>'tipo' <> 'recepcion' or f->>'estado' <> 'por_aclarar' or f->>'porque' not like '%no trae importes por línea%' then
    raise exception 'PRUEBA D01 R6 recepción · 3: la que la recepción no pudo hacer factura: %', f;
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 3: desde el corte, sin factura: por aclarar, «%».', f->>'porque';
  select count(*) into v_n from jsonb_array_elements(r->'filas') x where x->>'numero' = 'RCP-26/80';
  if v_n <> 1 or not exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.i5') and x->>'tipo' = 'factura' and x->>'canal' = 'cocina') then
    raise exception 'PRUEBA D01 R6 recepción · 4: la hecha factura desde su recepción sale % veces (tiene que ser 1, como factura, «de su recepción»).', v_n;
  end if;
  f := public.conta_factura_para_revisar(current_setting('prueba.i5')::uuid);
  if f->'leido_en_recepcion'->'modelo'->'document'->>'doc_number' <> 'RCP-26/80' or jsonb_array_length(f->'leido_en_recepcion'->'modelo'->'lines') <> 1 then
    raise exception 'PRUEBA D01 R6 recepción · 4: N23 no trae lo que leyó la recepción: %', f->'leido_en_recepcion';
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 4: la hecha factura sale una vez, «de su recepción», y N23 trae lo que leyó la recepción.';

  -- 5 · Repetidas: la misma, llegando luego por correo o subida.
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_s, 'B00000081', 'RCP 26-80', '2026-12-14', 40) x where x.nivel = 'repetida';
  if v_n <> 1 then raise exception 'PRUEBA D01 R6 recepción · 5: la regla no reconoce como repetida la que ya entró por la recepción.'; end if;
  begin
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel)
    values (v_acc, v_s, c, 'RCP-26/80', '2026-12-14', 'en_revision', 'ocr', 40, 'Prueba D01 R6', 'correo');
    raise exception 'PRUEBA D01 R6 recepción · 5: el disparador ha dejado meter dos veces la misma factura.';
  exception when others then
    if sqlerrm like 'PRUEBA%' then raise; end if;
    -- Que la pare LA REGLA, no otra cosa (un permiso, una columna).
    if sqlerrm not like 'Repetida:%' then raise exception 'PRUEBA D01 R6 recepción · 5: no la ha parado la regla de repetidas, sino: %', sqlerrm; end if;
  end;
  raise notice 'PRUEBA D01 R6 recepción · 5: la misma que llega luego por correo es «repetida» y no entra dos veces.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_documentos_recibidos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2024-12-01', '2024-12-31');
    raise exception 'PRUEBA D01 R6 recepción · 6: B ha leído los documentos de A.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.conta_factura_para_revisar(current_setting('prueba.i5')::uuid);
    raise exception 'PRUEBA D01 R6 recepción · 6: B ha leído la factura de A.';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PRUEBA D01 R6 recepción · 6: B ni las ve.';
end $$;
reset role;

rollback;
