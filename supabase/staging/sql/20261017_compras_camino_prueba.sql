-- ============================================================================
-- PRUEBA (staging) · Compras · 3 · cómo te factura cada proveedor y qué dice
-- cada papel. Todo en una transacción con ROLLBACK.
--
-- Prueba la 0120: compras_nombre_norm, _compras_destinatario,
-- _compras_camino_calcula, _compras_camino_guarda, el disparador
-- tg_goods_receipt_compras_camino, _compras_destinatario_decide,
-- compras_forma_facturar, compras_ficha_le_falta, y la fusión redefinida
-- (_supplier_merge y _supplier_merge_undo mueven y devuelven lo de compras).
--
-- La población: los nombres de destinatario son de la FORMA que tienen los
-- papeles reales de Foodint (medido el 10/10 sobre 290): la razón social con
-- sus variantes («…, SOCIEDAD LIMITADA», «… S.L.», «… SL»), la del proveedor
-- que liquida, el nombre de un centro suyo con el código de cliente delante
-- («046935- … EL HORNO»), y uno que no es nadie («CONTADO …»). Los nombres son
-- inventados (el repositorio es público).
--
--   1. La normalización, contra las variantes reales.
--   2. Siembra (como el administrador de A): seis proveedores y sus papeles.
--   3. Confirmar por confirm_goods_receipt: cada recepción a su camino.
--      Aceptación §7.1 (albarán-factura «con cada entrega» → factura) y §7.2
--      (albarán de uno «con cada entrega» → pendiente y la pregunta).
--   4. Contestar «¿a nombre de quién va?»: se recuerda y redecide las dos
--      recepciones con ese nombre; «otro» deja el aviso del IVA.
--   5. Cambiar la costumbre de la ficha quita la pregunta.
--   6. Lo que le falta a la ficha: el NIF que ofrecen sus papeles (el más
--      leído, y cuántos distintos), el tipo de gasto y la forma.
--   7. Las puertas: sin usuario no se contesta ni se cambia la ficha; desde
--      la cuenta B no se lee el camino de A.
--   8. La fusión mueve y devuelve el camino y lo recordado, y rellena la forma.
--   9. Regla 10: los cuatro caminos (venta, albarán, merma, recuento) con el
--      disparador puesto.
--      (El almacén apunta la recepción por LÍNEA: source_type
--      'goods_receipt_line' y source_id = la línea; se cuenta con el join.)
--  10. Si decidir FALLA, la recepción se confirma igual (y entra al almacén) y
--      el camino queda «error» con el mensaje (encargo §8).
-- ============================================================================

begin;

-- ── 1 · La normalización ───────────────────────────────────────────────────
do $$
declare r record; v_mal text := '';
begin
  for r in select * from (values
      ('TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA', 'taberna de prueba norte'),
      ('Taberna de Prueba Norte S.L.',              'taberna de prueba norte'),
      ('TABERNA DE PRUEBA NORTE SL',                'taberna de prueba norte'),
      ('Taberna de Prueba Norte, S.L.',             'taberna de prueba norte'),
      ('MARCAS PRUEBA SOCIO, S.L',                  'marcas prueba socio'),
      ('046935- MARCAS PRUEBA SOCIO EL HORNO',      'marcas prueba socio el horno'),
      ('Cañaveral',                                 'canaveral'),
      ('TABERNA DE PRUEBA NORTE SL564',             'taberna de prueba norte sl564'),   -- mal leído: NO es la empresa
      ('DISTRIBUCIONES SA, S.A.U.',                 'distribuciones'),
      ('',                                          null)) t(crudo, esperado) loop
    if public.compras_nombre_norm(r.crudo) is distinct from r.esperado then
      v_mal := v_mal || format(' «%s» → «%s» (esperaba «%s»);', r.crudo, public.compras_nombre_norm(r.crudo), r.esperado);
    end if;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA camino · 1: la normalización no da lo esperado:%', v_mal; end if;
  if public.compras_nif_norm('ES-B28000016') <> 'B28000016' or public.compras_nif_norm(' b-28000016 ') <> 'B28000016' then
    raise exception 'PRUEBA camino · 1: el NIF normalizado no es el esperado.';
  end if;
  raise notice '1 · normalización: 10 de 10 variantes como se esperaba (la mal leída no se confunde con la empresa)';
