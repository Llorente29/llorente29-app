-- ============================================================================
-- PRUEBA (staging) · Compras · 8 · lo que leen las pantallas. Todo en una
-- transacción con ROLLBACK.
--
-- Prueba la 0170 sobre public.goods_receipt_path: compras_mirar,
-- compras_cerrar_pregunta, compras_liquidaciones, compras_ultimos_papeles y
-- compras_camino_de. Nombres inventados.
--
--   P1 «Verduras Prueba Ocho»: ficha SIN forma de facturar.
--      r1 01/10 albarán a nombre de la empresa → pregunta ficha_sin_forma
--      r2 02/10 albarán a nombre de «Bar Desconocido Ocho» → a_nombre_de
--   P2 «Bebidas Prueba Ocho»: con cada entrega.
--      r3 03/10 factura a nombre de la empresa → camino factura, sin pregunta
--   P3 «Socio Prueba Ocho»: liquida cada mes.
--      r4 04/10 sin tipo de papel, 40,00 de base → camino liquidacion
--
--   1. Mirar: r1 y r2 con su pregunta, su frase y su importe; P1 en fichas
--      porque le falta la forma de facturar; r3 y r4 no preguntan.
--   2. Cerrar la pregunta de r2: sale de mirar; recalcular el camino no la
--      devuelve (la misma pregunta). Cerrar r3 (sin pregunta) falla.
--   3. Últimos papeles de P1: [albaran, albaran], el más nuevo primero.
--   4. La frase al confirmar: r1 albarán, r3 factura, r4 la del socio.
--   5. Liquidaciones de octubre: P3 en Norte Centro, 1 recepción, 40,00, sin
--      liquidación todavía.
--   6. Sin camino: si a una recepción se le pierde el camino, sale; rehacerlo
--      se lo devuelve sin crear otra factura de su papel.
--   7. Puertas: desde la cuenta B no se ve ni se cierra nada.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recibe(p_id uuid, p_prov uuid, p_dia date, p_tipo text, p_nombre text, p_base numeric) returns uuid language plpgsql as $$
declare v_s uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', jsonb_strip_nulls(jsonb_build_object('doc_type', p_tipo, 'doc_number', 'P8-' || right(p_id::text, 3),
                               'doc_date', p_dia, 'bill_to_name', p_nombre, 'tax_base_total', p_base,
                               'tax_total', round(p_base * 0.10, 2), 'grand_total', round(p_base * 1.10, 2))),
                             'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Género', 'line_amount', p_base, 'vat_pct', 10))), 'pending_review')
  returning id into v_s;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_prov, 'borrador', p_dia, v_s, 'prueba');
  perform confirm_goods_receipt(p_id);
  return p_id;
end $$;

do $$
begin
  insert into supplier (id, account_id, name, tax_id, invoicing_mode, created_by_name) values
    ('c0f00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-00000000000a', 'Verduras Prueba Ocho, S.L.', 'B00000081', null, 'prueba'),
    ('c0f00000-0000-4000-8000-000000000002', 'c01a0000-0000-4000-8000-00000000000a', 'Bebidas Prueba Ocho, S.L.', 'B00000082', 'per_delivery', 'prueba'),
    ('c0f00000-0000-4000-8000-000000000003', 'c01a0000-0000-4000-8000-00000000000a', 'Socio Prueba Ocho, S.L.', 'B00000083', 'monthly_settlement', 'prueba');
  perform pg_temp.recibe('c0f00000-0000-4000-8000-000000000101', 'c0f00000-0000-4000-8000-000000000001', date '2026-10-01', 'albaran', 'Taberna de Prueba Norte, S.L.', 25.00);
  perform pg_temp.recibe('c0f00000-0000-4000-8000-000000000102', 'c0f00000-0000-4000-8000-000000000001', date '2026-10-02', 'albaran', 'Bar Desconocido Ocho', 12.50);
  perform pg_temp.recibe('c0f00000-0000-4000-8000-000000000103', 'c0f00000-0000-4000-8000-000000000002', date '2026-10-03', 'factura', 'Taberna de Prueba Norte, S.L.', 60.00);
  perform pg_temp.recibe('c0f00000-0000-4000-8000-000000000104', 'c0f00000-0000-4000-8000-000000000003', date '2026-10-04', null, null, 40.00);
end $$;

