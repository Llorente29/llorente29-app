-- ============================================================================
-- PRUEBA (staging) · Compras · regla 10 con la 0350, la 0360 y la 0370 puestas:
-- los cuatro caminos que escriben coste o stock (cerrar una venta, recibir un
-- albarán, apuntar una merma y aprobar un recuento). Todo en una transacción
-- con ROLLBACK.
--
-- Por qué: la 0350 cambia _compras_camino_guarda, que corre en el disparador
-- de la recepción al confirmarla; la 0370 cambia el disparador de la factura
-- desde el documento (tg_goods_receipt_path_factura), el cálculo del camino y
-- la frase que ve la cocina en la tablet al confirmar (compras_camino_de).
-- Recibir un albarán es uno de los cuatro caminos de la regla 10 (Julio,
-- 21/10: «ensáyalos en staging»). Un cambio así no se da por bueno midiendo
-- su fórmula: se cierra una venta, se recibe un albarán, se apunta una merma
-- y se aprueba un recuento, y cada uno tiene que escribir lo suyo.
--
-- Se ejecuta DESPUÉS de la 0370 en supabase/staging/aplicar.txt.
--
--   1. Cerrar una venta (close_sale, como el servidor: no la llama la pantalla).
--   2. Recibir un albarán, COMO EL USUARIO DE A (confirm_goods_receipt y la
--      frase de la tablet, compras_camino_de): entra al almacén, decide su
--      camino y la frase dice lo que es, sin «papel».
--   3. Recibir un albarán-factura de quien factura con cada entrega: su
--      camino es factura y la frase lo dice.
--   4. Apuntar una merma, como el usuario de A (register_waste).
--   5. Aprobar un recuento (close_inventory_count y apply_inventory_count).
-- La población: la de staging de las pruebas de Compras (cuenta A, local
-- Norte Centro, el barril crudo 7e…a01), como en 20261017_compras_camino_prueba.sql.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- ── 1 · Cerrar una venta ───────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_venta uuid := 'c0c37000-0000-4000-8000-000000000201';
  v_n int;
begin
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, is_active)
  values (v_venta, v_acc, v_loc, '7e000000-0000-4000-8000-000000000b01', 'e0200000-0000-4000-8000-00000000a0c1', now(), 'open', 'new', 2.5, 'hubrise', true);
  insert into public.sale_line (account_id, sale_id, raw_text, product_name, menu_item_id, quantity, line_type)
  values (v_acc, v_venta, 'prueba', 'Caña', '7e000000-0000-4000-8000-000000000e01', 2, 'product');
  update public.sale set order_status = 'accepted' where id = v_venta;
  perform public.close_sale(v_venta);
  select count(*) into v_n from public.stock_movement where source_type = 'sale' and source_id = v_venta and movement_type = 'consumo';
  if v_n = 0 or (select status from public.sale where id = v_venta) <> 'closed' then
    raise exception 'PRUEBA cuatro caminos · 1: cerrar una venta no ha escrito su consumo (% movimientos).', v_n;
  end if;
  raise notice '1 · cerrar una venta: cerrada, % movimiento(s) de consumo', v_n;
end $$;

-- ── 2 y 3 · Recibir: la siembra (como el sistema) ──────────────────────────
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_s uuid;
begin
  insert into public.supplier (id, account_id, name, invoicing_mode, created_by_name) values
    ('c0c37000-0000-4000-8000-000000000001', v_acc, 'Lácteos Prueba Siete, S.L.', 'delivery_note_then_invoice', 'prueba'),
    ('c0c37000-0000-4000-8000-000000000002', v_acc, 'Obrador Prueba Siete, S.A.', 'per_delivery', 'prueba');
  -- Un albarán y un albarán-factura, a nombre de la empresa de A (como los de Foodint).
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (v_acc, 'photo', jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran', 'bill_to_name', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA'), 'lines', '[]'::jsonb), 'pending_review')
  returning id into v_s;
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values ('c0c37000-0000-4000-8000-000000000301', v_acc, v_loc, 'c0c37000-0000-4000-8000-000000000001', 'borrador', current_date, v_s, 'P7-301', 'prueba');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, 'c0c37000-0000-4000-8000-000000000301', 'Barril', 30, '7e000000-0000-4000-8000-000000000a01', 30, 0.6);
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (v_acc, 'photo', jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran_factura', 'bill_to_name', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA'), 'lines', '[]'::jsonb), 'pending_review')
  returning id into v_s;
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values ('c0c37000-0000-4000-8000-000000000302', v_acc, v_loc, 'c0c37000-0000-4000-8000-000000000002', 'borrador', current_date, v_s, 'P7-302', 'prueba');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, 'c0c37000-0000-4000-8000-000000000302', 'Barril', 10, '7e000000-0000-4000-8000-000000000a01', 10, 0.6);
  raise notice '2 · sembrados un albarán (de quien manda la factura después) y un albarán-factura (de quien factura con cada entrega), en borrador';