end $$;

-- ── 2 · Siembra ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recepcion(p_id uuid, p_sup uuid, p_doc text, p_nombre text, p_nif_emisor text, p_dia date, p_con_linea boolean)
returns uuid language plpgsql as $$
declare v_s uuid;
begin
  if p_doc is not null then
    insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
    values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
            jsonb_build_object('document', jsonb_build_object('doc_type', p_doc, 'bill_to_name', p_nombre, 'supplier_tax_id', p_nif_emisor), 'lines', '[]'::jsonb),
            'pending_review')
    returning id into v_s;
  end if;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_sup, 'borrador', p_dia, v_s, 'P-' || right(p_id::text, 3), 'prueba');
  if p_con_linea then
    insert into goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
    values ('c01a0000-0000-4000-8000-00000000000a', p_id, 'Barril', 10, '7e000000-0000-4000-8000-000000000a01', 10, 0.6);
  end if;
  return p_id;
end $$;

create function pg_temp.camino(p_id uuid) returns goods_receipt_path language sql as $$
  select * from goods_receipt_path where goods_receipt_id = p_id
$$;

do $$
declare
  c_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_p1 uuid := 'c0c00000-0000-4000-8000-000000000001';  -- con cada entrega
  v_p2 uuid := 'c0c00000-0000-4000-8000-000000000002';  -- con cada entrega (entrega albarán)
  v_p3 uuid := 'c0c00000-0000-4000-8000-000000000003';  -- sin forma, sin NIF
  v_s  uuid := 'c0c00000-0000-4000-8000-000000000004';  -- liquida cada mes
  v_q  uuid := 'c0c00000-0000-4000-8000-000000000005';  -- sin forma (queda en la fusión)
  v_r  uuid := 'c0c00000-0000-4000-8000-000000000006';  -- agrupa (se va en la fusión)
begin
  insert into supplier (id, account_id, name, invoicing_mode, created_by_name) values
    (v_p1, c_cuenta, 'Panadería Prueba Uno, S.L.', 'per_delivery', 'prueba'),
    (v_p2, c_cuenta, 'Distribuciones Prueba Dos', 'per_delivery', 'prueba'),
    (v_p3, c_cuenta, 'Bodega Prueba Tres', null, 'prueba'),
    (v_s,  c_cuenta, 'Marcas Prueba Socio, S.L.', 'monthly_settlement', 'prueba'),
    (v_q,  c_cuenta, 'Carnes Prueba Cuatro', null, 'prueba'),
    (v_r,  c_cuenta, 'CARNES PRUEBA CUATRO', 'delivery_note_then_invoice', 'prueba');

  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000101', v_p1, 'albaran_factura', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA', null, date '2026-10-01', true);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000102', v_p2, 'albaran', 'Taberna de Prueba Norte S.L.', null, date '2026-10-01', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000103', v_p3, 'factura', 'TABERNA DE PRUEBA NORTE SL', 'B00000099', date '2026-10-01', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000104', v_s, 'albaran', 'MARCAS PRUEBA SOCIO SL', null, date '2026-10-02', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000105', v_p1, 'albaran', 'Marcas Prueba Socio, S.L.', null, date '2026-10-02', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000106', v_s, 'albaran', '046935- MARCAS PRUEBA SOCIO EL HORNO', null, date '2026-10-03', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000107', v_s, 'albaran', 'MARCAS PRUEBA SOCIO EL HORNO', null, date '2026-10-03', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000108', v_p2, 'factura', 'CONTADO PRUEBA', null, date '2026-10-04', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000109', v_r, null, null, null, date '2026-10-04', false);
  -- Dos papeles más de P3 sin confirmar, para lo que le falta a la ficha:
  -- el mismo NIF otra vez y uno distinto (como las dos lecturas de A que se
  -- diferenciaban en un dígito, T1 §2). El último papel es una factura.
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000110', v_p3, 'albaran', 'TABERNA DE PRUEBA NORTE SL', 'B-00000099', date '2026-10-05', false);
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000111', v_p3, 'factura', 'TABERNA DE PRUEBA NORTE SL', 'B00000098', date '2026-10-06', false);
  raise notice '2 · sembrados 6 proveedores y 11 recepciones en borrador';
