-- ============================================================================
-- PRUEBA (staging) · Compras · 5 · la factura sale del papel; la aprobación,
-- en la base. Todo en una transacción con ROLLBACK.
--
-- Prueba la 0140 sobre goods_receipt_path (su disparador), el constructor
-- _compras_factura_desde_papel, la puerta compras_factura_desde_papel y el
-- disparador de aprobación de supplier_invoice.
--
-- Los papeles tienen la forma de los de octubre de Foodint (T1 §2): un
-- albarán-factura con líneas al 10 y al 21 % cuya base y cuota por tipo
-- cuadran con la cabecera, un albarán sin importes por línea, y el mismo
-- papel subido dos veces. Nombres inventados.
--
--   1. Albarán-factura de «con cada entrega» al confirmar: UNA factura, en
--      revisión, con sus líneas, su base y su IVA, su empresa, enlazada a la
--      recepción; la recepción entra al almacén igual (§7.1).
--   2. El mismo papel en otra recepción: no hay segunda factura, se enlaza.
--   3. Una factura sin importes por línea: no se crea, y se dice.
--   4. Un albarán y una recepción del que liquida: ninguna factura (§7.8).
--   5. Contestar «a nombre de la empresa» crea la factura en ese momento.
--   6. Anterior al corte de la empresa: no se crea.
--   7. La factura sin recepción, por Compras; dos veces, una sola; sin
--      usuario, no.
--   8. Aprobar, en la base: el encargado no aprueba la que pide administrador
--      (por la API, como lo haría el navegador); el administrador sí, y queda
--      quién y cuándo.
--   9. Si crear la factura FALLA, la recepción se confirma igual y el camino
--      lo dice.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.sesion(p_doc text, p_num text, p_nombre text, p_lineas jsonb, p_base numeric, p_iva numeric, p_total numeric)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', jsonb_build_object('doc_type', p_doc, 'doc_number', p_num, 'doc_date', '2026-10-06',
                               'bill_to_name', p_nombre, 'tax_base_total', p_base, 'tax_total', p_iva, 'grand_total', p_total),
                             'lines', p_lineas, 'confidence', 0.9), 'pending_review')
  returning id into v;
  return v;
end $$;

create function pg_temp.recepcion(p_id uuid, p_sup uuid, p_sesion uuid, p_dia date, p_con_linea boolean)
returns uuid language plpgsql as $$
begin
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_sup, 'borrador', p_dia, p_sesion, 'P-' || right(p_id::text, 3), 'prueba');
  if p_con_linea then
    insert into goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
    values ('c01a0000-0000-4000-8000-00000000000a', p_id, 'Barril', 10, '7e000000-0000-4000-8000-000000000a01', 10, 0.6);
  end if;
  perform confirm_goods_receipt(p_id);
  return p_id;
end $$;

create function pg_temp.camino(p_id uuid) returns goods_receipt_path language sql as $$
  select * from goods_receipt_path where goods_receipt_id = p_id
$$;

create temp table _ids (que text primary key, id uuid) on commit drop;

-- ── 1 · Albarán-factura de «con cada entrega» ──────────────────────────────
do $$
declare
  c_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_p1 uuid := 'c0d00000-0000-4000-8000-000000000001';
  v_s uuid := 'c0d00000-0000-4000-8000-000000000002';
  v_ses uuid; p goods_receipt_path; f supplier_invoice; v_n int;
