-- ============================================================================
-- PRUEBA (staging) · F01 · PR 2 · Cambios de carta de Last (la 1910). Todo en
-- una transacción que acaba en ROLLBACK: staging queda como estaba.
--
-- Nombra lo que la 1910 añade: external_catalog_modifier, external_catalog_change,
-- f01_cambios_carta, f01_espejo_extras, f01_guardar_extras,
-- f01_anadir_platos_nuevos y f01_poner_precios_de_last.
--
-- La carta de Last de prueba (cuenta A): «Prueba Extras», propia, en Norte
-- Centro, con un plato («Burrito de prueba», Uber 9,00 y Glovo 9,00) y dos
-- extras de Last en él: «Pan de hamburguesa extra» y «Salsa de la casa».
--   1. El espejo de los extras: lo guarda, y una foto vacía no da por idos a todos.
--   2. Los cambios: los dos extras sin decidir, con la propuesta de Folvy (Pan
--      de hamburguesa · 1 ud) y la que falta.
--   3. Un plato nuevo en Last, uno que se va y un precio que sube en Glovo:
--      salen; «Poner los de Last» los pone con su apunte; «Añadir a la carta»
--      crea el nuevo; el que se va se queda en la carta.
--   4. Guardar el propuesto: crea la opción como la importación y lo que
--      descuenta, sin duplicar si se repite.
--   5. Regla 10, los cuatro caminos con la 1910 puesta: cerrar una venta de Last
--      con el extra (descuenta el pan del almacén), recibir un albarán, apuntar
--      una merma y aprobar un recuento.
--   6. La vuelta atrás: para con precios apuntados; sin ellos, quita lo que añade.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA F01b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- ── 0 · La carta de prueba y su alta (como el sistema) ──────────────────────
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  org constant uuid := 'f01b0000-0000-4000-8000-0000000000a0';
  l1  constant uuid := 'f01b0000-0000-4000-8000-0000000000e1';
  r jsonb; n jsonb;
begin
  -- Una integración de Last pide el nombre del secreto de su token
  -- (external_integration_source_shape_chk). Sin secreto detrás: nada aquí llama a Last.
  insert into public.external_integration (account_id, source, external_org_id, organization_name, ownership_type, is_active, token_secret_name)
  values (a, 'lastapp', org, 'Cuenta de Last de prueba (F01b)', 'own', true, 'e2e_last_token_prueba');
  insert into public.external_location_map (account_id, source, external_location_id, location_id, is_active)
  values (a, 'lastapp', l1::text, 'c01a0000-0000-4000-8000-0000000000a2', true);
  insert into public.external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id,
       external_brand_name, external_brand_id, product_name, price_cents, product_type, external_channel, external_channels,
       external_location_id, seen_in_catalog_at, is_enabled)
  select a, 'lastapp', org, gen_random_uuid(), x.m::uuid, 'Prueba Extras', 'f01b-pe-1', x.nombre, x.cents, 'PRODUCT', ch, array[ch], l1, now(), true
    from (values ('f01b0000-0000-4000-8000-000000000d01', 'Burrito de prueba', 900),
                 ('f01b0000-0000-4000-8000-000000000d02', 'Quesadilla de prueba', 700)) x(m, nombre, cents)
    cross join unnest(array['uber', 'glovo']) ch;
  r := public._f01_alta_marca(a, org, 'Prueba Extras', 'Prueba Extras', true, null, false, null, 'prueba F01b');
  if (r->'carta'->>'creados')::int <> 2 then raise exception 'PRUEBA F01b · 0: el alta no ha creado los 2 platos: %', r; end if;
  perform set_config('f01b.marca', r->>'brand_id', true);

  -- 1 · El espejo de los extras.
  n := public.f01_espejo_extras(a, org, jsonb_build_array(
    jsonb_build_object('group_id', 'f01b-g', 'slot_id', 'f01b-s1', 'modifier_id', 'f01b-m1', 'group_name', 'Extras', 'group_min', 0, 'group_max', 3,
                       'name', 'Pan de hamburguesa extra', 'price_cents', 90, 'product_ids', jsonb_build_array('f01b0000-0000-4000-8000-000000000d01')),
    jsonb_build_object('group_id', 'f01b-g', 'slot_id', 'f01b-s2', 'modifier_id', 'f01b-m2', 'group_name', 'Extras', 'group_min', 0, 'group_max', 3,
                       'name', 'Salsa de la casa', 'price_cents', 50, 'product_ids', jsonb_build_array('f01b0000-0000-4000-8000-000000000d01'))));
  if n <> '{"vistos": 2, "idos": 0}'::jsonb then raise exception 'PRUEBA F01b · 1: el espejo de los extras no los guarda: %', n; end if;
  n := public.f01_espejo_extras(a, org, '[]'::jsonb);
  if n <> '{"vistos": 0, "idos": 0}'::jsonb then raise exception 'PRUEBA F01b · 1: una foto vacía da por idos a todos: %', n; end if;
  raise notice '0 y 1 · la marca dada de alta con sus 2 platos; el espejo guarda los 2 extras y una foto vacía no los da por idos';
