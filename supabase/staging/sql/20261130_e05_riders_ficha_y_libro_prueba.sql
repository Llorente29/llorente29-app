-- ============================================================================
-- PRUEBA (staging) · E05 · la 0410: la ficha genérica de RIDERS no pide lo que
-- no tiene, y el libro de IVA lleva a cada rider con su NIF. Todo en una
-- transacción con ROLLBACK: no cambia staging. Datos inventados (ni un rider
-- de verdad).
--
-- La población es la FORMA de lo medido en Foodint el 21/10: una ficha
-- «Riders» sin NIF, sin tipo de gasto y sin forma de facturar, con la
-- 41000100 y su cuenta de gasto puesta; facturas de lote con el emisor en cada
-- una, una de un local y otra que reparte entre dos.
--
--   1. Lo que le falta a una ficha (compras_ficha_le_falta), como el
--      administrador de A: a «Riders», nada; a una ficha normal sin nada, las
--      tres de siempre; a una normal con «Sus facturas se apuntan en», todo
--      menos el tipo de gasto.
--   2. El libro de IVA de una factura del lote ya asentada: la contraparte es
--      el emisor (su NIF/NIE y su nombre), no «Riders» sin NIF; y una factura
--      normal de un proveedor con NIF sigue llevando el de su ficha.
--   3. Las puertas: sin usuario no se lee lo que le falta a una ficha.
--   4. La vuelta atrás de la 0410 deja las dos funciones como en producción el
--      21/10 (md5 del cuerpo).
-- ============================================================================

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 0410: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · Preparar (como postgres): la 41000100 y la 62400000, «Riders» con las dos,
-- dos fichas normales y los PDF del lote subidos.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_r uuid; v_n uuid; v_g uuid; v_ca uuid; v_gasto uuid; v_plan text;
begin
  select plan into v_plan from public.company_account where company_id = v_e limit 1;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (v_acc, v_e, v_plan, '41000100', '4100', 'Acreedores · RIDERS (prueba 0410)', 'own', 'manual', 'Prueba 0410')
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41000100';
  select id into v_gasto from public.company_account where company_id = v_e and code = '62400000';
  if v_ca is null or v_gasto is null then raise exception 'PRUEBA 0410 · 0: faltan la 41000100 o la 62400000 en el plan de A.'; end if;

  insert into public.supplier (account_id, name, legal_name, is_active, created_by_name) values (v_acc, 'Riders (prueba 0410)', 'Riders', true, 'Prueba 0410') returning id into v_r;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_r::text, 'principal', 'manual'), (v_acc, v_e, v_gasto, 'supplier', v_r::text, 'gasto', 'manual');
  -- Una ficha normal sin nada, y otra con su cuenta de gasto puesta y sin tipo de gasto.
  insert into public.supplier (account_id, name, is_active, created_by_name) values (v_acc, 'Proveedor Sin Nada (prueba 0410)', true, 'Prueba 0410') returning id into v_n;
  insert into public.supplier (account_id, name, tax_id, is_active, created_by_name) values (v_acc, 'Proveedor Con Gasto (prueba 0410)', 'B00000410', true, 'Prueba 0410') returning id into v_g;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_gasto, 'supplier', v_g::text, 'gasto', 'manual');
  insert into storage.objects (bucket_id, name, metadata)
  select 'receipt-uploads', v_acc::text || '/prueba-0410/' || x || '.pdf', '{"size": 2000, "mimetype": "application/pdf"}'
    from unnest(array['r1', 'r2']) x;
  perform set_config('prueba.riders', v_r::text, true);
  perform set_config('prueba.normal', v_n::text, true);
  perform set_config('prueba.congasto', v_g::text, true);
  perform set_config('prueba.loc1', (select id::text from public.locations where account_id = v_acc order by created_at limit 1), true);
  perform set_config('prueba.loc2', (select id::text from public.locations where account_id = v_acc order by created_at offset 1 limit 1), true);
end $$;

-- 1–2 · Como administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_l1 text := current_setting('prueba.loc1'); v_l2 text := current_setting('prueba.loc2');
  bien jsonb := '[{"id":"numero","ok":true,"texto":"x"}]';
  r jsonb; v_lote uuid; v_i public.supplier_invoice; v_entry uuid; v jsonb; v_falta jsonb;