do $$
declare v text;
begin
  select string_agg(right(goods_receipt_id::text, 3) || ':' || path || '/' || coalesce(question, '-'), ' · ' order by goods_receipt_id) into v
    from goods_receipt_path where goods_receipt_id::text like 'c0f00000-%';
  if v is distinct from '101:pendiente_factura/ficha_sin_forma · 102:sin_decidir/a_nombre_de · 103:factura/- · 104:liquidacion/-' then
    raise exception 'PRUEBA pantallas · siembra: los caminos son «%».', v;
  end if;
  raise notice '0 · caminos: %', v;
end $$;

-- ── 1 · Qué tienes que mirar ───────────────────────────────────────────────
do $$
declare m jsonb; v text; f jsonb;
begin
  m := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  select string_agg(format('%s:%s/%s/%s', right(r->>'recepcion', 3), r->>'pregunta', r->>'base', r->>'local_nombre'), ' · ' order by r->>'recepcion') into v
    from jsonb_array_elements(m->'recepciones') r where r->>'recepcion' like 'c0f00000-%';
  if v is distinct from '101:ficha_sin_forma/25.00/Norte Centro · 102:a_nombre_de/12.50/Norte Centro' then
    raise exception 'PRUEBA pantallas · 1: mirar enseña «%».', v;
  end if;
  if exists (select 1 from jsonb_array_elements(m->'recepciones') r where r->>'recepcion' like 'c0f00000-%' and coalesce(r->>'frase', '') = '') then
    raise exception 'PRUEBA pantallas · 1: hay una pregunta sin frase.';
  end if;
  select r into f from jsonb_array_elements(m->'fichas') r where r->>'proveedor' = 'c0f00000-0000-4000-8000-000000000001';
  if f is null or not exists (select 1 from jsonb_array_elements(f->'falta') x where x::text like '%forma_facturar%') then
    raise exception 'PRUEBA pantallas · 1: la ficha de P1 no dice que le falta la forma de facturar (%).', f;
  end if;
  raise notice '1 · mirar: % · ficha P1: %', v, f->'falta';
end $$;

-- ── 2 · Cerrar una pregunta ────────────────────────────────────────────────
do $$
declare m jsonb; v jsonb;
begin
  v := public.compras_cerrar_pregunta('c0f00000-0000-4000-8000-000000000102', 'Es de un evento, se queda así.');
  if v->>'pregunta' <> 'a_nombre_de' then raise exception 'PRUEBA pantallas · 2: cerrar devuelve %.', v; end if;
  m := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  if exists (select 1 from jsonb_array_elements(m->'recepciones') r where r->>'recepcion' = 'c0f00000-0000-4000-8000-000000000102') then
    raise exception 'PRUEBA pantallas · 2: la pregunta cerrada sigue en mirar.';
  end if;
  -- Redecidir con lo mismo saca la misma pregunta: no vuelve.
  perform public._compras_camino_guarda('c0f00000-0000-4000-8000-000000000102');
  m := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  if exists (select 1 from jsonb_array_elements(m->'recepciones') r where r->>'recepcion' = 'c0f00000-0000-4000-8000-000000000102') then
    raise exception 'PRUEBA pantallas · 2: al redecidir, la pregunta cerrada ha vuelto.';
  end if;
  if (select question_closed_note from goods_receipt_path where goods_receipt_id = 'c0f00000-0000-4000-8000-000000000102') <> 'Es de un evento, se queda así.' then
    raise exception 'PRUEBA pantallas · 2: no queda la nota.';
  end if;
  begin
    perform public.compras_cerrar_pregunta('c0f00000-0000-4000-8000-000000000103', null);
    raise exception 'PRUEBA pantallas · 2: se ha podido cerrar una recepción sin pregunta.';
  exception when sqlstate '22023' then null;
  end;
  raise notice '2 · cerrada la de r2 con su nota; no vuelve al redecidir; r3 sin pregunta no se cierra';
end $$;

-- ── 3 · Últimos papeles ────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.compras_ultimos_papeles('c0f00000-0000-4000-8000-000000000001');
  if v <> '["albaran", "albaran"]'::jsonb then raise exception 'PRUEBA pantallas · 3: últimos papeles %.', v; end if;
  v := public.compras_ultimos_papeles('c0f00000-0000-4000-8000-000000000003');
  if v <> '[]'::jsonb then raise exception 'PRUEBA pantallas · 3: el socio sin papel leído dice %.', v; end if;
  raise notice '3 · últimos papeles de P1: %', public.compras_ultimos_papeles('c0f00000-0000-4000-8000-000000000001');
end $$;

