-- ============================================================================
-- PRUEBA (staging) · F01 · PR 3 · Las recetas que faltan y el código cambiado
-- (la 0850, que añade, y la 0851, que cambia). Todo en una transacción que
-- acaba en ROLLBACK: staging queda como estaba.
--
-- Nombra lo que cambia la 0851: el disparador nuevo de recipe_line y
-- f01_pasada_last. Y lo que añade la 0850: f01_receta_puesta,
-- f01_marca_reconocida, f01_carta_marca, f01_preparar_receta,
-- f01_destino_lectura, f01_colocar_recetas, f01_marcas_por_revisar,
-- f01_decidir_marca y f01_aviso_visto.
--
-- La carta de prueba es la de la semilla (seed_f01c_recetas_y_codigo_staging):
-- «Pollería de Prueba» y, en Last, «Pollería Express» (idéntica) y «Pollos
-- Nuevos» (se parece). Con el motor de consumo DE VERDAD de staging:
--   1. La carta (tablero 3): 5 platos, 3 con receta, Alitas sin receta y
--      Croquetas sin artículo; el agua, del almacén; 1 venta esperando.
--   2. Poner la receta de Alitas: el disparador la pone en la cola, y colocar
--      descuenta el pan de su venta (que antes no descontaba nada).
--   3. Regla 6: con un recuento cerrado después de una venta de Croquetas, esa
--      venta NO se toca al poner su receta, y se dice.
--   4. Código cambiado (tablero 4): la pasada une Express sola (carta
--      idéntica) y avisa; Pollos Nuevos se pregunta; «Sí, es…» le pone la
--      marca a sus 2 ventas y el pollo descuenta su pan.
--   5. Regla 10, los cuatro caminos con la tanda puesta: cerrar una venta (la
--      de Alitas, ya con receta), recibir un albarán, apuntar una merma y
--      aprobar un recuento. Y el disparador no estorba al editar recetas.
--   6. La vuelta atrás: la de la 0851 quita el disparador y restaura la pasada;
--      la de la 0850 para con decisiones de una persona y, sin ellas, quita lo
--      que añade.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA F01c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.e2e_f01c_preparar(text)') is null then
    raise exception 'PRUEBA F01c: falta la semilla seed_f01c_recetas_y_codigo_staging (va antes en el manifiesto).';
  end if;
end $$;
set local statement_timeout = '240s';

-- ── 1 · La carta, como el administrador de A ────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'f01c2e00-0000-4000-8000-0000000000b1';
  r jsonb; c jsonb;
begin
  r := public.e2e_f01c_preparar('empezar');
  if (r->>'ventas')::int <> 4 or r->>'sesion' is null then raise exception 'PRUEBA F01c · 1: la preparación no ha dejado las 4 ventas y la lectura: %', r; end if;
  c := public.f01_carta_marca(a, b);
  if c->'resumen' <> '{"platos": 5, "con_receta": 3, "sin_receta": 2, "almacen": 1}'::jsonb then
    raise exception 'PRUEBA F01c · 1: la carta de la Pollería no es la esperada: %', c->'resumen';
  end if;
  if (c->>'ventas_esperando')::int <> 1 then raise exception 'PRUEBA F01c · 1: tendría que haber 1 venta esperando receta: %', c->>'ventas_esperando'; end if;
  if (select string_agg(p->>'nombre', ', ' order by p->>'nombre') from jsonb_array_elements(c->'platos') p where p->>'estado' = 'sin_receta')
     <> 'Alitas de Prueba, Croquetas de Prueba' then
    raise exception 'PRUEBA F01c · 1: los que faltan no son Alitas y Croquetas: %', c->'platos';
  end if;
  raise notice '1 · la carta: 5 platos, 3 con receta, faltan Alitas y Croquetas, 1 del almacén, 1 venta esperando';
end $$;
reset role;

-- ── 2 · Poner la receta de Alitas: lo vendido descuenta ─────────────────────
-- Primero se cierra su venta: sin receta, no descuenta nada.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v uuid;
begin
  select s.id into v from public.sale s where s.account_id = a and s.external_ref = 'f01c-e2e-1' and s.is_active;
  perform public.close_sale(v);
  if (select count(*) from public.stock_movement where account_id = a and source_type = 'sale' and movement_type = 'consumo' and source_id = v) <> 0 then
    raise exception 'PRUEBA F01c · 2: la venta de Alitas descuenta algo sin tener receta.';
  end if;
  perform set_config('f01c.venta_alitas', v::text, true);