begin
  r := public.conta_lote_registrar(v_e, jsonb_build_object('proveedor', 'catcher', 'desde', '2026-09-01', 'hasta', '2026-09-15',
    'etiqueta', '1.ª quincena de septiembre de 2026 (prueba 0410)',
    'ficheros', '[{"clase":"zip","nombre":"q.zip"},{"clase":"facturas","nombre":"f.xlsx"},{"clase":"pedidos","nombre":"p.xlsx"}]'::jsonb,
    'avisos', '[]'::jsonb, 'pedidos', '[]'::jsonb,
    'facturas', jsonb_build_array(
      jsonb_build_object('numero', 'ES_I_4101_26_7', 'tipo', 'rider', 'fecha', '2026-09-15', 'emisor', jsonb_build_object('nombre', 'RIDER INVENTADO CUATRO', 'nif', 'Y0000041T', 'domicilio', 'Calle Falsa 41, 28041 Madrid'),
        'base', 132.59, 'cuota', 27.84, 'total', 160.43, 'tipoIva', 21, 'pedidos', 20, 'periodo', '{"desde":"2026-09-01","hasta":"2026-09-15"}'::jsonb, 'localId', v_l1,
        'reparto', jsonb_build_array(jsonb_build_object('tienda', 'FoodInt Camichi', 'localId', v_l1, 'total', 132.59)), 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
        'pdf', jsonb_build_object('ruta', v_acc::text || '/prueba-0410/r1.pdf', 'nombre', 'invoice_4101_ES_I_4101_26_7.pdf', 'sha256', repeat('b1', 32), 'bytes', 2000)),
      jsonb_build_object('numero', 'ES_I_4102_26_7', 'tipo', 'rider', 'fecha', '2026-09-15', 'emisor', jsonb_build_object('nombre', 'RIDER INVENTADA CINCO', 'nif', '00000042R', 'domicilio', 'Calle Falsa 42, 28042 Madrid'),
        'base', 19.98, 'cuota', 4.2, 'total', 24.18, 'tipoIva', 21, 'pedidos', 4, 'periodo', '{"desde":"2026-09-01","hasta":"2026-09-15"}'::jsonb, 'localId', null,
        'reparto', jsonb_build_array(jsonb_build_object('tienda', 'FoodInt Camichi', 'localId', v_l1, 'total', 15.29), jsonb_build_object('tienda', 'FoodInt Florencio Llorente', 'localId', v_l2, 'total', 4.69)),
        'requisitos', bien, 'contraPdf', bien, 'confianza', 'duda',
        'pdf', jsonb_build_object('ruta', v_acc::text || '/prueba-0410/r2.pdf', 'nombre', 'invoice_4102_ES_I_4102_26_7.pdf', 'sha256', repeat('b2', 32), 'bytes', 2000)))),
    'Prueba 0410');
  v_lote := (r->>'lote_id')::uuid;
  if (select count(*) from public.supplier_invoice where batch_id = v_lote and supplier_id::text = current_setting('prueba.riders') and source = 'lote') <> 2 then
    raise exception 'PRUEBA 0410 · 0: el lote no ha dejado sus dos facturas en «Riders»: %', r;
  end if;

  -- 1 · Lo que le falta a cada ficha.
  v_falta := public.compras_ficha_le_falta(current_setting('prueba.riders')::uuid);
  if v_falta <> '[]'::jsonb then raise exception 'PRUEBA 0410 · 1: a «Riders» (ficha de lote, con su gasto) le pide %', v_falta; end if;
  v_falta := public.compras_ficha_le_falta(current_setting('prueba.normal')::uuid);
  if (select array_agg(x->>'falta' order by x->>'falta') from jsonb_array_elements(v_falta) x) <> array['forma_facturar', 'nif', 'tipo_gasto'] then
    raise exception 'PRUEBA 0410 · 1: a una ficha normal sin nada ya no le pide las tres: %', v_falta;
  end if;
  v_falta := public.compras_ficha_le_falta(current_setting('prueba.congasto')::uuid);
  if (select array_agg(x->>'falta' order by x->>'falta') from jsonb_array_elements(v_falta) x) <> array['forma_facturar'] then
    raise exception 'PRUEBA 0410 · 1: a una ficha con su gasto puesto y su NIF le pide %', v_falta;
  end if;
  raise notice 'PRUEBA 0410 · 1: a «Riders», nada; a una ficha sin nada, NIF, tipo de gasto y forma de facturar; con su gasto puesto, solo la forma de facturar.';

  -- 2 · La del rider cuatro, asentada y validada: el libro de IVA lleva su NIE y su nombre.
  select * into v_i from public.supplier_invoice where batch_id = v_lote and invoice_number = 'ES_I_4101_26_7';
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-15', 'concepto', 'Factura RIDER INVENTADO CUATRO · ES_I_4101_26_7', 'source_type', 'supplier_invoice', 'source_id', v_i.id,
                       'confianza', 'seguro', 'porque', 'Prueba 0410', 'documento', 'ES_I_4101_26_7'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 132.59, 'haber', 0, 'local_id', v_l1, 'comun', false, 'documento', 'ES_I_4101_26_7'),
      jsonb_build_object('cuenta', '47200021', 'debe', 27.84, 'haber', 0, 'local_id', v_l1, 'comun', false, 'documento', 'ES_I_4101_26_7',
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 132.59, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000100', 'debe', 0, 'haber', 160.43, 'local_id', v_l1, 'comun', false, 'documento', 'ES_I_4101_26_7')),
    null, 'Prueba 0410');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba 0410');
  select to_jsonb(b) into v from public.vat_book_entry b where b.entry_id = v_entry;
  if v is null then raise exception 'PRUEBA 0410 · 2: el asiento validado no ha escrito su fila del libro de IVA.'; end if;
  if v->>'counterpart_tax_id' is distinct from 'Y0000041T' or v->>'counterpart_name' is distinct from 'RIDER INVENTADO CUATRO'
     or (v->>'tax_base')::numeric <> 132.59 or (v->>'tax_amount')::numeric <> 27.84 or v->>'book' <> 'received' then
    raise exception 'PRUEBA 0410 · 2: el libro de IVA no lleva al rider: % % base % cuota %', v->>'counterpart_tax_id', v->>'counterpart_name', v->>'tax_base', v->>'tax_amount';
  end if;
  -- Lo mismo que va a Diez (0110): el emisor.
  r := public.conta_recibida_envio(v_entry);
  if r->'proveedor'->>'nif' <> 'Y0000041T' then raise exception 'PRUEBA 0410 · 2: a Diez no va el emisor: %', r->'proveedor'; end if;
  raise notice 'PRUEBA 0410 · 2: una factura del lote, al validarse, va al libro de IVA con el NIE y el nombre de su rider (y a Diez igual), no como «Riders» sin NIF.';