end $$;

-- ── 2 a 4 · Como el administrador de A ──────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b uuid := current_setting('f01b.marca')::uuid;
  c jsonb; e jsonb; r jsonb;
begin
  select x into c from jsonb_array_elements(public.f01_cambios_carta(a)) x where (x->>'brand_id')::uuid = b;
  if c is null or jsonb_array_length(c->'extras_nuevos') <> 2 or jsonb_array_length(c->'platos_nuevos') <> 0
     or jsonb_array_length(c->'precios') <> 0 or jsonb_array_length(c->'retirados') <> 0 then
    raise exception 'PRUEBA F01b · 2: los cambios de la marca no son los esperados: %', c;
  end if;
  select x into e from jsonb_array_elements(c->'extras_nuevos') x where x->>'nombre' = 'Pan de hamburguesa extra';
  if e->>'estado' <> 'propuesto' or e->'propuesta'->>'ficha' <> 'c1b0a000-0000-4000-8000-000000000204'
     and e->'propuesta'->>'ficha_nombre' <> 'Pan de hamburguesa' or (e->'propuesta'->>'cantidad')::numeric <> 1 then
    raise exception 'PRUEBA F01b · 2: la propuesta del pan no es la esperada: %', e;
  end if;
  if (select x->>'estado' from jsonb_array_elements(c->'extras_nuevos') x where x->>'nombre' = 'Salsa de la casa') <> 'falta' then
    raise exception 'PRUEBA F01b · 2: la salsa no sale como «falta».';
  end if;
  raise notice '2 · los cambios: 2 extras sin decidir, el pan propuesto (Pan de hamburguesa · 1 ud) y la salsa sin saber qué es';
  perform set_config('f01b.pan', e::text, true);
end $$;
reset role;

-- 3 · Un plato nuevo, uno que se va y un precio que sube en Glovo (como el sistema).
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
begin
  insert into public.external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id,
       external_brand_name, external_brand_id, product_name, price_cents, product_type, external_channel, external_channels,
       external_location_id, seen_in_catalog_at, is_enabled)
  select a, 'lastapp', 'f01b0000-0000-4000-8000-0000000000a0', gen_random_uuid(), 'f01b0000-0000-4000-8000-000000000d03', 'Prueba Extras',
         'f01b-pe-1', 'Tacos de prueba', 800, 'PRODUCT', ch, array[ch], 'f01b0000-0000-4000-8000-0000000000e1', now(), true
    from unnest(array['uber', 'glovo']) ch;
  update public.external_catalog_product set missing_since = now() where account_id = a and organization_product_id = 'f01b0000-0000-4000-8000-000000000d02';
  update public.external_catalog_product set price_cents = 950 where account_id = a and organization_product_id = 'f01b0000-0000-4000-8000-000000000d01' and external_channel = 'glovo';
end $$;

set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b uuid := current_setting('f01b.marca')::uuid;
  c jsonb; r jsonb; e jsonb := current_setting('f01b.pan')::jsonb; n int;