end $$;
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  mi uuid; r jsonb;
begin
  select id into mi from public.menu_item where account_id = a and name = 'Alitas de Prueba' and archived_at is null and brand_id = 'f01c2e00-0000-4000-8000-0000000000b1';
  r := public.f01_preparar_receta(a, mi);
  perform set_config('f01c.alitas', r->>'recipe_item_id', true);
end $$;
reset role;
-- Como la escribe el editor de Cocina: una línea en recipe_line (el disparador de la 0851).
insert into public.recipe_line (account_id, parent_item_id, child_item_id, quantity_net, unit_id, position)
values ('c01a0000-0000-4000-8000-00000000000a', current_setting('f01c.alitas')::uuid, 'c1b0a000-0000-4000-8000-000000000203', 1,
        'c1b0a000-0000-4000-8000-000000000104', 1);
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  r jsonb; n int;
begin
  if (select count(*) from public.f01_receta_puesta where account_id = a and recipe_item_id = current_setting('f01c.alitas')::uuid and colocada_at is null) <> 1 then
    raise exception 'PRUEBA F01c · 2: la primera línea de Alitas no ha puesto el plato en la cola.';
  end if;
  r := public.f01_colocar_recetas(a);
  if (r->>'colocadas')::int <> 1 or (r->>'fallidas')::int <> 0 or (r->>'quedan')::int <> 0 then
    raise exception 'PRUEBA F01c · 2: colocar no ha colocado la venta de Alitas: %', r;
  end if;
end $$;
reset role;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  n int;
begin
  select count(*) into n from public.stock_movement where account_id = a and source_type = 'sale' and movement_type = 'consumo'
     and source_id = current_setting('f01c.venta_alitas')::uuid and recipe_item_id = 'c1b0a000-0000-4000-8000-000000000203';
  if n = 0 then raise exception 'PRUEBA F01c · 2: puesta la receta, la venta de Alitas sigue sin descontar el pan.'; end if;
  raise notice '2 · la receta de Alitas: a la cola con su primera línea; colocada su venta, que ahora descuenta el pan (% movimiento)', n;
end $$;

-- ── 3 · Regla 6: lo de antes del último recuento no se toca ─────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v uuid;
begin
  -- Una venta de Croquetas de hace 2 horas, y un recuento cerrado hace 1.
  insert into public.sale (account_id, location_id, brand_id, source, sold_at, status, order_status, total, is_active, external_ref,
                           external_brand_text, external_location_text, raw_products, raw_tab)
  values (a, 'c01a0000-0000-4000-8000-0000000000a2', 'f01c2e00-0000-4000-8000-0000000000b1', 'lastapp', now() - interval '2 hours', 'open', 'accepted', 6.5, true,
          'f01c-prueba-croquetas', 'f01c-pp-1', 'f01c2e00-0000-4000-8000-0000000000e1',
          '[{"name":"Croquetas de Prueba","quantity":1,"price":650,"organizationProductId":"f01c2e00-0000-4000-8000-0000000001d6"}]', '{}')
  returning id into v;
  perform public.reprocess_sale(v);
  perform set_config('f01c.venta_croquetas', v::text, true);
  insert into public.inventory_count (id, account_id, location_id, status, kind, closed_at)
  values ('f01c0000-0000-4000-8000-000000000601', a, 'c01a0000-0000-4000-8000-0000000000a2', 'aprobado', 'full', now() - interval '1 hour');
end $$;
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  mi uuid; r jsonb; c jsonb;
begin
  select id into mi from public.menu_item where account_id = a and name = 'Croquetas de Prueba' and archived_at is null and brand_id = 'f01c2e00-0000-4000-8000-0000000000b1';
  c := public.f01_carta_marca(a, 'f01c2e00-0000-4000-8000-0000000000b1');
  if (select (p->>'ventas_antes_del_recuento')::int from jsonb_array_elements(c->'platos') p where p->>'nombre' = 'Croquetas de Prueba') <> 1 then
    raise exception 'PRUEBA F01c · 3: la carta no dice que la venta de Croquetas se queda debajo del recuento: %', c->'platos';
  end if;
  r := public.f01_preparar_receta(a, mi);
  if not (r->>'creado')::boolean then raise exception 'PRUEBA F01c · 3: Croquetas no tenía artículo y no se le ha creado: %', r; end if;
  perform set_config('f01c.croquetas', r->>'recipe_item_id', true);