end $$;
reset role;

-- 2 (bis) · Una recibida normal, no de lote, sigue llevando el NIF de su ficha
-- (como postgres: la factura se siembra a mano, el asiento por sus funciones).
do $$
declare
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_sup uuid := current_setting('prueba.congasto')::uuid; v_ca uuid; v_si uuid; r jsonb; v_entry uuid; v jsonb;
begin
  select id into v_ca from public.company_account where company_id = v_e and code = '41000100';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_sup::text, 'principal', 'manual');
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, issuer_tax_id, issuer_name, created_by_name)
  values (v_acc, v_e, v_sup, 'N-0410', '2026-09-15', 12.1, 'aprobada', 'manual', 'B99999999', 'OTRO NOMBRE LEÍDO', 'Prueba 0410')
  returning id into v_si;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-09-15', 'concepto', 'Factura Proveedor Con Gasto · N-0410', 'source_type', 'supplier_invoice', 'source_id', v_si,
                       'confianza', 'seguro', 'porque', 'Prueba 0410', 'documento', 'N-0410'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62400000', 'debe', 10, 'haber', 0, 'comun', true, 'documento', 'N-0410'),
      jsonb_build_object('cuenta', '47200021', 'debe', 2.1, 'haber', 0, 'comun', true, 'documento', 'N-0410',
                         'iva', jsonb_build_object('tipo_id', '28f9a398-2c95-4a3c-aebe-66d8cf37154f', 'base', 10, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000100', 'debe', 0, 'haber', 12.1, 'comun', true, 'documento', 'N-0410')),
    null, 'Prueba 0410');
  v_entry := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_entry, 'Prueba 0410');
  select to_jsonb(b) into v from public.vat_book_entry b where b.entry_id = v_entry;
  if v->>'counterpart_tax_id' is distinct from 'B00000410' then
    raise exception 'PRUEBA 0410 · 2 (bis): una recibida normal ya no lleva el NIF de su ficha: %', v->>'counterpart_tax_id';
  end if;
  raise notice 'PRUEBA 0410 · 2 (bis): una recibida que no es de lote sigue con el NIF de su ficha (aunque traiga otro emisor leído).';
end $$;

-- 3 · Sin usuario no se lee lo que le falta a una ficha.
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
begin
  begin
    perform public.compras_ficha_le_falta(current_setting('prueba.riders')::uuid);
    raise exception 'PRUEBA 0410 · 3: sin usuario se lee lo que le falta a una ficha.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA 0410 · 3: sin usuario, no.';
end $$;
reset role;

-- 4 · La vuelta atrás deja las dos funciones como en producción el 21/10.
\i supabase/vuelta-atras/20261130T0410_e05_riders_ficha_y_libro.down.sql
do $$
declare v_f text; v_l text;
begin
  select md5(prosrc) into v_f from pg_proc where oid = 'public.compras_ficha_le_falta(uuid)'::regprocedure;
  select md5(prosrc) into v_l from pg_proc where oid = 'public.conta_vat_book_desde_asiento(uuid)'::regprocedure;
  if v_f <> '5dbcedf7f850fdd8643993ea06e25eec' or v_l <> '08eb4f42e58e105460e64a6396169c51' then
    raise exception 'PRUEBA 0410 · 4: la vuelta atrás no deja los cuerpos de producción: % %', v_f, v_l;
  end if;
  raise notice 'PRUEBA 0410 · 4: vuelta atrás: las dos funciones, byte a byte las de producción del 21/10 (md5 5dbcedf7… y 08eb4f42…).';
end $$;

rollback;