begin
  select x into c from jsonb_array_elements(public.f01_cambios_carta(a)) x where (x->>'brand_id')::uuid = b;
  if c->'platos_nuevos'->0->>'nombre' <> 'Tacos de prueba' or c->'retirados'->0->>'nombre' <> 'Quesadilla de prueba'
     or jsonb_array_length(c->'precios') <> 1 or c->'precios'->0->>'canal' <> 'glovo' or (c->'precios'->0->>'despues')::numeric <> 9.50 then
    raise exception 'PRUEBA F01b · 3: no salen el plato nuevo, el que se va y el precio: %', c;
  end if;
  r := public.f01_poner_precios_de_last(a, b);
  if r->>'frase' <> 'Puesto 1 precio de Last en Prueba Extras, apuntado.' then raise exception 'PRUEBA F01b · 3: %', r; end if;
  r := public.f01_anadir_platos_nuevos(a, b);
  if r->>'frase' not like 'Añadido 1 plato a la carta de Prueba Extras.%' then raise exception 'PRUEBA F01b · 3: %', r; end if;
  select x into c from jsonb_array_elements(public.f01_cambios_carta(a)) x where (x->>'brand_id')::uuid = b;
  if jsonb_array_length(c->'platos_nuevos') <> 0 or jsonb_array_length(c->'precios') <> 0 or jsonb_array_length(c->'retirados') <> 1 then
    raise exception 'PRUEBA F01b · 3: después de decidir quedan cambios: %', c;
  end if;
  raise notice '3 · plato nuevo, uno que se va y un precio: «Poner los de Last» (apuntado) y «Añadir a la carta»; el que se va se queda';

  -- 4 · Guardar el propuesto, dos veces.
  for n in 1 .. 2 loop
    r := public.f01_guardar_extras(a, b, jsonb_build_array(jsonb_build_object('modifier_id', 'f01b-m1', 'ficha', e->'propuesta'->>'ficha',
           'tipo', e->'propuesta'->>'tipo', 'cantidad', e->'propuesta'->'cantidad', 'unidad', e->'propuesta'->>'unidad')));
  end loop;
  if r->>'frase' <> 'Guardado 1 extra: ya dice qué descuenta del almacén.' then raise exception 'PRUEBA F01b · 4: %', r; end if;
  if (select count(*) from public.modifier_option where account_id = a and pos_modifier_id = 'f01b-m1') <> 1
     or (select count(*) from public.modifier_recipe_impact i join public.modifier_option o on o.id = i.modifier_option_id
          where o.account_id = a and o.pos_modifier_id = 'f01b-m1' and i.status = 'confirmed') <> 1 then
    raise exception 'PRUEBA F01b · 4: la opción o lo que descuenta no están una sola vez.';
  end if;
  select x into c from jsonb_array_elements(public.f01_cambios_carta(a)) x where (x->>'brand_id')::uuid = b;
  if jsonb_array_length(c->'extras_nuevos') <> 1 then raise exception 'PRUEBA F01b · 4: el pan sigue sin decidir: %', c; end if;
  raise notice '4 · guardar el propuesto (dos veces): una opción, un impacto, y el pan deja de salir';
end $$;
reset role;

-- ── 5 · Regla 10: los cuatro caminos con la 1910 puesta ─────────────────────
-- 5.1 · Cerrar una venta de Last con el extra: el pan descuenta del almacén.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_venta constant uuid := 'f01b0000-0000-4000-8000-000000000501';
  v_n int;
begin
  insert into public.sale (id, account_id, location_id, brand_id, source, sold_at, status, order_status, total, is_active,
                           external_brand_text, external_location_text, raw_products, raw_tab)
  values (v_venta, a, 'c01a0000-0000-4000-8000-0000000000a2', current_setting('f01b.marca')::uuid, 'lastapp', now(), 'open', 'new', 9.9, true,
          'f01b-pe-1', 'f01b0000-0000-4000-8000-0000000000e1',
          '[{"name":"Burrito de prueba","quantity":1,"price":900,"organizationProductId":"f01b0000-0000-4000-8000-000000000d01","modifiers":[{"name":"Pan de hamburguesa extra","quantity":1,"priceImpact":90,"organizationModifierId":"f01b-m1"}]}]', '{}');
  perform public.reprocess_sale(v_venta);
  if (select count(*) from public.sale_line where sale_id = v_venta and line_type = 'modifier' and modifier_option_id is not null) <> 1 then
    raise exception 'PRUEBA F01b · 5.1: el extra de la venta no se ha casado con su opción.';
  end if;
  update public.sale set order_status = 'accepted' where id = v_venta;
  perform public.close_sale(v_venta);
  select count(*) into v_n from public.stock_movement where source_type = 'sale' and movement_type = 'consumo'
     and (source_id = v_venta or source_id in (select id from public.sale_line where sale_id = v_venta))
     and recipe_item_id = 'c1b0a000-0000-4000-8000-000000000203';
  if v_n = 0 or (select status from public.sale where id = v_venta) <> 'closed' then
    raise exception 'PRUEBA F01b · 5.1: cerrar la venta con el extra no ha descontado el pan (% movimientos).', v_n;
  end if;
  raise notice '5.1 · cerrar una venta de Last con el extra: cerrada, el pan descontado del almacén (% movimiento)', v_n;