end $$;
reset role;
insert into public.recipe_line (account_id, parent_item_id, child_item_id, quantity_net, unit_id, position)
values ('c01a0000-0000-4000-8000-00000000000a', current_setting('f01c.croquetas')::uuid, 'c1b0a000-0000-4000-8000-000000000203', 1,
        'c1b0a000-0000-4000-8000-000000000104', 1);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.f01_colocar_recetas('c01a0000-0000-4000-8000-00000000000a');
  if (r->>'colocadas')::int <> 0 or (r->>'antes_del_recuento')::int <> 1 then
    raise exception 'PRUEBA F01c · 3: la venta de antes del recuento se ha tocado o no se dice: %', r;
  end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.stock_movement where source_type = 'sale' and movement_type = 'consumo'
              and source_id = current_setting('f01c.venta_croquetas')::uuid and recipe_item_id = 'c1b0a000-0000-4000-8000-000000000203') then
    raise exception 'PRUEBA F01c · 3: la venta de Croquetas de antes del recuento ha descontado el pan (regla 6).';
  end if;
  raise notice '3 · regla 6: la venta de Croquetas de antes del recuento no se toca, y se dice (1 antes del recuento)';
end $$;

-- ── 4 · El código cambiado (tablero 4) ──────────────────────────────────────
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  org constant uuid := 'f01c2e00-0000-4000-8000-0000000000a0';
  b constant uuid := 'f01c2e00-0000-4000-8000-0000000000b1';
  v jsonb; q jsonb; r jsonb;
begin
  v := public.f01_marcas_por_revisar(a);
  if (select string_agg(x->>'nombre', ', ' order by x->>'nombre') from jsonb_array_elements(v->'preguntas') x) <> 'Pollería Express, Pollos Nuevos' then
    raise exception 'PRUEBA F01c · 4: antes de la pasada se tendrían que preguntar Express y Nuevos: %', v->'preguntas';
  end if;
  r := public.e2e_f01c_preparar('pasada');
  if jsonb_array_length(r->'reconocidas_solas') <> 1 or r->'reconocidas_solas'->0->>'nombre_last' <> 'Pollería Express'
     or (r->'reconocidas_solas'->0->'ventas'->>'colocadas')::int <> 1 then
    raise exception 'PRUEBA F01c · 4: la pasada no ha unido Express sola con su venta: %', r;
  end if;
  v := public.f01_marcas_por_revisar(a);
  if (select count(*) from jsonb_array_elements(v->'reconocidas') x where x->>'nombre_last' = 'Pollería Express' and x->>'como' = 'sola') <> 1 then
    raise exception 'PRUEBA F01c · 4: no se avisa de lo que ha hecho con Express: %', v->'reconocidas';
  end if;
  select x into q from jsonb_array_elements(v->'preguntas') x where x->>'nombre' = 'Pollos Nuevos';
  if q is null or (q->'comparacion'->>'coinciden')::int <> 3 or (q->'comparacion'->>'platos_last')::int <> 4
     or not (q->'comparacion'->>'parecida')::boolean or (q->'comparacion'->>'identica')::boolean or (q->'ventas'->>'despues')::int <> 2 then
    raise exception 'PRUEBA F01c · 4: Pollos Nuevos no se pregunta como se espera: %', q - 'comparacion' || jsonb_build_object('c', q->'comparacion' - 'cartas');
  end if;
  r := public.f01_decidir_marca(a, org, 'Pollos Nuevos', b, true);
  if (r->'ventas'->>'colocadas')::int <> 2 or (r->'ventas'->>'fallidas')::int <> 0 then
    raise exception 'PRUEBA F01c · 4: «Sí, es la Pollería» no ha colocado sus 2 ventas: %', r - 'carta';
  end if;