begin
  insert into supplier (id, account_id, name, tax_id, invoicing_mode, created_by_name) values
    (v_p1, c_cuenta, 'Hornos Prueba Cinco, S.L.', 'B00000055', 'per_delivery', 'prueba'),
    (v_s,  c_cuenta, 'Marcas Prueba Seis, S.L.', 'B00000066', 'monthly_settlement', 'prueba');
  -- Dos líneas al 10 % y una al 21 %: base 100,00 + 23,10; IVA 10,00 + 4,85; total 137,95.
  v_ses := pg_temp.sesion('albaran_factura', 'AF-001', 'TABERNA DE PRUEBA NORTE, S.L.',
     '[{"raw_text": "Pan", "line_amount": 60.00, "vat_pct": 10, "quantity": 30, "unit_price_net": 2.0},
       {"raw_text": "Bollo", "line_amount": 40.00, "vat_pct": 10, "quantity": 20, "unit_price_net": 2.0},
       {"raw_text": "Bolsa", "line_amount": 23.10, "vat_pct": 21, "quantity": 1, "unit_price_net": 23.10}]'::jsonb,
     123.10, 14.85, 137.95);
  insert into _ids values ('sesion_af', v_ses);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000101', v_p1, v_ses, date '2026-10-06', true);
  p := pg_temp.camino('c0d00000-0000-4000-8000-000000000101');
  select * into f from supplier_invoice where id = p.supplier_invoice_id;
  select count(*) into v_n from supplier_invoice where ai_session_id = v_ses;
  if p.path <> 'factura' or f.id is null or v_n <> 1 then
    raise exception 'PRUEBA factura · 1: el camino es % y hay % factura(s) de ese papel (esperaba factura y 1).', p.path, v_n;
  end if;
  if f.status <> 'en_revision' or f.invoice_number <> 'AF-001' or f.tax_base_total <> 123.10 or f.tax_total <> 14.85 or f.grand_total <> 137.95
     or f.company_id <> '3b34403a-a7d6-4a48-a8d7-737e8cababdc' or f.supplier_id <> v_p1 or f.needs_review then
    raise exception 'PRUEBA factura · 1: la factura no es la del papel (% / % / % / % / % / empresa %).', f.status, f.invoice_number, f.tax_base_total, f.tax_total, f.grand_total, f.company_id;
  end if;
  if (select count(*) from supplier_invoice_line where supplier_invoice_id = f.id) <> 3
     or (select sum(line_amount) from supplier_invoice_line where supplier_invoice_id = f.id and vat_pct = 10) <> 100.00
     or not exists (select 1 from supplier_invoice_receipt where supplier_invoice_id = f.id and goods_receipt_id = 'c0d00000-0000-4000-8000-000000000101')
     or p.consumed_at is null then
    raise exception 'PRUEBA factura · 1: líneas, enlace con la recepción o consumo del camino mal.';
  end if;
  select count(*) into v_n from stock_movement m join goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = 'c0d00000-0000-4000-8000-000000000101';
  if v_n <> 1 then raise exception 'PRUEBA factura · 1: la recepción no ha entrado al almacén (% movimientos).', v_n; end if;
  insert into _ids values ('factura_af', f.id);
  raise notice '1 · §7.1: una factura % en revisión, 3 líneas, base % + IVA % = %, enlazada a su recepción, que entra al almacén (1 movimiento)',
    f.code, f.tax_base_total, f.tax_total, f.grand_total;
end $$;

-- ── 2 · El mismo papel en otra recepción ───────────────────────────────────
do $$
declare v_ses uuid; p goods_receipt_path;
begin
  v_ses := pg_temp.sesion('albaran_factura', 'AF 001', 'TABERNA DE PRUEBA NORTE, S.L.',
     '[{"raw_text": "Pan", "line_amount": 60.00, "vat_pct": 10}]'::jsonb, 60, 6, 66);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000102', 'c0d00000-0000-4000-8000-000000000001', v_ses, date '2026-10-06', false);
  p := pg_temp.camino('c0d00000-0000-4000-8000-000000000102');
  if p.question is distinct from 'factura_repetida' or p.supplier_invoice_id <> (select id from _ids where que = 'factura_af')
     or (select count(*) from supplier_invoice where supplier_id = 'c0d00000-0000-4000-8000-000000000001') <> 1
     or not exists (select 1 from supplier_invoice_receipt where goods_receipt_id = 'c0d00000-0000-4000-8000-000000000102' and supplier_invoice_id = p.supplier_invoice_id) then
    raise exception 'PRUEBA factura · 2: el mismo número otra vez no se ha enlazado a la que había (% / %).', p.question, p.supplier_invoice_id;
  end if;
  raise notice '2 · el mismo papel («AF 001» contra «AF-001»): ninguna factura nueva; «%»', p.question_detail->>'motivo';
end $$;

-- ── 3 · Una factura sin importes por línea ─────────────────────────────────
do $$
declare v_ses uuid; p goods_receipt_path;
begin
  v_ses := pg_temp.sesion('factura', 'F-77', 'Taberna de Prueba Norte SL',
     '[{"raw_text": "Servicio", "line_amount": null, "vat_pct": 21}]'::jsonb, 50, 10.5, 60.5);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000103', 'c0d00000-0000-4000-8000-000000000001', v_ses, date '2026-10-06', false);
  p := pg_temp.camino('c0d00000-0000-4000-8000-000000000103');
  if p.path <> 'factura' or p.question is distinct from 'factura_sin_importes' or p.supplier_invoice_id is not null
     or exists (select 1 from supplier_invoice where ai_session_id = v_ses) then
    raise exception 'PRUEBA factura · 3: sin importes se ha creado algo o no se ha dicho (% / %).', p.path, p.question;
  end if;
  raise notice '3 · sin importes por línea: no se crea; «%»', p.question_detail->>'motivo';