end $$;

-- ── 3 · Confirmar: cada una a su camino ────────────────────────────────────
do $$
declare v_r record; v_n int; c record; v_mal text := '';
begin
  -- 101 lleva una línea: entra al almacén como siempre.
  select * into v_r from confirm_goods_receipt('c0c00000-0000-4000-8000-000000000101');
  select count(*) into v_n from stock_movement m join goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = 'c0c00000-0000-4000-8000-000000000101';
  if v_r.posted_lines <> 1 or v_n <> 1 then
    raise exception 'PRUEBA camino · 3: la recepción con línea no ha entrado al almacén (líneas %, movimientos %).', v_r.posted_lines, v_n;
  end if;
  for c in select unnest(array['102','103','104','105','106','107','108','109']) x loop
    perform confirm_goods_receipt(('c0c00000-0000-4000-8000-000000000' || c.x)::uuid);
  end loop;

  for c in select * from (values
      ('101', 'factura',           null,              'nombre',      '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0c00000-0000-4000-8000-000000000001'),
      ('102', 'pendiente_factura', 'papel_y_ficha',   'nombre',      '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0c00000-0000-4000-8000-000000000002'),
      ('103', 'factura',           'ficha_sin_forma', 'nombre',      '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0c00000-0000-4000-8000-000000000003'),
      ('104', 'liquidacion',       null,              'nombre',      null,                                   'c0c00000-0000-4000-8000-000000000004'),
      ('105', 'liquidacion',       null,              'nombre',      null,                                   'c0c00000-0000-4000-8000-000000000004'),
      ('106', 'sin_decidir',       'a_nombre_de',     'desconocido', null,                                   'c0c00000-0000-4000-8000-000000000004'),
      ('107', 'sin_decidir',       'a_nombre_de',     'desconocido', null,                                   'c0c00000-0000-4000-8000-000000000004'),
      ('108', 'sin_decidir',       'a_nombre_de',     'desconocido', null,                                   'c0c00000-0000-4000-8000-000000000002'),
      ('109', 'pendiente_factura', null,              'ficha',       null,                                   'c0c00000-0000-4000-8000-000000000006')
    ) t(rec, path, question, how, company, sup) loop
    declare p goods_receipt_path := pg_temp.camino(('c0c00000-0000-4000-8000-000000000' || c.rec)::uuid);
    begin
      if p.id is null then v_mal := v_mal || format(' %s sin fila;', c.rec); continue; end if;
      if (p.path, p.question, p.bill_to_how, p.company_id::text, p.supplier_id::text) is distinct from (c.path, c.question, c.how, c.company, c.sup) then
        v_mal := v_mal || format(' %s: %s/%s/%s/%s/%s (esperaba %s/%s/%s/%s/%s);', c.rec, p.path, p.question, p.bill_to_how, p.company_id, p.supplier_id,
                                 c.path, c.question, c.how, c.company, c.sup);
      end if;
    end;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA camino · 3: caminos distintos de lo esperado:%', v_mal; end if;

  -- Las frases y lo que acompaña a la pregunta.
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000102')).question_detail->>'sugerida' <> 'delivery_note_then_invoice'
     or (pg_temp.camino('c0c00000-0000-4000-8000-000000000103')).question_detail->>'sugerida' <> 'per_delivery' then
    raise exception 'PRUEBA camino · 3: la forma sugerida no sale del papel.';
  end if;
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000105')).reason not like 'Lo trae Panadería Prueba Uno%' then
    raise exception 'PRUEBA camino · 3: el papel de otro a nombre del que liquida no lo explica: %', (pg_temp.camino('c0c00000-0000-4000-8000-000000000105')).reason;
  end if;
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000106')).question_detail->'candidatos'->0->>'id' <> 'c0c00000-0000-4000-8000-000000000004' then
    raise exception 'PRUEBA camino · 3: el primer candidato para «… EL HORNO» no es el que liquida y empieza igual: %',
      (pg_temp.camino('c0c00000-0000-4000-8000-000000000106')).question_detail->'candidatos';
  end if;
  raise notice '3 · 9 recepciones confirmadas, cada una a su camino: %',
    (select string_agg(right(goods_receipt_id::text, 3) || ' ' || path || coalesce(' (' || question || ')', ''), ' · ' order by goods_receipt_id)
       from goods_receipt_path where goods_receipt_id::text like 'c0c00000-%');
  raise notice '3 · §7.1: albarán-factura de «con cada entrega» → %; §7.2: albarán de «con cada entrega» → % con «%»',
    (pg_temp.camino('c0c00000-0000-4000-8000-000000000101')).path, (pg_temp.camino('c0c00000-0000-4000-8000-000000000102')).path,
    (pg_temp.camino('c0c00000-0000-4000-8000-000000000102')).reason;