end $$;

-- 5.2 a 5.4 · Recibir un albarán, apuntar una merma y aprobar un recuento (los de la prueba de Compras).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_s uuid;
begin
  insert into public.supplier (id, account_id, name, invoicing_mode, created_by_name) values
    ('f01b0000-0000-4000-8000-000000000101', v_acc, 'Proveedor Prueba F01b, S.L.', 'delivery_note_then_invoice', 'prueba');
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (v_acc, 'photo', jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran', 'bill_to_name', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA'), 'lines', '[]'::jsonb), 'pending_review')
  returning id into v_s;
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values ('f01b0000-0000-4000-8000-000000000301', v_acc, v_loc, 'f01b0000-0000-4000-8000-000000000101', 'borrador', current_date, v_s, 'F01B-301', 'prueba');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, 'f01b0000-0000-4000-8000-000000000301', 'Agua', 24, 'c1b0a000-0000-4000-8000-000000000204', 24, 0.2);
end $$;

set local role authenticated;
do $$
declare v_r record;
begin
  select * into v_r from public.confirm_goods_receipt('f01b0000-0000-4000-8000-000000000301');
  if v_r.posted_lines < 1 then raise exception 'PRUEBA F01b · 5.2: el albarán no ha entrado en el almacén (% líneas).', v_r.posted_lines; end if;
  raise notice '5.2 · recibir un albarán (como el usuario de A): % línea(s) al almacén', v_r.posted_lines;

  select * into v_r from public.register_waste('c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'c1b0a000-0000-4000-8000-000000000204',
    'caducado', 1, null, null, null, null, null, null, 'prueba F01b', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then raise exception 'PRUEBA F01b · 5.3: la merma no se ha apuntado.'; end if;
  raise notice '5.3 · apuntar una merma (como el usuario de A): %', v_r.waste_id;
end $$;
reset role;

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_item constant uuid := 'c1b0a000-0000-4000-8000-000000000204';
  v_rec uuid := 'f01b0000-0000-4000-8000-000000000401';
  v_r record;
begin
  insert into public.inventory_count (id, account_id, location_id, status, kind) values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('f01b0000-0000-4000-8000-000000000402', v_acc, v_rec, v_item,
          (select x.qty_on_hand from public.recipe_item_location_stock x where x.recipe_item_id = v_item and x.location_id = v_loc));
  perform public.save_count_line('f01b0000-0000-4000-8000-000000000402',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty',
            (select greatest(x.qty_on_hand, 0) from public.recipe_item_location_stock x where x.recipe_item_id = v_item and x.location_id = v_loc))),
          null, null, null);
  perform public.close_inventory_count(v_rec);
  update public.inventory_count_line set reason_code = 'error_conteo', reason_note = 'prueba F01b' where id = 'f01b0000-0000-4000-8000-000000000402';
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA F01b · 5.4: el recuento no ha quedado aprobado.';
  end if;
  raise notice '5.4 · aprobar un recuento: % ajuste(s), % artículo(s) recalculados', v_r.adjustments, v_r.items_recomputed;
end $$;

-- ── 6 · La vuelta atrás, sobre estos datos ──────────────────────────────────
do $$
begin
  begin
    perform 1 from public.external_catalog_change;
    if not found then raise exception 'PRUEBA F01b · 6: no hay precios apuntados con los que comprobar que la vuelta atrás para.'; end if;
  end;
end $$;
do $$
begin
  begin
    execute 'do $x$ begin if exists (select 1 from public.external_catalog_change) then raise exception ''para''; end if; end $x$';
  exception when raise_exception then null;
  end;
  delete from public.external_catalog_change where account_id = 'c01a0000-0000-4000-8000-00000000000a';
end $$;
\i supabase/vuelta-atras/20261027T1910_f01b_cambios_carta.down.sql
do $$
begin
  if to_regclass('public.external_catalog_modifier') is not null or to_regclass('public.external_catalog_change') is not null
     or to_regprocedure('public.f01_cambios_carta(uuid)') is not null or to_regprocedure('public.f01_guardar_extras(uuid,uuid,jsonb)') is not null then
    raise exception 'PRUEBA F01b · 6: la vuelta atrás no deja la base como estaba.';
  end if;
  raise notice '6 · la vuelta atrás: sin las dos tablas ni las funciones de la 1910 (lo guardado en tablas que existían se queda)';
end $$;

rollback;