end $$;

-- ── 2 y 3 · Recibir, como el usuario de A (lo que hace la tablet) ──────────
set local role authenticated;
do $$
declare v_r record; v_f jsonb;
begin
  select * into v_r from public.confirm_goods_receipt('c0c37000-0000-4000-8000-000000000301');
  if v_r.posted_lines < 1 then raise exception 'PRUEBA cuatro caminos · 2: el albarán no ha entrado en el almacén (% líneas).', v_r.posted_lines; end if;
  v_f := public.compras_camino_de('c0c37000-0000-4000-8000-000000000301');
  if v_f->>'camino' <> 'pendiente_factura' or v_f->>'frase' <> 'Es un albarán. La oficina esperará la factura.' then
    raise exception 'PRUEBA cuatro caminos · 2: la tablet no dice lo que es el albarán (% · «%»).', v_f->>'camino', v_f->>'frase';
  end if;
  raise notice '2 · recibir un albarán (como el usuario de A): % línea(s) al almacén; la tablet dice «%»', v_r.posted_lines, v_f->>'frase';

  select * into v_r from public.confirm_goods_receipt('c0c37000-0000-4000-8000-000000000302');
  v_f := public.compras_camino_de('c0c37000-0000-4000-8000-000000000302');
  if v_r.posted_lines < 1 or v_f->>'camino' <> 'factura' or v_f->>'frase' not like 'Es un albarán-factura.%' or v_f->>'frase' ~* '\mpapel' then
    raise exception 'PRUEBA cuatro caminos · 3: el albarán-factura no ha ido a factura con su frase (% líneas · % · «%»).', v_r.posted_lines, v_f->>'camino', v_f->>'frase';
  end if;
  raise notice '3 · recibir un albarán-factura (como el usuario de A): % línea(s); la tablet dice «%»', v_r.posted_lines, v_f->>'frase';

  -- ── 4 · Apuntar una merma ──
  select * into v_r from public.register_waste('c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', '7e000000-0000-4000-8000-000000000a01',
    'caducado', 2, null, null, null, null, null, null, 'prueba', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then raise exception 'PRUEBA cuatro caminos · 4: la merma no se ha apuntado.'; end if;
  raise notice '4 · apuntar una merma (como el usuario de A): %, % €', v_r.waste_id, coalesce(round(v_r.cost_eur, 2)::text, '—');
end $$;
reset role;

-- Lo que escribió la recepción, mirado como el sistema.
do $$
declare v_n int; p goods_receipt_path;
begin
  select count(*) into v_n from public.stock_movement m join public.goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id in ('c0c37000-0000-4000-8000-000000000301', 'c0c37000-0000-4000-8000-000000000302');
  if v_n < 2 then raise exception 'PRUEBA cuatro caminos · 2: las dos recepciones no han escrito sus movimientos de almacén (%).', v_n; end if;
  select * into p from public.goods_receipt_path where goods_receipt_id = 'c0c37000-0000-4000-8000-000000000302';
  if p.id is null or p.path <> 'factura' or coalesce(p.reason, '') ~* '\mpapel' or coalesce(p.question_detail::text, '') ~* 'desde el papel' then
    raise exception 'PRUEBA cuatro caminos · 3: el camino del albarán-factura no es el esperado (% · «%» · %).', p.path, p.reason, p.question_detail;
  end if;
  raise notice '2 y 3 · % movimiento(s) de almacén; el albarán-factura, camino % (pregunta: %)', v_n, p.path, coalesce(p.question, 'ninguna');
end $$;

-- ── 5 · Aprobar un recuento ────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_crudo constant uuid := '7e000000-0000-4000-8000-000000000a01';
  v_rec uuid := 'c0c37000-0000-4000-8000-000000000401';
  v_r record;
begin
  insert into public.inventory_count (id, account_id, location_id, status, kind) values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('c0c37000-0000-4000-8000-000000000402', v_acc, v_rec, v_crudo,
          (select x.qty_on_hand from public.recipe_item_location_stock x where x.recipe_item_id = v_crudo and x.location_id = v_loc));
  perform public.save_count_line('c0c37000-0000-4000-8000-000000000402',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty',
            (select greatest(x.qty_on_hand, 0) from public.recipe_item_location_stock x where x.recipe_item_id = v_crudo and x.location_id = v_loc))),
          null, null, null);
  perform public.close_inventory_count(v_rec);
  update public.inventory_count_line set reason_code = 'error_conteo', reason_note = 'prueba de compras' where id = 'c0c37000-0000-4000-8000-000000000402';
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA cuatro caminos · 5: el recuento no ha quedado aprobado.';
  end if;
  raise notice '5 · aprobar un recuento: % ajuste(s), % artículo(s) recalculados', v_r.adjustments, v_r.items_recomputed;
end $$;

rollback;