-- ── 4 · La frase al confirmar ──────────────────────────────────────────────
do $$
declare a text; b text; c text;
begin
  a := public.compras_camino_de('c0f00000-0000-4000-8000-000000000101')->>'frase';
  b := public.compras_camino_de('c0f00000-0000-4000-8000-000000000103')->>'frase';
  c := public.compras_camino_de('c0f00000-0000-4000-8000-000000000104')->>'frase';
  if a <> 'Este papel es un albarán. La oficina esperará la factura.'
     or b <> 'Este papel es una factura. Ya ha pasado a la oficina. No tienes que hacer nada más.'
     or c <> 'Este género es de Socio Prueba Ocho, S.L. Entra en la cuenta del mes.' then
    raise exception 'PRUEBA pantallas · 4: frases «%» · «%» · «%».', a, b, c;
  end if;
  raise notice '4 · r1 «%» · r3 «%» · r4 «%»', a, b, c;
end $$;

-- ── 5 · Liquidaciones del mes ──────────────────────────────────────────────
do $$
declare v jsonb; f jsonb;
begin
  v := public.compras_liquidaciones('c01a0000-0000-4000-8000-00000000000a', date '2026-10-20');
  select r into f from jsonb_array_elements(v->'filas') r where r->>'proveedor' = 'c0f00000-0000-4000-8000-000000000003';
  if v->>'mes' <> '2026-10-01' or f->>'local_nombre' <> 'Norte Centro' or (f->>'recepciones')::int <> 1
     or (f->>'base')::numeric <> 40.00 or f->>'liquidacion' is not null then
    raise exception 'PRUEBA pantallas · 5: liquidaciones de octubre %.', f;
  end if;
  if exists (select 1 from jsonb_array_elements(v->'filas') r where r->>'proveedor' in ('c0f00000-0000-4000-8000-000000000001', 'c0f00000-0000-4000-8000-000000000002')) then
    raise exception 'PRUEBA pantallas · 5: salen proveedores que no liquidan.';
  end if;
  raise notice '5 · octubre: % · % recepción · %', f->>'proveedor_nombre', f->>'recepciones', f->>'base';
end $$;

-- ── 6 · Sin camino ─────────────────────────────────────────────────────────
do $$
declare m jsonb; v jsonb; n int;
begin
  delete from goods_receipt_path where goods_receipt_id = 'c0f00000-0000-4000-8000-000000000103';
  m := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  if not exists (select 1 from jsonb_array_elements(m->'sin_camino') r where r->>'recepcion' = 'c0f00000-0000-4000-8000-000000000103') then
    raise exception 'PRUEBA pantallas · 6: la recepción sin camino no sale (%).', m->'sin_camino';
  end if;
  n := jsonb_array_length(m->'sin_camino');
  v := public.compras_camino_rehacer('c0f00000-0000-4000-8000-000000000103');
  m := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  if v->>'camino' <> 'factura' or exists (select 1 from jsonb_array_elements(m->'sin_camino') r where r->>'recepcion' = 'c0f00000-0000-4000-8000-000000000103') then
    raise exception 'PRUEBA pantallas · 6: rehacer no le devuelve el camino (%).', v;
  end if;
  if (select count(*) from supplier_invoice where ai_session_id = (select ai_session_id from goods_receipt where id = 'c0f00000-0000-4000-8000-000000000103')) <> 1 then
    raise exception 'PRUEBA pantallas · 6: rehacer ha creado otra factura del mismo papel.';
  end if;
  raise notice '6 · sin camino: % fila(s) con r3; rehecho: «%», y sigue habiendo una sola factura de su papel', n, v->>'frase';
end $$;

-- ── 7 · Puertas ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare n int := 0;
begin
  begin perform public.compras_mirar('c01a0000-0000-4000-8000-00000000000a'); exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.compras_liquidaciones('c01a0000-0000-4000-8000-00000000000a', date '2026-10-01'); exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.compras_ultimos_papeles('c0f00000-0000-4000-8000-000000000001'); exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.compras_camino_de('c0f00000-0000-4000-8000-000000000101'); exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.compras_cerrar_pregunta('c0f00000-0000-4000-8000-000000000101', null); exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.compras_camino_rehacer('c0f00000-0000-4000-8000-000000000101'); exception when sqlstate '42501' then n := n + 1; end;
  if n <> 6 then raise exception 'PRUEBA pantallas · 7: desde la cuenta B solo se paran % de 6.', n; end if;
  raise notice '7 · puertas: la cuenta B no ve, no cierra y no rehace nada (6 de 6)';
end $$;

rollback;
