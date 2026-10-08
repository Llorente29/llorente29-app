-- ENSAYO · TPV Sala S1 — en transacción REVERTIDA. No deja nada escrito.
--
-- ⚠️ FUERA DE BANDA (00:30–12:15 Madrid): aplica la migración dentro de la
--    transacción, y eso toma ACCESS EXCLUSIVE sobre sale y sale_line hasta el
--    ROLLBACK del final.
--
-- Cómo: pegar ENTERO en el editor SQL (rol postgres). Antes, pegar entre las
-- dos marcas de abajo el contenido íntegro de
--   supabase/migrations/20261009T0040_tpv_sala_s1b_envios_y_cuentas_de_mesa.sql
-- (la parte A, 20261008T1315_tpv_sala_s1a_zonas_y_mesas.sql, ya aplicada)
-- Cada paso EJECUTA las funciones (son plpgsql: compilar no valida). Si algo no
-- es lo esperado, aborta con el número de paso. El último SELECT pega la tabla
-- de resultados; ésa es la evidencia para el parte (regla 5).
--
-- Caminos que recorre (regla 10: no solo SELECT):
--   E1  abrir mesa E4 con 4 comensales (Folvy Interno, Alcalá laboratorio). Zonas
--       y mesas propias del ensayo («ENSAYO Sala», E1…E10): no chocan con la sala
--       que se haya montado de verdad tras la parte A.
--   E2  enviar 2 bebidas · E3 enviar 2 platos · E4 enviar 1 postre
--       → 3 envíos, 3 trabajos de impresión de cocina con su fire_id, y
--         order_for_print(envío) devuelve SOLO las líneas de ese envío
--   E5  ids de sale_line idénticos de principio a fin
--   E6  quitar línea sin enviar (se borra) y anular una enviada (sigue, a 0,
--       con motivo, y «ANULADO» encolado como documento compuesto)
--   E7  sacar la cuenta → pide_cuenta + trabajo de ticket
--   E8  cobrar → cobrada · E9 mesa lista → libre y order_status completed
--   E10 consumo: movimientos de stock de la venta, con sale_line_id NO nulo
--   E11 venta rápida de Mostrador (upsert_pos_sale 'command'): imprime el pedido
--       entero como siempre (by_order, sin fire_id) y sus líneas sin fire_id
--   E12 upsert_pos_sale sobre una cuenta de mesa → rechazada
--   E13 pos_open_sales no lista la mesa

begin;

-- ════════ PEGAR AQUÍ LA MIGRACIÓN ════════

-- ════════ FIN DE LA MIGRACIÓN ════════

create temp table ensayo (paso text, ok boolean, detalle text) on commit drop;