end $$;
reset role;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  n int;
begin
  if (select count(*) from public.sale where account_id = a and external_ref in ('f01c-e2e-2', 'f01c-e2e-3', 'f01c-e2e-4') and is_active
        and brand_id = 'f01c2e00-0000-4000-8000-0000000000b1') <> 3 then
    raise exception 'PRUEBA F01c · 4: las ventas de Express y Pollos Nuevos no tienen la marca de la Pollería.';
  end if;
  -- El pollo de Pollos Nuevos (otra matrícula) se junta con el de la Pollería y descuenta su pan.
  perform public.close_sale(s.id) from public.sale s where s.account_id = a and s.external_ref = 'f01c-e2e-3' and s.is_active;
  select count(*) into n from public.stock_movement sm join public.sale s on s.id = sm.source_id
   where s.account_id = a and s.external_ref = 'f01c-e2e-3' and sm.movement_type = 'consumo' and sm.recipe_item_id = 'c1b0a000-0000-4000-8000-000000000203';
  if n = 0 then raise exception 'PRUEBA F01c · 4: el pollo de Pollos Nuevos no descuenta el pan de la receta de la Pollería.'; end if;
  raise notice '4 · Express unida sola y avisada; Pollos Nuevos preguntada (3 de 4) y confirmada: sus 2 ventas, con marca; el pollo descuenta el pan';
end $$;

-- La pasada de cada hora (la de la 0851), dos veces: la segunda no hace nada nuevo.
do $$
declare r jsonb;
begin
  perform public.f01_pasada_last('c01a0000-0000-4000-8000-00000000000a');
  r := public.f01_pasada_last('c01a0000-0000-4000-8000-00000000000a');
  if r->'marcas_con_vinculos_nuevos' <> '[]'::jsonb or r->'reconocidas_solas' <> '[]'::jsonb or (r->'recetas'->>'colocadas')::int <> 0 then
    raise exception 'PRUEBA F01c · 4: la pasada repetida vuelve a hacer algo: %', r;
  end if;
  raise notice '4 · la pasada de cada hora, repetida: nada nuevo';
end $$;

-- ── 5 · Regla 10: los cuatro caminos con la tanda puesta ────────────────────
-- 5.1 · Cerrar una venta: hecho en 2 (Alitas, ya con receta, descuenta) y en 4.
-- El disparador no estorba al editar una receta que no es de Last.
do $$
declare v_r uuid;
begin
  insert into public.recipe_item (account_id, type, name, base_unit_id, is_active, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'recipe', 'Salsa de prueba F01c', 'c1b0a000-0000-4000-8000-000000000104', true, 'prueba')
  returning id into v_r;
  insert into public.recipe_line (account_id, parent_item_id, child_item_id, quantity_net, unit_id, position)
  values ('c01a0000-0000-4000-8000-00000000000a', v_r, 'c1b0a000-0000-4000-8000-000000000204', 1, 'c1b0a000-0000-4000-8000-000000000104', 1);
  update public.recipe_line set quantity_net = 2 where parent_item_id = v_r;
  delete from public.recipe_line where parent_item_id = v_r;
  if exists (select 1 from public.f01_receta_puesta where recipe_item_id = v_r) then
    raise exception 'PRUEBA F01c · 5.1: una elaboración que no es de Last ha entrado en la cola.';
  end if;
  raise notice '5.1 · cerrar una venta: ya en 2 y en 4; editar una receta que no es de Last no entra en la cola';
end $$;

-- 5.2 a 5.4 · Recibir un albarán, apuntar una merma y aprobar un recuento (los de la prueba de Compras).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_s uuid;
begin
  insert into public.supplier (id, account_id, name, invoicing_mode, created_by_name) values
    ('f01c0000-0000-4000-8000-000000000101', v_acc, 'Proveedor Prueba F01c, S.L.', 'delivery_note_then_invoice', 'prueba');
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (v_acc, 'photo', jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran', 'bill_to_name', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA'), 'lines', '[]'::jsonb), 'pending_review')
  returning id into v_s;
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values ('f01c0000-0000-4000-8000-000000000301', v_acc, v_loc, 'f01c0000-0000-4000-8000-000000000101', 'borrador', current_date, v_s, 'F01C-301', 'prueba');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, 'f01c0000-0000-4000-8000-000000000301', 'Pan', 24, 'c1b0a000-0000-4000-8000-000000000203', 24, 0.3);
end $$;