end $$;

-- ── 4 · Contestar «¿a nombre de quién va?» ─────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.compras_destinatario_decide('c01a0000-0000-4000-8000-00000000000a', 'Marcas Prueba Socio El Horno', null, 'c0c00000-0000-4000-8000-000000000004', false);
  if (v->>'recepciones')::int <> 2 then raise exception 'PRUEBA camino · 4: contestar debía redecidir 2 recepciones, y ha redecidido %.', v->>'recepciones'; end if;
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000106')).path <> 'liquidacion' or (pg_temp.camino('c0c00000-0000-4000-8000-000000000107')).path <> 'liquidacion'
     or (pg_temp.camino('c0c00000-0000-4000-8000-000000000106')).bill_to_how <> 'recordado' then
    raise exception 'PRUEBA camino · 4: las dos del centro del socio no han pasado a su liquidación.';
  end if;
  v := public.compras_destinatario_decide('c01a0000-0000-4000-8000-00000000000a', 'CONTADO PRUEBA', null, null, true);
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000108')).path <> 'a_nombre_de_otro'
     or (pg_temp.camino('c0c00000-0000-4000-8000-000000000108')).question <> 'a_nombre_de_otro' then
    raise exception 'PRUEBA camino · 4: el papel a nombre de otro no ha quedado con su aviso.';
  end if;
  begin
    perform public.compras_destinatario_decide('c01a0000-0000-4000-8000-00000000000a', 'X', 'c0c00000-0000-4000-8000-000000000004', 'c0c00000-0000-4000-8000-000000000004', false);
    raise exception 'PRUEBA camino · 4: contestar con dos respuestas a la vez no ha parado.';
  exception when sqlstate '22023' then null;
  end;
  raise notice '4 · contestado una vez: las 2 recepciones con ese nombre a la liquidación (lo recordado: %); «CONTADO PRUEBA» → %',
    (select count(*) from purchase_bill_to where account_id = 'c01a0000-0000-4000-8000-00000000000a'),
    (pg_temp.camino('c0c00000-0000-4000-8000-000000000108')).reason;
end $$;

