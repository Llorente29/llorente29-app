-- supabase/staging/sql/20261112_e05_lotes_prueba.sql
--
-- SOLO STAGING. Prueba de 20261112T0100 (E05, los lotes de Catcher) y de
-- 20261112T0110 (conta_recibida_envio con el emisor). Todo en una transacción
-- con ROLLBACK: no cambia staging. Datos inventados (ni un rider de verdad).
--
--   0. La estructura: el emisor en la factura, el origen «lote», las tres
--      tablas nuevas y que un usuario no escribe en ellas.
--   1. Una quincena (dos riders, una flota y Catcher sin ficha), como
--      administrador de A: el lote, sus pedidos, una entrada en la bandeja y
--      una factura en revisión por PDF; el emisor en cada una; los riders y la
--      flota al proveedor «Riders» (41000100); Catcher sin proveedor y su alta
--      propuesta; segura solo la que tiene local y su PDF cuadra.
--   2. La misma quincena otra vez: no crea nada y lo dice.
--   3. Otra quincena que trae una factura que ya estaba: no entra dos veces.
--   4. Lo que no se acepta: un PDF que no está subido, base + IVA ≠ total.
--   5. conta_recibida_envio de una factura del lote, ya asentada: el emisor
--      (no la ficha «Riders», que no tiene NIF) es lo que va a Diez.
--   6. B no registra lotes en A ni ve los de A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E05 lotes: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · Preparar (como postgres): la 41000100 con el proveedor «Riders» y los PDF subidos.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_r uuid; v_ca uuid; v_plan text; n int;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name in ('issuer_name', 'issuer_tax_id', 'issuer_address', 'batch_id') having count(*) = 4) then
    raise exception 'PRUEBA E05 lotes · 0: faltan las columnas del emisor o del lote en supplier_invoice.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'supplier_invoice_source_check')) not like '%lote%' then
    raise exception 'PRUEBA E05 lotes · 0: el origen «lote» no está en el CHECK de source.';
  end if;
  select count(*) into n from information_schema.tables where table_schema = 'public' and table_name in ('supplier_batch', 'supplier_batch_order', 'supplier_batch_store');
  if n <> 3 then raise exception 'PRUEBA E05 lotes · 0: faltan tablas del lote (% de 3).', n; end if;
  raise notice 'PRUEBA E05 lotes · 0: el emisor y el lote en la factura, el origen «lote» y las tres tablas.';

  select plan into v_plan from public.company_account where company_id = v_e limit 1;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (v_acc, v_e, v_plan, '41000100', '4100', 'Acreedores · RIDERS (prueba E05)', 'own', 'manual', 'Prueba E05')
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41000100';
  insert into public.supplier (account_id, name, legal_name, is_active, created_by_name) values (v_acc, 'Riders (prueba E05)', 'Riders', true, 'Prueba E05') returning id into v_r;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_r::text, 'principal', 'manual');
  insert into storage.objects (bucket_id, name, metadata)
  select 'receipt-uploads', v_acc::text || '/e05-prueba/' || x || '.pdf', '{"size": 2000, "mimetype": "application/pdf"}'
    from unnest(array['r1', 'r2', 'f1', 'c1', 'r9']) x;
  perform set_config('prueba.riders', v_r::text, true);
  perform set_config('prueba.loc1', (select id::text from public.locations where account_id = v_acc order by created_at limit 1), true);
  perform set_config('prueba.loc2', (select id::text from public.locations where account_id = v_acc order by created_at offset 1 limit 1), true);
end $$;

-- 1–5 · Como administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_l1 text := current_setting('prueba.loc1'); v_l2 text := current_setting('prueba.loc2');
  bien jsonb := '[{"id":"numero","ok":true,"texto":"x"}]';
  fac jsonb; lote jsonb; r jsonb; v_lote uuid; v_n int; v_falla text; v_i public.supplier_invoice; v_entry uuid; v_sub text;