end $$;

-- ── 4 · Un albarán y una recepción del que liquida ─────────────────────────
do $$
declare v_a uuid; v_l uuid;
begin
  v_a := pg_temp.sesion('albaran', 'AL-9', 'TABERNA DE PRUEBA NORTE SL', '[{"raw_text": "Pan", "line_amount": 10, "vat_pct": 10}]'::jsonb, 10, 1, 11);
  v_l := pg_temp.sesion('albaran_factura', 'S-1', 'MARCAS PRUEBA SEIS SL', '[{"raw_text": "Salsa", "line_amount": 10, "vat_pct": 10}]'::jsonb, 10, 1, 11);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000104', 'c0d00000-0000-4000-8000-000000000001', v_a, date '2026-10-06', false);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000105', 'c0d00000-0000-4000-8000-000000000002', v_l, date '2026-10-06', false);
  if (pg_temp.camino('c0d00000-0000-4000-8000-000000000104')).path <> 'pendiente_factura'
     or (pg_temp.camino('c0d00000-0000-4000-8000-000000000105')).path <> 'liquidacion'
     or exists (select 1 from supplier_invoice where ai_session_id in (v_a, v_l)) then
    raise exception 'PRUEBA factura · 4: un albarán o una recepción del que liquida ha creado factura.';
  end if;
  raise notice '4 · §7.8: el albarán queda pendiente y la del que liquida va a su liquidación: 0 facturas';
end $$;