-- ── 5 · Cambiar la costumbre de la ficha ───────────────────────────────────
do $$
declare v jsonb; s supplier;
begin
  v := public.compras_forma_facturar('c0c00000-0000-4000-8000-000000000002', 'delivery_note_then_invoice', true, 'monthly');
  select * into s from supplier where id = 'c0c00000-0000-4000-8000-000000000002';
  if s.invoicing_mode <> 'delivery_note_then_invoice' or not s.invoicing_per_location or s.invoicing_frequency <> 'monthly' then
    raise exception 'PRUEBA camino · 5: la ficha no ha quedado como se pidió (%/%/%).', s.invoicing_mode, s.invoicing_per_location, s.invoicing_frequency;
  end if;
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000102')).question is not null
     or (pg_temp.camino('c0c00000-0000-4000-8000-000000000102')).path <> 'pendiente_factura' then
    raise exception 'PRUEBA camino · 5: cambiar la ficha no ha quitado la pregunta del albarán.';
  end if;
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000108')).path <> 'a_nombre_de_otro' then
    raise exception 'PRUEBA camino · 5: redecidir ha pisado lo contestado.';
  end if;
  raise notice '5 · la ficha pasa a «entrega con albarán y factura después», por local y al mes: % recepciones redecididas, la pregunta desaparece', v->>'recepciones';
end $$;

-- ── 6 · Lo que le falta a la ficha ─────────────────────────────────────────
do $$
declare v jsonb; v_nif jsonb;
begin
  v := public.compras_ficha_le_falta('c0c00000-0000-4000-8000-000000000003');
  select x into v_nif from jsonb_array_elements(v) x where x->>'falta' = 'nif';
  if v_nif->>'ofrece' <> 'B00000099' or (v_nif->>'veces')::int <> 2 or (v_nif->>'otros_distintos')::int <> 1 then
    raise exception 'PRUEBA camino · 6: el NIF ofrecido no es el más leído (%).', v_nif;
  end if;
  if not (v @> '[{"falta": "tipo_gasto"}]' and v @> '[{"falta": "forma_facturar", "ultimo_papel": "factura"}]') then
    raise exception 'PRUEBA camino · 6: no dice que le falta el tipo de gasto y la forma con su último papel (%).', v;
  end if;
  if (select tax_id from supplier where id = 'c0c00000-0000-4000-8000-000000000003') is not null then
    raise exception 'PRUEBA camino · 6: el NIF se ha escrito solo.';
  end if;
  if public.compras_ficha_le_falta('c0c00000-0000-4000-8000-000000000004') @> '[{"falta": "forma_facturar"}]' then
    raise exception 'PRUEBA camino · 6: a una ficha con forma le dice que le falta.';
  end if;
  raise notice '6 · a la ficha sin datos le falta: %', v;
end $$;

-- ── 7 · Las puertas ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.compras_destinatario_decide('c01a0000-0000-4000-8000-00000000000a', 'OTRO NOMBRE', null, null, true);
    raise exception 'PRUEBA camino · 7: sin usuario se ha podido contestar.';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.compras_forma_facturar('c0c00000-0000-4000-8000-000000000003', 'per_delivery');
    raise exception 'PRUEBA camino · 7: sin usuario se ha podido cambiar la ficha.';
  exception when sqlstate '42501' then null;
  end;
  raise notice '7 · sin usuario: contestar y cambiar la ficha paran con 42501 (bien)';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_n int;
begin
  select count(*) into v_n from goods_receipt_path where goods_receipt_id::text like 'c0c00000-%';
  if v_n <> 0 then raise exception 'PRUEBA camino · 7: desde la cuenta B se ven % caminos de A.', v_n; end if;
  begin
    perform public.compras_camino_calcula('c0c00000-0000-4000-8000-000000000101');
    raise exception 'PRUEBA camino · 7: desde la cuenta B se calcula el camino de una recepción de A.';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.compras_ficha_le_falta('c0c00000-0000-4000-8000-000000000003');
    raise exception 'PRUEBA camino · 7: desde la cuenta B se lee lo que le falta a una ficha de A.';
  exception when sqlstate '42501' then null;
  end;
  raise notice '7 · desde la cuenta B: 0 caminos de A a la vista, y calcular o leer la ficha de A paran (bien)';
