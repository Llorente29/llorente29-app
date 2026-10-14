-- supabase/staging/sql/20261021_d01_documentos_r5_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0300 (D01 R5, N22): conta_documentos_recibidos
-- dice lo que hace falta para el porqué de cada fila, por dónde llegó de verdad
-- y las cifras del periodo elegido. En una transacción con ROLLBACK, como
-- administrador de A y como el de B. Datos inventados, en un mes sin nada
-- (diciembre de 2026), para contar exacto.
--
--   1. «Llegadas» cuenta las del periodo pedido, también las que entraron hace
--      más de 7 días (antes, solo las de esta semana).
--   2. La primera factura de un proveedor: previas 0, nada aprendido (y dice
--      por qué), sin cuenta entendida.
--   3. Con una factura anterior apuntada a 62100000 y nada en la ficha: previas
--      1 y lo entendido es lo aprendido, «sin confirmar», con su origen.
--   4. Por dónde llegó: escrita a mano → 'a_mano'; leída en Compras sin canal →
--      'compras' (ya no «subida»); subida con su foto → 'subida' y el tipo del
--      fichero.
--   5. B: ni la ve.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 R5 documentos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo que la pantalla no escribe (la llegada la mete el servidor; las fechas de
-- creación antiguas no las pone nadie a mano): como dueño.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_q uuid; v_i uuid; v_d uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Primera Prueba R5', 'Primera Prueba R5, S.L.', 'B00000071', true, 'Prueba D01 R5') returning id into v_p;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Aprendido Prueba R5', 'Aprendido Prueba R5, S.L.', 'B00000072', true, 'Prueba D01 R5') returning id into v_q;
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.q', v_q::text, true);

  -- 2 · La primera de su proveedor, escrita a mano en Compras, creada hace un mes.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, created_at)
  values (v_acc, v_p, v_e, 'PR5-1', '2026-12-02', 'en_revision', 'manual', 100, 'Prueba D01 R5', now() - interval '30 days');
  -- 4 · Leída en Compras sin canal apuntado (OCR de Supply, sin recepción).
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_p, v_e, 'PR5-2', '2026-12-03', 'en_revision', 'ocr', 50, 'Prueba D01 R5');
  -- 4 · Subida como foto: la llegada con su fichero, y su factura.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel)
  values (v_acc, v_q, v_e, 'PR5-4', '2026-12-05', 'en_revision', 'ocr', 30, 'Prueba D01 R5', 'subida') returning id into v_i;
  insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, mime_type, size_bytes, supplier_invoice_id)
  values (v_acc, v_e, 'subida', 'factura', v_acc::text || '/prueba-r5/foto.jpg', 'foto.jpg', 'image/jpeg', 1000, v_i) returning id into v_d;
  update public.supplier_invoice set inbox_id = v_d where id = v_i;
  perform set_config('prueba.i4', v_i::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_q   uuid := current_setting('prueba.q')::uuid;
  v_sub text; v_i uuid; r jsonb; f jsonb;
begin
  -- 3 · Una factura anterior de «Aprendido», validada a 62100000 (noviembre: fuera del periodo).
  v_sub := public.company_account_add(v_e, '4000', 'Aprendido Prueba R5', null, 'supplier', v_q::text, 'Prueba D01 R5')->>'code';
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_q, v_e, 'PR5-0', '2026-11-20', 'aprobada', 'manual', 110, 100, 10, 'Prueba D01 R5') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-11-20', 'concepto', 'Factura Aprendido Prueba R5 · PR5-0', 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba D01 R5', 'documento', 'PR5-0'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62100000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PR5-0'),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PR5-0',
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', 'PR5-0')),
    null, 'Prueba D01 R5');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01 R5');
  -- Y una de diciembre, sin nada en la ficha.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel, reading_confidence, reading)
  values (v_acc, v_q, v_e, 'PR5-3', '2026-12-04', 'en_revision', 'ocr', 121, 'Prueba D01 R5', 'correo', 'seguro', '{"porque":["Todo cuadra y trae lo que pide la norma."]}');

  r := public.conta_documentos_recibidos(v_e, '2026-12-01', '2026-12-31');
  -- 1
  if jsonb_array_length(r->'filas') <> 4 then raise exception 'PRUEBA D01 R5 documentos · 1: % filas, no 4 (diciembre tenía algo ya): %', jsonb_array_length(r->'filas'), r->'filas'; end if;
  if (r->'cifras'->>'llegadas')::int <> 4 then
    raise exception 'PRUEBA D01 R5 documentos · 1: «llegadas» dice %, no 4: la del mes pasado se ha quedado fuera (seguía contando los últimos 7 días).', r->'cifras'->>'llegadas';
  end if;
  if (r->'cifras'->'llegadas_por_canal'->>'a_mano')::int <> 1 or (r->'cifras'->'llegadas_por_canal'->>'compras')::int <> 1
     or (r->'cifras'->'llegadas_por_canal'->>'correo')::int <> 1 or (r->'cifras'->'llegadas_por_canal'->>'subida')::int <> 1 then
    raise exception 'PRUEBA D01 R5 documentos · 1: por dónde: %', r->'cifras'->'llegadas_por_canal';
  end if;
  raise notice 'PRUEBA D01 R5 documentos · 1: llegadas 4, las del periodo (también la creada hace 30 días): %.', r->'cifras'->'llegadas_por_canal';
  -- 2
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-1';
  if (f->>'previas')::int <> 0 or f->'entendido' <> 'null'::jsonb or (f->'aprendido'->>'facturas')::int <> 0 or f->'aprendido'->>'porque' is null then
    raise exception 'PRUEBA D01 R5 documentos · 2: la primera de su proveedor: %', f;
  end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-2';
  if (f->>'previas')::int <> 1 then raise exception 'PRUEBA D01 R5 documentos · 2: la segunda del mismo proveedor no cuenta la primera: %', f; end if;
  raise notice 'PRUEBA D01 R5 documentos · 2: la primera de su proveedor: previas 0 y «%»; la segunda, previas 1.', (select x->'aprendido'->>'porque' from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-1');
  -- 3
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-3';
  if (f->>'previas')::int <> 1 or f->'entendido'->>'cuenta' <> '62100000' or not coalesce((f->'entendido'->>'sin_confirmar')::boolean, false)
     or f->'entendido'->>'origen' <> 'aprendido de tus facturas' or (f->'aprendido'->>'facturas')::int <> 1 then
    raise exception 'PRUEBA D01 R5 documentos · 3: lo aprendido: %', f;
  end if;
  raise notice 'PRUEBA D01 R5 documentos · 3: sin ficha, lo entendido es lo aprendido: % · % (%, sin confirmar).', f->'entendido'->>'nombre', f->'entendido'->>'cuenta', f->'entendido'->>'origen';
  -- 4
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-1';
  if f->>'canal' <> 'a_mano' then raise exception 'PRUEBA D01 R5 documentos · 4: la escrita a mano: %', f->>'canal'; end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-2';
  if f->>'canal' <> 'compras' then raise exception 'PRUEBA D01 R5 documentos · 4: la leída en Compras sale como %', f->>'canal'; end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-4';
  if f->>'canal' <> 'subida' or f->>'llegada_tipo' <> 'image/jpeg' then raise exception 'PRUEBA D01 R5 documentos · 4: la foto subida: % %', f->>'canal', f->>'llegada_tipo'; end if;
  raise notice 'PRUEBA D01 R5 documentos · 4: a mano, leída en Compras y foto subida, cada una por su nombre.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_documentos_recibidos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-12-01', '2026-12-31');
    raise exception 'PRUEBA D01 R5 documentos · 5: B ha leído los documentos de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 R5 documentos · 5: B ni los ve.';
end $$;
reset role;

rollback;