set local role authenticated;
do $$
declare v_r record;
begin
  select * into v_r from public.confirm_goods_receipt('f01c0000-0000-4000-8000-000000000301');
  if v_r.posted_lines < 1 then raise exception 'PRUEBA F01c · 5.2: el albarán no ha entrado en el almacén (% líneas).', v_r.posted_lines; end if;
  raise notice '5.2 · recibir un albarán (como el usuario de A): % línea(s) al almacén', v_r.posted_lines;

  select * into v_r from public.register_waste('c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'c1b0a000-0000-4000-8000-000000000203',
    'caducado', 1, null, null, null, null, null, null, 'prueba F01c', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then raise exception 'PRUEBA F01c · 5.3: la merma no se ha apuntado.'; end if;
  raise notice '5.3 · apuntar una merma (como el usuario de A): %', v_r.waste_id;
end $$;
reset role;

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_item constant uuid := 'c1b0a000-0000-4000-8000-000000000203';
  v_rec uuid := 'f01c0000-0000-4000-8000-000000000401';
  v_r record;
begin
  insert into public.inventory_count (id, account_id, location_id, status, kind) values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('f01c0000-0000-4000-8000-000000000402', v_acc, v_rec, v_item,
          (select x.qty_on_hand from public.recipe_item_location_stock x where x.recipe_item_id = v_item and x.location_id = v_loc));
  perform public.save_count_line('f01c0000-0000-4000-8000-000000000402',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty',
            (select greatest(x.qty_on_hand, 0) from public.recipe_item_location_stock x where x.recipe_item_id = v_item and x.location_id = v_loc))),
          null, null, null);
  perform public.close_inventory_count(v_rec);
  update public.inventory_count_line set reason_code = 'error_conteo', reason_note = 'prueba F01c' where id = 'f01c0000-0000-4000-8000-000000000402';
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA F01c · 5.4: el recuento no ha quedado aprobado.';
  end if;
  raise notice '5.4 · aprobar un recuento: % ajuste(s), % artículo(s) recalculados', v_r.adjustments, v_r.items_recomputed;
end $$;

-- ── 6 · La vuelta atrás, sobre estos datos ──────────────────────────────────
\i supabase/vuelta-atras/20261028T0851_f01c_cola_y_pasada.down.sql
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_recipe_line_f01c_receta_puesta') then
    raise exception 'PRUEBA F01c · 6: la vuelta atrás de la 0851 no quita el disparador de recipe_line.';
  end if;
  if pg_get_functiondef('public.f01_pasada_last(uuid)'::regprocedure) like '%_f01c_%' then
    raise exception 'PRUEBA F01c · 6: la vuelta atrás de la 0851 no restaura f01_pasada_last.';
  end if;
  raise notice '6 · la vuelta atrás de la 0851: sin disparador y la pasada como en la 1320';
end $$;
do $$
begin
  begin
    execute 'do $x$ begin if exists (select 1 from public.f01_marca_reconocida where como in (''confirmada'', ''otra'')) then raise exception ''para''; end if; end $x$';
    raise exception 'PRUEBA F01c · 6: no hay decisiones con las que comprobar que la vuelta atrás de la 0850 para.';
  exception when raise_exception then
    if sqlerrm like 'PRUEBA%' then raise; end if;
  end;
  delete from public.f01_marca_reconocida where account_id = 'c01a0000-0000-4000-8000-00000000000a' and como in ('confirmada', 'otra');
end $$;
\i supabase/vuelta-atras/20261028T0850_f01c_recetas_y_codigo.down.sql
do $$
begin
  if to_regclass('public.f01_receta_puesta') is not null or to_regclass('public.f01_marca_reconocida') is not null
     or to_regprocedure('public.f01_carta_marca(uuid,uuid)') is not null or to_regprocedure('public.f01_decidir_marca(uuid,uuid,text,uuid,boolean)') is not null then
    raise exception 'PRUEBA F01c · 6: la vuelta atrás de la 0850 no deja la base como estaba.';
  end if;
  if (select count(*) from public.external_brand_alta where external_org_id = 'f01c2e00-0000-4000-8000-0000000000a0') <> 3 then
    raise exception 'PRUEBA F01c · 6: la vuelta atrás ha tocado lo unido en tablas que existían.';
  end if;
  raise notice '6 · la vuelta atrás de la 0850: sin sus tablas ni sus funciones; las marcas unidas se quedan';
end $$;

rollback;