end $$;
reset role;

-- ── 8 · La fusión mueve y devuelve lo de compras ───────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v jsonb; v_q uuid := 'c0c00000-0000-4000-8000-000000000005'; v_r uuid := 'c0c00000-0000-4000-8000-000000000006';
begin
  perform public.compras_destinatario_decide('c01a0000-0000-4000-8000-00000000000a', 'CARNES CUATRO CENTRO', null, v_r, false);
  v := public._supplier_merge(v_q, v_r, 'Prueba');
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000109')).supplier_id <> v_q
     or (select supplier_id from purchase_bill_to where name_norm = 'carnes cuatro centro' and account_id = 'c01a0000-0000-4000-8000-00000000000a') <> v_q
     or (select invoicing_mode from supplier where id = v_q) is distinct from 'delivery_note_then_invoice' then
    raise exception 'PRUEBA camino · 8: la fusión no ha movido el camino, lo recordado o la forma (%).', v;
  end if;
  perform public._supplier_merge_undo((v->>'fusion')::uuid, 'Prueba');
  if (pg_temp.camino('c0c00000-0000-4000-8000-000000000109')).supplier_id <> v_r
     or (select supplier_id from purchase_bill_to where name_norm = 'carnes cuatro centro' and account_id = 'c01a0000-0000-4000-8000-00000000000a') <> v_r
     or (select invoicing_mode from supplier where id = v_q) is not null then
    raise exception 'PRUEBA camino · 8: deshacer la fusión no ha devuelto el camino, lo recordado o la forma.';
  end if;
  raise notice '8 · _supplier_merge mueve el camino y lo recordado y rellena la forma; _supplier_merge_undo lo devuelve todo (%)', v->>'rellenados';
end $$;

-- ── 9 · Regla 10: los cuatro caminos con el disparador puesto ──────────────
create temp table _caminos (camino text, resultado text) on commit drop;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_crudo constant uuid := '7e000000-0000-4000-8000-000000000a01';
  v_venta uuid := 'c0c00000-0000-4000-8000-000000000201';
  v_alb uuid := 'c0c00000-0000-4000-8000-000000000301';
  v_rec uuid := 'c0c00000-0000-4000-8000-000000000401';
  v_n int; v_r record;