-- ── 5 · Contestar crea la factura en ese momento ───────────────────────────
do $$
declare v_ses uuid; p goods_receipt_path;
begin
  v_ses := pg_temp.sesion('factura', 'F-200', 'TABERNA NORTE CENTRO', '[{"raw_text": "Harina", "line_amount": 80, "vat_pct": 4}]'::jsonb, 80, 3.2, 83.2);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000106', 'c0d00000-0000-4000-8000-000000000001', v_ses, date '2026-10-07', false);
  if (pg_temp.camino('c0d00000-0000-4000-8000-000000000106')).path <> 'sin_decidir' or exists (select 1 from supplier_invoice where ai_session_id = v_ses) then
    raise exception 'PRUEBA factura · 5: sin saber a nombre de quién va, se ha creado factura.';
  end if;
  perform public.compras_destinatario_decide('c01a0000-0000-4000-8000-00000000000a', 'TABERNA NORTE CENTRO', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', null, false);
  p := pg_temp.camino('c0d00000-0000-4000-8000-000000000106');
  if p.path <> 'factura' or p.supplier_invoice_id is null or (select count(*) from supplier_invoice where ai_session_id = v_ses) <> 1 then
    raise exception 'PRUEBA factura · 5: contestar «la empresa» no ha creado UNA factura (% / %).', p.path, p.supplier_invoice_id;
  end if;
  raise notice '5 · contestado «a nombre de la empresa»: la factura nace en ese momento (una)';
end $$;

-- ── 6 · Anterior al corte ──────────────────────────────────────────────────
do $$
declare v_ses uuid; p goods_receipt_path;
begin
  v_ses := pg_temp.sesion('factura', 'F-2025', 'TABERNA DE PRUEBA NORTE SL', '[{"raw_text": "Pan", "line_amount": 5, "vat_pct": 10}]'::jsonb, 5, 0.5, 5.5);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000107', 'c0d00000-0000-4000-8000-000000000001', v_ses, date '2025-12-20', false);
  p := pg_temp.camino('c0d00000-0000-4000-8000-000000000107');
  if p.path <> 'factura' or p.supplier_invoice_id is not null or p.reason not like '%anterior al corte (31/12/2025)%' then
    raise exception 'PRUEBA factura · 6: antes del corte se ha creado factura o no se dice (% / %).', p.supplier_invoice_id, p.reason;
  end if;
  raise notice '6 · anterior al corte: «%»', p.reason;
end $$;

-- ── 7 · La factura sin recepción, por Compras ──────────────────────────────
do $$
declare v_ses uuid; v jsonb; v2 jsonb;
begin
  v_ses := pg_temp.sesion('factura', 'LUZ-10', 'Taberna de Prueba Norte, S.L.', '[{"raw_text": "Energía", "line_amount": 200, "vat_pct": 21}]'::jsonb, 200, 42, 242);
  v := public.compras_factura_desde_papel(v_ses, 'c0d00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-0000000000a2', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  v2 := public.compras_factura_desde_papel(v_ses, 'c0d00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-0000000000a2', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  if public.compras_euros(1234.5) <> '1.234,50 €' or public.compras_euros(-5) <> '-5,00 €' or v->>'motivo' <> 'Factura LUZ-10 creada desde el papel: 200,00 € de base, 42,00 € de IVA.' then
    raise exception 'PRUEBA factura · 7: los euros no se leen bien: «%» / «%» / «%».', public.compras_euros(1234.5), public.compras_euros(-5), v->>'motivo';
  end if;
  if not (v->>'creada')::boolean or not (v2->>'repetida')::boolean or v->>'factura' <> v2->>'factura'
     or exists (select 1 from supplier_invoice_receipt where supplier_invoice_id = (v->>'factura')::uuid) then
    raise exception 'PRUEBA factura · 7: la factura sin recepción no es UNA y sin recepciones (% / %).', v, v2;
  end if;
  insert into _ids values ('factura_luz', (v->>'factura')::uuid);
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.compras_factura_desde_papel(v_ses, 'c0d00000-0000-4000-8000-000000000001', null, null);
    raise exception 'PRUEBA factura · 7: sin usuario se ha podido registrar una factura.';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  raise notice '7 · sin recepción: «%»; subida otra vez: repetida; sin usuario: 42501 (bien)', v->>'motivo';
end $$;

-- ── 8 · Aprobar, en la base ────────────────────────────────────────────────
insert into invoice_approval_rule (account_id, supplier_id, required_role, priority, created_by_name)
values ('c01a0000-0000-4000-8000-00000000000a', 'c0d00000-0000-4000-8000-000000000001', 'admin', 1, 'prueba');
-- El id, en una variable de la transacción: con el rol authenticated no se
-- lee la tabla temporal de la prueba.
select set_config('prueba.factura_af', (select id::text from _ids where que = 'factura_af'), true);
-- El encargado, por la API (rol authenticated, con la RLS de la tabla).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a6', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    update supplier_invoice set status = 'aprobada' where id = current_setting('prueba.factura_af')::uuid;
    raise exception 'PRUEBA factura · 8: el encargado ha aprobado una factura que pide administrador.';
  exception when sqlstate '42501' then
    raise notice '8 · el encargado, por la API: «%» (bien)', sqlerrm;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare f supplier_invoice;
begin
  update supplier_invoice set status = 'aprobada' where id = current_setting('prueba.factura_af')::uuid;
  select * into f from supplier_invoice where id = current_setting('prueba.factura_af')::uuid;
  if f.status <> 'aprobada' or f.approved_by <> 'c01a0000-0000-4000-8000-0000000000a1' or f.approved_at is null then
    raise exception 'PRUEBA factura · 8: el administrador no ha aprobado, o no queda quién (% / %).', f.status, f.approved_by;
  end if;
  raise notice '8 · el administrador aprueba, y queda quién (%) y cuándo', f.approved_by;
end $$;
reset role;

-- ── 9 · Si crear la factura falla, la recepción se confirma igual ──────────
create or replace function public._compras_factura_desde_papel(
  p_cuenta uuid, p_sesion uuid, p_proveedor uuid, p_local uuid, p_empresa uuid, p_recepcion uuid default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception 'roto a propósito por la prueba';
end $$;
do $$
declare v_ses uuid; p goods_receipt_path; v_n int;
begin
  v_ses := pg_temp.sesion('albaran_factura', 'AF-ROTO', 'TABERNA DE PRUEBA NORTE SL', '[{"raw_text": "Pan", "line_amount": 10, "vat_pct": 10}]'::jsonb, 10, 1, 11);
  perform pg_temp.recepcion('c0d00000-0000-4000-8000-000000000109', 'c0d00000-0000-4000-8000-000000000001', v_ses, date '2026-10-08', true);
  p := pg_temp.camino('c0d00000-0000-4000-8000-000000000109');
  select count(*) into v_n from stock_movement m join goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = 'c0d00000-0000-4000-8000-000000000109';
  if (select status from goods_receipt where id = 'c0d00000-0000-4000-8000-000000000109') <> 'confirmado' or v_n <> 1 then
    raise exception 'PRUEBA factura · 9: con la factura rota, la recepción no se ha confirmado entera.';
  end if;
  if p.path <> 'factura' or p.question is distinct from 'error' or p.error not like '%roto a propósito%' or p.consumed_at is not null then
    raise exception 'PRUEBA factura · 9: el fallo no ha quedado dicho en el camino (% / % / %).', p.path, p.question, p.error;
  end if;
  raise notice '9 · crear la factura roto: la recepción se confirma (1 movimiento) y el camino dice «%»: %', p.question_detail->>'motivo', p.error;
end $$;

rollback;