begin
  -- Una factura del lote, como la deja el navegador (catcherQuincena.ts).
  fac := jsonb_build_array(
    jsonb_build_object('numero', 'ES_I_1001_26_7', 'tipo', 'rider', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'RIDER INVENTADO UNO', 'nif', '00000001-R', 'domicilio', 'Calle Falsa 1, 28001 Madrid'),
      'base', 8.2, 'cuota', 1.72, 'total', 9.92, 'tipoIva', 21, 'pedidos', 2, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', v_l1,
      'reparto', jsonb_build_array(jsonb_build_object('tienda', 'FoodInt Camichi', 'localId', v_l1, 'total', 8.2)), 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/r1.pdf', 'nombre', 'invoice_1001_ES_I_1001_26_7.pdf', 'sha256', repeat('a1', 32), 'bytes', 2000)),
    jsonb_build_object('numero', 'ES_I_1002_26_7', 'tipo', 'rider', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'RIDER INVENTADA DOS', 'nif', 'X0000002T', 'domicilio', 'Calle Falsa 2, 28002 Madrid'),
      'base', 20.4, 'cuota', 4.28, 'total', 24.68, 'tipoIva', 21, 'pedidos', 5, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', null,
      'reparto', jsonb_build_array(jsonb_build_object('tienda', 'FoodInt Camichi', 'localId', v_l1, 'total', 12.24), jsonb_build_object('tienda', 'FoodInt Florencio Llorente', 'localId', v_l2, 'total', 8.16)),
      'requisitos', bien, 'contraPdf', bien, 'confianza', 'duda',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/r2.pdf', 'nombre', 'invoice_1002_ES_I_1002_26_7.pdf', 'sha256', repeat('a2', 32), 'bytes', 2000)),
    jsonb_build_object('numero', 'ES_F_2001_26_7', 'tipo', 'flota', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'FLOTA INVENTADA, S.L.', 'nif', 'B00000044', 'domicilio', 'Polígono Inventado 4, 28004 Madrid'),
      'base', 4.7, 'cuota', 0.99, 'total', 5.69, 'tipoIva', 21, 'pedidos', 1, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', v_l2,
      'reparto', '[]'::jsonb, 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/f1.pdf', 'nombre', 'invoice_fleet_2001_ES_F_2001_26_7.pdf', 'sha256', repeat('a3', 32), 'bytes', 2000)),
    jsonb_build_object('numero', 'CMS_2026_09_2', 'tipo', 'catcher', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'Catcher Marketplace SL', 'nif', 'B00000055', 'domicilio', 'Avenida Inventada 5, 28005 Madrid'),
      'base', 3.16, 'cuota', 0.66, 'total', 3.82, 'tipoIva', 21, 'pedidos', 4, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', v_l1,
      'reparto', '[]'::jsonb, 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/c1.pdf', 'nombre', 'invoice_3001_CMS_2026_09_2.pdf', 'sha256', repeat('a4', 32), 'bytes', 2000)));
  lote := jsonb_build_object('proveedor', 'catcher', 'desde', '2026-09-16', 'hasta', '2026-09-30', 'etiqueta', '2.ª quincena de septiembre de 2026',
    'ficheros', '[{"clase":"zip","nombre":"q.zip"},{"clase":"facturas","nombre":"f.xlsx"},{"clase":"pedidos","nombre":"p.xlsx"}]'::jsonb,
    'avisos', '[]'::jsonb, 'facturas', fac,
    'pedidos', jsonb_build_array(
      jsonb_build_object('factura', 'ES_I_1001_26_7', 'tipo', 'rider to pitcher', 'codigo', 'G901', 'estado', 'finish', 'momento', '2026-09-16T11:05:00Z', 'base', 4.2, 'cuota', 0.88, 'total', 5.08),
      jsonb_build_object('factura', 'ES_I_1001_26_7', 'tipo', 'rider to pitcher', 'codigo', 'G901', 'estado', 'finish', 'momento', '2026-09-27T18:15:00Z', 'base', 4.0, 'cuota', 0.84, 'total', 4.84),
      jsonb_build_object('factura', 'CMS_2026_09_2', 'tipo', 'pitcher commissions', 'codigo', 'G236', 'estado', 'canceled', 'momento', '2026-09-23T14:29:00Z', 'base', 0.79, 'cuota', 0.17, 'total', 0.96)));

  -- 1
  r := public.conta_lote_registrar(v_e, lote, 'Prueba E05');
  v_lote := (r->>'lote_id')::uuid;
  if (r->>'ya_estaba')::boolean or (r->>'facturas')::int <> 4 or not (r->>'catcher_sin_ficha')::boolean or (r->>'total')::numeric <> 44.11 then
    raise exception 'PRUEBA E05 lotes · 1: %', r;
  end if;
  if r->>'texto' <> 'Subida la 2.ª quincena de septiembre de 2026: 4 facturas (44,11 €).' then raise exception 'PRUEBA E05 lotes · 1: el texto no dice lo que ha hecho: %', r->>'texto'; end if;
  if (select count(*) from public.supplier_invoice where batch_id = v_lote and source = 'lote' and arrival_channel = 'portal' and status = 'en_revision') <> 4 then
    raise exception 'PRUEBA E05 lotes · 1: no hay cuatro facturas del lote en revisión.';
  end if;
  if (select count(*) from public.document_inbox i join public.supplier_invoice f on f.id = i.supplier_invoice_id where f.batch_id = v_lote and i.channel = 'portal' and i.status = 'factura') <> 4 then
    raise exception 'PRUEBA E05 lotes · 1: no hay cuatro entradas en la bandeja con su factura.';
  end if;
  select * into v_i from public.supplier_invoice where batch_id = v_lote and invoice_number = 'ES_I_1001_26_7';
  if v_i.supplier_id::text <> current_setting('prueba.riders') or v_i.issuer_tax_id <> '00000001R' or v_i.issuer_name <> 'RIDER INVENTADO UNO'
     or v_i.issuer_address is null or v_i.location_id::text <> v_l1 or v_i.reading_confidence <> 'seguro' or v_i.reading->'factura'->'proveedor'->>'nif' <> '00000001R' then
    raise exception 'PRUEBA E05 lotes · 1: el rider uno no queda como debe: % % % %', v_i.supplier_id, v_i.issuer_tax_id, v_i.location_id, v_i.reading_confidence;
  end if;
  if (select reading_confidence from public.supplier_invoice where batch_id = v_lote and invoice_number = 'ES_I_1002_26_7') <> 'duda'
     or (select location_id from public.supplier_invoice where batch_id = v_lote and invoice_number = 'ES_I_1002_26_7') is not null then
    raise exception 'PRUEBA E05 lotes · 1: la que reparte en dos tiendas no queda sin local y por aclarar.';
  end if;
  if (select supplier_id from public.supplier_invoice where batch_id = v_lote and invoice_number = 'ES_F_2001_26_7')::text <> current_setting('prueba.riders') then
    raise exception 'PRUEBA E05 lotes · 1: la flota no va al proveedor «Riders».';
  end if;
  if (select supplier_id from public.supplier_invoice where batch_id = v_lote and invoice_number = 'CMS_2026_09_2') is not null
     or (select reading_confidence from public.supplier_invoice where batch_id = v_lote and invoice_number = 'CMS_2026_09_2') <> 'duda'
     or not exists (select 1 from public.document_activity where account_id = v_acc and action = 'proveedor_propuesto' and detail->>'lote' = v_lote::text) then
    raise exception 'PRUEBA E05 lotes · 1: Catcher sin ficha no queda sin proveedor, por aclarar y con su alta propuesta.';
  end if;
  if (select count(*) from public.supplier_batch_order where batch_id = v_lote) <> 3
     or (select count(distinct (order_code, ordered_at)) from public.supplier_batch_order where batch_id = v_lote and order_code = 'G901') <> 2
     or (select count(*) from public.supplier_batch_order where batch_id = v_lote and supplier_invoice_id is null) <> 0 then
    raise exception 'PRUEBA E05 lotes · 1: los pedidos no quedan con su factura (G901 dos veces, G236 cancelado).';
  end if;
  if (select (invoice_count, grand_total, tax_base_total, tax_total) from public.supplier_batch where id = v_lote) is distinct from (4, 44.11::numeric(14,2), 36.46::numeric(14,2), 7.65::numeric(14,2)) then
    raise exception 'PRUEBA E05 lotes · 1: el lote no suma lo que sus facturas.';
  end if;
  raise notice 'PRUEBA E05 lotes · 1: %', r->>'texto';

  -- 2
  r := public.conta_lote_registrar(v_e, lote, 'Prueba E05');
  if not (r->>'ya_estaba')::boolean or (r->>'lote_id')::uuid <> v_lote or r->>'texto' not like 'La 2.ª quincena de septiembre de 2026 ya estaba subida (4 facturas,%No se ha creado nada.' then
    raise exception 'PRUEBA E05 lotes · 2: %', r;
  end if;
  if (select count(*) from public.supplier_invoice where account_id = v_acc and source = 'lote') <> 4 or (select count(*) from public.supplier_batch where account_id = v_acc) <> 1 then
    raise exception 'PRUEBA E05 lotes · 2: la misma quincena otra vez ha creado algo.';
  end if;
  raise notice 'PRUEBA E05 lotes · 2: %', r->>'texto';

  -- 3 · La 1.ª quincena trae, por error, la ES_I_1001_26_7 (mismo emisor, número y total) y una nueva.
  r := public.conta_lote_registrar(v_e, jsonb_build_object('proveedor', 'catcher', 'desde', '2026-09-01', 'hasta', '2026-09-15', 'etiqueta', '1.ª quincena de septiembre de 2026',
    'facturas', jsonb_build_array(fac->0 || jsonb_build_object('pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/r9.pdf', 'nombre', 'otra.pdf', 'sha256', repeat('a9', 32), 'bytes', 2000)),
                                  fac->2 || jsonb_build_object('numero', 'ES_F_2001_26_6', 'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/r9.pdf', 'nombre', 'f6.pdf', 'sha256', repeat('b9', 32), 'bytes', 2000)))), 'Prueba E05');
  if (r->>'facturas')::int <> 1 or (r->>'ya_estaban')::int <> 1 or r->>'texto' not like '%1 ya estaba y no se ha vuelto a apuntar.' then raise exception 'PRUEBA E05 lotes · 3: %', r; end if;
  if (select count(*) from public.supplier_invoice where account_id = v_acc and public.conta_clave_numero(invoice_number) = 'ESI1001267') <> 1 then
    raise exception 'PRUEBA E05 lotes · 3: la que ya estaba ha entrado dos veces.';
  end if;
  raise notice 'PRUEBA E05 lotes · 3: %', r->>'texto';

  -- 4
  begin
    perform public.conta_lote_registrar(v_e, jsonb_build_object('proveedor', 'catcher', 'desde', '2026-08-16', 'hasta', '2026-08-31',
      'facturas', jsonb_build_array(fac->1 || jsonb_build_object('numero', 'X-1', 'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/no-esta.pdf', 'nombre', 'x.pdf', 'sha256', repeat('c1', 32), 'bytes', 2000)))), 'Prueba E05');
    v_falla := null;
  exception when sqlstate 'P0002' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 lotes · 4: ha aceptado un PDF que no está subido.'; end if;
  begin
    perform public.conta_lote_registrar(v_e, jsonb_build_object('proveedor', 'catcher', 'desde', '2026-08-16', 'hasta', '2026-08-31',
      'facturas', jsonb_build_array(fac->1 || jsonb_build_object('numero', 'X-2', 'total', 99))), 'Prueba E05');
    v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 lotes · 4: ha aceptado una factura cuya base + IVA no es el total.'; end if;
  begin
    perform public.conta_lote_registrar(v_e, '{"proveedor":"catcher","desde":"2026-08-16","hasta":"2026-08-31"}', 'Prueba E05');
    v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 lotes · 4: ha aceptado un lote sin facturas (sin la clave).'; end if;
  if exists (select 1 from public.supplier_batch where account_id = v_acc and period_from = '2026-08-16') then raise exception 'PRUEBA E05 lotes · 4: un lote rechazado ha dejado algo.'; end if;
  raise notice 'PRUEBA E05 lotes · 4: un PDF que no está subido, no; base + IVA ≠ total, no; un lote sin facturas, no; y no deja nada.';

  -- 5 · La del rider uno, asentada: lo que va a Diez es el emisor, no la ficha «Riders».
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-30', 'concepto', 'Factura Riders · ES_I_1001_26_7', 'source_type', 'supplier_invoice', 'source_id', v_i.id,
                       'confianza', 'seguro', 'porque', 'Prueba E05', 'documento', 'ES_I_1001_26_7'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 8.2, 'haber', 0, 'local_id', v_l1, 'comun', false, 'documento', 'ES_I_1001_26_7'),
      jsonb_build_object('cuenta', '47200021', 'debe', 1.72, 'haber', 0, 'local_id', v_l1, 'comun', false, 'documento', 'ES_I_1001_26_7',
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 8.2, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000100', 'debe', 0, 'haber', 9.92, 'local_id', v_l1, 'comun', false, 'documento', 'ES_I_1001_26_7')),
    null, 'Prueba E05');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba E05');
  r := public.conta_recibida_envio(v_entry);
  if r->'proveedor'->>'nif' <> '00000001R' or r->'proveedor'->>'nombre' <> 'RIDER INVENTADO UNO' then raise exception 'PRUEBA E05 lotes · 5: a Diez no va el emisor: %', r->'proveedor'; end if;
  raise notice 'PRUEBA E05 lotes · 5: lo que va a Diez de una factura del lote es su emisor (nombre y NIF/NIE), no la ficha «Riders».';
  perform set_config('prueba.lote', v_lote::text, true);

  -- 0 (usuario) · Nadie escribe en las tablas del lote a mano.
  begin
    insert into public.supplier_batch_store (account_id, company_id, provider, store_name, location_id) values (v_acc, v_e, 'catcher', 'Tienda', v_l1::uuid);
    raise exception 'PRUEBA E05 lotes · 0: un usuario escribe en supplier_batch_store.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA E05 lotes · 0: un usuario no escribe en las tablas del lote.';
end $$;
reset role;

-- 6 · Como administrador de B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_lote_registrar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '{"proveedor":"catcher","desde":"2026-07-16","hasta":"2026-07-31","facturas":[{}]}', 'B');
    raise exception 'PRUEBA E05 lotes · 6: B ha registrado un lote en A.';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.supplier_batch where id = current_setting('prueba.lote')::uuid)
     or exists (select 1 from public.supplier_batch_order where batch_id = current_setting('prueba.lote')::uuid) then
    raise exception 'PRUEBA E05 lotes · 6: B ve el lote de A o sus pedidos.';
  end if;
  raise notice 'PRUEBA E05 lotes · 6: B no registra lotes en A ni ve los suyos.';
end $$;
reset role;

rollback;