begin
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, is_active)
  values (v_venta, v_acc, v_loc, '7e000000-0000-4000-8000-000000000b01', 'e0200000-0000-4000-8000-00000000a0c1', now(), 'open', 'new', 2.5, 'hubrise', true);
  insert into public.sale_line (account_id, sale_id, raw_text, product_name, menu_item_id, quantity, line_type)
  values (v_acc, v_venta, 'prueba', 'Caña', '7e000000-0000-4000-8000-000000000e01', 2, 'product');
  update public.sale set order_status = 'accepted' where id = v_venta;
  perform public.close_sale(v_venta);
  select count(*) into v_n from public.stock_movement where source_type = 'sale' and source_id = v_venta and movement_type = 'consumo';
  if v_n = 0 or (select status from public.sale where id = v_venta) <> 'closed' then
    raise exception 'PRUEBA camino · 9a: cerrar una venta no ha escrito su consumo (% movimientos).', v_n;
  end if;
  insert into _caminos values ('cerrar una venta', v_n || ' movimiento(s) de consumo');

  insert into public.goods_receipt (id, account_id, location_id, status) values (v_alb, v_acc, v_loc, 'borrador');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, v_alb, 'Barril', 30, v_crudo, 30, 0.6);
  select * into v_r from public.confirm_goods_receipt(v_alb);
  select count(*) into v_n from public.stock_movement m join public.goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = v_alb;
  if v_r.posted_lines < 1 or v_n = 0 then
    raise exception 'PRUEBA camino · 9b: recibir el albarán no ha entrado en el almacén (líneas %, movimientos %).', v_r.posted_lines, v_n;
  end if;
  insert into _caminos values ('recibir un albarán', v_r.posted_lines || ' línea(s), ' || v_n || ' movimiento(s); camino ' || (pg_temp.camino(v_alb)).path);

  select * into v_r from public.register_waste(v_acc, v_loc, v_crudo, 'caducado', 2, null, null, null, null, null, null, 'prueba', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then raise exception 'PRUEBA camino · 9c: la merma no se ha apuntado.'; end if;
  insert into _caminos values ('apuntar una merma', 'merma ' || v_r.waste_id || ', ' || coalesce(round(v_r.cost_eur, 2)::text, '—') || ' €');

  insert into public.inventory_count (id, account_id, location_id, status, kind) values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('c0c00000-0000-4000-8000-000000000402', v_acc, v_rec, v_crudo,
          (select x.qty_on_hand from public.recipe_item_location_stock x where x.recipe_item_id = v_crudo and x.location_id = v_loc));
  perform public.save_count_line('c0c00000-0000-4000-8000-000000000402',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty',
            (select greatest(x.qty_on_hand, 0) from public.recipe_item_location_stock x where x.recipe_item_id = v_crudo and x.location_id = v_loc))),
          null, null, null);
  perform public.close_inventory_count(v_rec);
  update public.inventory_count_line set reason_code = 'error_conteo', reason_note = 'prueba de compras' where id = 'c0c00000-0000-4000-8000-000000000402';
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA camino · 9d: el recuento no ha quedado aprobado.';
  end if;
  insert into _caminos values ('aprobar un recuento', v_r.adjustments || ' ajuste(s), ' || v_r.items_recomputed || ' artículo(s) recalculados');
  raise notice '9 · regla 10, los cuatro caminos con el disparador puesto: %', (select string_agg(camino || ' → ' || resultado, ' · ') from _caminos);
end $$;

-- ── 10 · Si decidir falla, la recepción se confirma igual ──────────────────
-- Se rompe a propósito _compras_camino_calcula (dentro de esta transacción,
-- que acaba en ROLLBACK) y se confirma una recepción con línea.
create or replace function public._compras_camino_calcula(p_recepcion uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  raise exception 'roto a propósito por la prueba';
end $$;
do $$
declare v_r record; v_n int; p goods_receipt_path;
begin
  perform pg_temp.recepcion('c0c00000-0000-4000-8000-000000000112', 'c0c00000-0000-4000-8000-000000000001', 'albaran_factura', 'TABERNA DE PRUEBA NORTE SL', null, date '2026-10-07', true);
  select * into v_r from confirm_goods_receipt('c0c00000-0000-4000-8000-000000000112');
  select count(*) into v_n from stock_movement m join goods_receipt_line l on l.id = m.source_id
   where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = 'c0c00000-0000-4000-8000-000000000112';
  p := pg_temp.camino('c0c00000-0000-4000-8000-000000000112');
  if (select status from goods_receipt where id = 'c0c00000-0000-4000-8000-000000000112') <> 'confirmado' or v_n <> 1 then
    raise exception 'PRUEBA camino · 10: con la decisión rota, la recepción no se ha confirmado entera (movimientos %).', v_n;
  end if;
  if p.path is distinct from 'error' or p.error not like '%roto a propósito%' then
    raise exception 'PRUEBA camino · 10: el fallo no ha quedado apuntado (% / %).', p.path, p.error;
  end if;
  raise notice '10 · decidir roto: la recepción se confirma (1 movimiento de almacén) y el camino queda «error»: %', p.error;
end $$;

rollback;