do $$
declare
  c_acc  constant uuid := '00000000-0000-0000-0000-000000000001';   -- Folvy Interno
  c_loc  constant uuid := '8a78366c-18cb-4ae2-9cf1-38e5d9a927c0';   -- Foodint Alcalá (laboratorio)
  c_user constant uuid := 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a';   -- Julio (admin de la cuenta)
  v_brand uuid; v_items uuid[]; v_zone uuid; v_terr uuid; v_t4 uuid; v_sale uuid; v_r jsonb;
  v_ids_e2 uuid[]; v_ids_fin uuid[]; v_fires uuid[]; v_n int; v_printer uuid; v_order jsonb;
  v_reason uuid; v_line uuid; v_qs uuid; i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', c_user::text, true);

  -- Una impresora de cocina+ticket de mentira en el local (se va con el rollback)
  insert into printer (account_id, location_id, name, transport, doc_types, config, is_active)
  values (c_acc, c_loc, 'ENSAYO cocina', 'escpos_network', array['kitchen','bag'], '{"ip":"10.0.0.250"}', true)
  returning id into v_printer;
  insert into kds_device (account_id, location_id, label, token) values (c_acc, c_loc, 'ENSAYO sala', 'ensayo-sala-s1');

  -- Marca y tres productos SIMPLES (sin modificadores ni combo) de esa marca
  select bla.brand_id into v_brand from brand_location_availability bla
  where bla.account_id = c_acc and bla.location_id = c_loc and bla.is_active limit 1;
  select array_agg(id) into v_items from (
    select mi.id from menu_item mi
    where mi.account_id = c_acc and mi.brand_id = v_brand and mi.archived_at is null and mi.is_active is not false
      and coalesce(mi.product_type, 'item') <> 'combo'
      and not exists (select 1 from modifier_group_assignment a where a.menu_item_id = mi.id)
      and public.menu_item_vendible_en_alguna_parte(mi.id)
    order by mi.name limit 3) x;
  if coalesce(array_length(v_items, 1), 0) < 3 then raise exception 'E0: no hay 3 productos simples en la marca %', v_brand; end if;

  -- Oficina: Sala (6) y Terraza (4)
  insert into dining_zone (account_id, location_id, name, kind, sort_order) values (c_acc, c_loc, 'ENSAYO Sala', 'sala', 1) returning id into v_zone;
  insert into dining_zone (account_id, location_id, name, kind, sort_order) values (c_acc, c_loc, 'ENSAYO Terraza', 'terraza', 2) returning id into v_terr;
  for i in 1..6 loop insert into dining_table (account_id, location_id, zone_id, name, seats, sort_order) values (c_acc, c_loc, v_zone, 'E' || i, 4, i); end loop;
  for i in 7..10 loop insert into dining_table (account_id, location_id, zone_id, name, seats, sort_order) values (c_acc, c_loc, v_terr, 'E' || i, 2, i); end loop;
  select id into v_t4 from dining_table where location_id = c_loc and name = 'E4' and is_active;

  -- E1
  v_r := public.pos_table_open(v_t4, 4, v_brand, null);
  v_sale := (v_r->>'saleId')::uuid;
  insert into ensayo select 'E1 abrir mesa 4 con 4', (select covers = 4 and service_type = 'dine_in' and table_id = v_t4 from sale where id = v_sale),
    (select public._pos_table_state(s) from sale s where id = v_sale);

  -- E2: 2 bebidas (el primer producto, cantidad 2)
  v_r := public.pos_table_fire(v_sale, jsonb_build_array(jsonb_build_object('menuItemId', v_items[1], 'quantity', 2, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)), null);
  select array_agg(id order by id) into v_ids_e2 from sale_line where sale_id = v_sale;
  -- E3: 2 platos, guardados primero SIN enviar y enviados después
  perform public.pos_table_add_lines(v_sale, jsonb_build_array(jsonb_build_object('menuItemId', v_items[2], 'quantity', 2, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)));
  insert into ensayo select 'E3a guardado sin enviar → Pedido en cocina sigue', true,
    (select public._pos_table_state(s) || ' · pendientes ' || (select count(*) from sale_line where sale_id = v_sale and fire_id is null) from sale s where id = v_sale);
  v_r := public.pos_table_fire(v_sale, '[]'::jsonb, null);
  -- E4: 1 postre
  v_r := public.pos_table_fire(v_sale, jsonb_build_array(jsonb_build_object('menuItemId', v_items[3], 'quantity', 1, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)), null);

  select array_agg(id order by fire_number) into v_fires from sale_fire where sale_id = v_sale;
  select count(*) into v_n from print_job where sale_id = v_sale and doc_type = 'kitchen' and payload ? 'fire_id';
  insert into ensayo values ('E2-4 tres envíos, tres tickets de cocina', array_length(v_fires,1) = 3 and v_n = 3,
    'envíos ' || array_length(v_fires,1) || ' · trabajos de cocina ' || v_n);

  -- order_for_print(envío) EJECUTADA: devuelve solo las líneas de ese envío,
  -- con mesa, zona, comensales y número de envío; sin envío, la cuenta entera.
  for i in 1..3 loop
    v_order := public.order_for_print('ensayo-sala-s1', v_sale, v_fires[i]);
    insert into ensayo values ('E2-4 order_for_print envío ' || i,
      jsonb_array_length(v_order->'lineas') = 1 and (v_order->>'fire_number')::int = i
        and v_order->>'table_name' = 'E4' and v_order->>'zone_name' = 'ENSAYO Sala' and (v_order->>'covers')::int = 4,
      (v_order->'lineas'->0->>'qty') || 'x ' || (v_order->'lineas'->0->>'name'));
  end loop;
  v_order := public.order_for_print('ensayo-sala-s1', v_sale);
  insert into ensayo values ('E2-4 order_for_print sin envío = cuenta entera', jsonb_array_length(v_order->'lineas') = 3,
    jsonb_array_length(v_order->'lineas') || ' líneas');

  -- E5 (parcial): los ids del envío 1 siguen ahí después de dos envíos más
  select array_agg(id order by id) into v_ids_fin from sale_line where sale_id = v_sale and id = any (v_ids_e2);
  insert into ensayo values ('E5 ids del 1er envío intactos', v_ids_fin = v_ids_e2, array_length(v_ids_fin,1) || ' de ' || array_length(v_ids_e2,1));

  -- E6a quitar una línea sin enviar
  perform public.pos_table_add_lines(v_sale, jsonb_build_array(jsonb_build_object('menuItemId', v_items[1], 'quantity', 1, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb)));
  select id into v_line from sale_line where sale_id = v_sale and fire_id is null and parent_sale_line_id is null;
  perform public.pos_table_remove_pending_line(v_line);
  insert into ensayo select 'E6a quitar sin enviar (se borra)', not exists (select 1 from sale_line where id = v_line), '';

  -- E6b anular una enviada (el postre)
  v_r := public.pos_void_reasons(c_acc);
  v_reason := (v_r->0->>'id')::uuid;
  select id into v_line from sale_line where fire_id = v_fires[3] and parent_sale_line_id is null;
  v_r := public.pos_table_void_line(v_line, v_reason, null, null);
  insert into ensayo select 'E6b anular enviada: sigue, a 0, con motivo, ANULADO encolado',
    (select voided_at is not null and line_total = 0 from sale_line where id = v_line)
      and exists (select 1 from sale_line_void where sale_line_id = v_line)
      and (v_r->>'printJobs')::int = 1
      and exists (select 1 from print_job where sale_id = v_sale and payload->>'title' = 'Anulado'),
    'motivo «' || (v_r->>'printJobs') || ' trabajo» · ' || (select reason_label from sale_line_void where sale_line_id = v_line);

  -- E7 sacar la cuenta
  v_r := public.pos_table_request_bill(v_sale);
  insert into ensayo select 'E7 sacar la cuenta', public._pos_table_state(s) = 'pide_cuenta' and (v_r->>'printJobs')::int = 1,
    public._pos_table_state(s) || ' · total ' || s.total from sale s where id = v_sale;
  -- E8 cobrar
  perform public.pos_table_charge(v_sale, 'card');
  insert into ensayo select 'E8 cobrar', public._pos_table_state(s) = 'cobrada' and s.payment_status = 'paid',
    public._pos_table_state(s) from sale s where id = v_sale;
  -- E9 mesa lista
  perform public.pos_table_clear(v_sale);
  insert into ensayo select 'E9 mesa lista → libre',
    not exists (select 1 from sale where table_id = v_t4 and table_cleared_at is null and status <> 'cancelled')
      and (select order_status = 'completed' from sale where id = v_sale),
    (select order_status || ' / ' || status from sale where id = v_sale);

  -- E5 (final) + E10
  select array_agg(id order by id) into v_ids_fin from sale_line where sale_id = v_sale and id = any (v_ids_e2);
  insert into ensayo values ('E5 ids del 1er envío intactos al final', v_ids_fin = v_ids_e2, '');
  insert into ensayo select 'E10 consumo con sale_line_id', count(*) > 0 and count(*) filter (where sale_line_id is null) = 0,
    count(*) || ' movimientos · ' || count(*) filter (where sale_line_id is null) || ' sin línea'
  from stock_movement where source_type = 'sale' and source_id = v_sale and movement_type = 'consumo';

  -- E11 venta rápida de Mostrador: lo de siempre
  v_r := public.upsert_pos_sale(null, c_acc, c_loc, v_brand, 'counter',
           jsonb_build_array(jsonb_build_object('menuItemId', v_items[1], 'quantity', 1, 'modifiers', '[]'::jsonb, 'combo', '[]'::jsonb, 'kitchenNote', null)),
           'command', null, null);
  v_qs := (v_r->>'saleId')::uuid;
  insert into ensayo select 'E11 Mostrador imprime el pedido entero como siempre',
    exists (select 1 from print_job where sale_id = v_qs and doc_type = 'kitchen' and payload->>'mode' = 'by_order' and not payload ? 'fire_id')
      and not exists (select 1 from sale_line where sale_id = v_qs and fire_id is not null)
      and (select service_type = 'pickup' and table_id is null from sale where id = v_qs),
    (select count(*) || ' trabajos' from print_job where sale_id = v_qs);

  -- E12 upsert_pos_sale sobre una mesa
  v_r := public.pos_table_open((select id from dining_table where location_id = c_loc and name = 'E7' and is_active), 2, v_brand, null);
  begin
    perform public.upsert_pos_sale((v_r->>'saleId')::uuid, c_acc, c_loc, v_brand, 'counter',
      jsonb_build_array(jsonb_build_object('menuItemId', v_items[1], 'quantity', 1)), 'save', null, null);
    insert into ensayo values ('E12 upsert_pos_sale rechaza la mesa', false, 'NO la rechazó');
  exception when others then
    insert into ensayo values ('E12 upsert_pos_sale rechaza la mesa', sqlerrm like '%cuenta de una mesa%', sqlerrm);
  end;
  -- E13
  insert into ensayo select 'E13 pos_open_sales no lista mesas',
    not exists (select 1 from jsonb_array_elements(public.pos_open_sales(c_acc, c_loc)) e where (e->>'id')::uuid = (v_r->>'saleId')::uuid), '';
  -- pos_floor ejecuta y ve la 7 abierta
  insert into ensayo select 'pos_floor', jsonb_array_length(f->'zones') >= 2, (select z->'tables'->0->'sale'->>'state' from jsonb_array_elements(f->'zones') z where z->>'name' = 'ENSAYO Terraza')
    from (select public.pos_floor(c_acc, c_loc) f) x;
end $$;

select * from ensayo;

rollback;
