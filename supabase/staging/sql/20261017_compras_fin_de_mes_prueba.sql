-- ============================================================================
-- PRUEBA (staging) · Compras · 6 · lo que espera factura, casar la factura y
-- el fin de mes. Todo en una transacción con ROLLBACK.
--
-- Prueba la 0150: compras_esperando_factura, compras_casar_candidatos,
-- compras_casar, compras_fin_de_mes y los dos orígenes nuevos de
-- journal_entry (el asiento de fin de mes y su contrario, por
-- journal_entry_proponer, como lo haría el libro).
--
-- La forma es la de D en Foodint (T1): un proveedor que entrega con albarán y
-- factura una vez al mes por local. Nombres inventados.
--   r1 05/10 Centro  100,00 · r2 20/10 Centro 50,00 · r3 25/10 Mercado 30,00
--   r4 02/11 Centro   70,00
--   La factura de octubre del Centro llega el 03/11 con 155,00 de base.
--
--   1. Esperando factura: Centro 3 recepciones (220,00) desde el 05/10;
--      Mercado 1 (30,00).
--   2. Fin de octubre: Centro 150,00 (r1, r2) y Mercado 30,00. r4 no.
--   3. Casar (§7.3): candidatas r1, r2 y r4 propuestas (su local), r3 no;
--      casada con r1 y r2, la diferencia de 5,00 se enseña.
--   4. Octubre otra vez: sigue con r1 y r2 (la factura es del 03/11) y la
--      misma fila. Noviembre: Centro r4 (70,00) y Mercado r3 (30,00).
--   5. §7.4: el asiento de fin de mes y su contrario el día 1 se proponen con
--      los orígenes nuevos, una vez cada uno.
--   6. Puertas: sin usuario no se casa; desde la cuenta B no se ve nada.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recibe(p_id uuid, p_local uuid, p_dia date, p_base numeric) returns uuid language plpgsql as $$
declare v_s uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran', 'doc_number', 'AL-' || right(p_id::text, 3),
                               'bill_to_name', 'Taberna de Prueba Norte, S.L.', 'tax_base_total', p_base),
                             'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Carne', 'line_amount', p_base, 'vat_pct', 10))), 'pending_review')
  returning id into v_s;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', p_local, 'c0e00000-0000-4000-8000-000000000001', 'borrador', p_dia, v_s, 'prueba');
  perform confirm_goods_receipt(p_id);
  return p_id;
end $$;

do $$
declare c_centro constant uuid := 'c01a0000-0000-4000-8000-0000000000a2'; c_mercado constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
begin
  insert into supplier (id, account_id, name, tax_id, invoicing_mode, invoicing_per_location, invoicing_frequency, created_by_name)
  values ('c0e00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-00000000000a', 'Carnes Prueba Siete, S.L.', 'B00000077',
          'delivery_note_then_invoice', true, 'monthly', 'prueba');
  perform pg_temp.recibe('c0e00000-0000-4000-8000-000000000101', c_centro,  date '2026-10-05', 100.00);
  perform pg_temp.recibe('c0e00000-0000-4000-8000-000000000102', c_centro,  date '2026-10-20', 50.00);
  perform pg_temp.recibe('c0e00000-0000-4000-8000-000000000103', c_mercado, date '2026-10-25', 30.00);
  perform pg_temp.recibe('c0e00000-0000-4000-8000-000000000104', c_centro,  date '2026-11-02', 70.00);
  if (select count(*) from goods_receipt_path where goods_receipt_id::text like 'c0e00000-%' and path = 'pendiente_factura') <> 4 then
    raise exception 'PRUEBA fin de mes · siembra: las 4 recepciones no han quedado pendientes de factura.';
  end if;
end $$;

-- ── 1 · Esperando factura ──────────────────────────────────────────────────
do $$
declare v text;
begin
  select string_agg(format('%s:%s/%s/%s', location_name, receipts, base, oldest), ' · ' order by location_name) into v
    from public.compras_esperando_factura('c01a0000-0000-4000-8000-00000000000a') where supplier_id = 'c0e00000-0000-4000-8000-000000000001';
  if v is distinct from 'Norte Centro:3/220.00/2026-10-05 · Norte Mercado:1/30.00/2026-10-25' then
    raise exception 'PRUEBA fin de mes · 1: esperando factura dice «%».', v;
  end if;
  raise notice '1 · esperando factura: %', v;
end $$;

-- ── 2 · Fin de octubre ─────────────────────────────────────────────────────
create temp table _id (que text primary key, id uuid) on commit drop;
do $$
declare v text; v_id uuid;
begin
  select string_agg(format('%s:%s (%s)', l.name, a.base, (select string_agg(r->>'code', ',' order by r->>'fecha') from jsonb_array_elements(a.receipts) r)), ' · ' order by l.name) into v
    from public.compras_fin_de_mes('3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-10-15') a join locations l on l.id = a.location_id
   where a.supplier_id = 'c0e00000-0000-4000-8000-000000000001';
  if v not like 'Norte Centro:150.00 (%,%) · Norte Mercado:30.00 (%)' then
    raise exception 'PRUEBA fin de mes · 2: el fin de octubre dice «%».', v;
  end if;
  select id into v_id from purchase_accrual where supplier_id = 'c0e00000-0000-4000-8000-000000000001' and month = '2026-10-01' and location_id = 'c01a0000-0000-4000-8000-0000000000a2';
  insert into _id values ('octubre_centro', v_id);
  raise notice '2 · fin de octubre: %', v;
end $$;

-- ── 3 · Casar la factura de octubre del Centro ─────────────────────────────
do $$
declare v_s uuid; v_f jsonb; v_c text; v jsonb; f supplier_invoice;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'pdf',
          jsonb_build_object('document', jsonb_build_object('doc_type', 'factura', 'doc_number', 'FM-10', 'doc_date', '2026-11-03',
                               'bill_to_name', 'Taberna de Prueba Norte, S.L.', 'tax_base_total', 155, 'tax_total', 15.5, 'grand_total', 170.5),
                             'lines', '[{"raw_text": "Carne octubre", "line_amount": 155, "vat_pct": 10}]'::jsonb), 'pending_review')
  returning id into v_s;
  v_f := public.compras_factura_desde_papel(v_s, 'c0e00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-0000000000a2', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  select string_agg(right(goods_receipt_id::text, 3) || case when proposed then '+' else '-' end, ',' order by goods_receipt_id) into v_c
    from public.compras_casar_candidatos((v_f->>'factura')::uuid);
  if v_c <> '101+,102+,103-,104+' then raise exception 'PRUEBA fin de mes · 3: candidatas «%» (esperaba 101+,102+,103-,104+).', v_c; end if;
  v := public.compras_casar((v_f->>'factura')::uuid, array['c0e00000-0000-4000-8000-000000000101', 'c0e00000-0000-4000-8000-000000000102']::uuid[]);
  select * into f from supplier_invoice where id = (v_f->>'factura')::uuid;
  if (v->>'diferencia')::numeric <> 5.00 or f.match_status <> 'con_diferencias' or (v->>'casadas')::int <> 2
     or v->>'frase' <> 'Casada con 2 recepción(es). La factura dice 155,00 € de base y las recepciones 150,00 €: 5,00 € de diferencia.' then
    raise exception 'PRUEBA fin de mes · 3: casar no enseña la diferencia (%).', v;
  end if;
  if exists (select 1 from public.compras_esperando_factura('c01a0000-0000-4000-8000-00000000000a') where supplier_id = 'c0e00000-0000-4000-8000-000000000001' and receipts <> 1) then
    raise exception 'PRUEBA fin de mes · 3: lo casado sigue esperando factura.';
  end if;
  begin
    perform public.compras_casar((v_f->>'factura')::uuid, array['c0e00000-0000-4000-8000-000000000101']::uuid[]);
    raise exception 'PRUEBA fin de mes · 3: se ha podido casar dos veces la misma recepción.';
  exception when sqlstate '22023' then null;
  end;
  insert into _id values ('factura', (v_f->>'factura')::uuid);
  raise notice '3 · §7.3: candidatas % (el + es la propuesta: su local); «%»', v_c, v->>'frase';
end $$;

-- ── 4 · Octubre otra vez, y noviembre ──────────────────────────────────────
do $$
declare v_oct text; v_nov text;
begin
  select string_agg(format('%s:%s', l.name, a.base), ' · ' order by l.name) into v_oct
    from public.compras_fin_de_mes('3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-10-01') a join locations l on l.id = a.location_id
   where a.supplier_id = 'c0e00000-0000-4000-8000-000000000001';
  select string_agg(format('%s:%s', l.name, a.base), ' · ' order by l.name) into v_nov
    from public.compras_fin_de_mes('3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-11-01') a join locations l on l.id = a.location_id
   where a.supplier_id = 'c0e00000-0000-4000-8000-000000000001';
  if v_oct <> 'Norte Centro:150.00 · Norte Mercado:30.00' or v_nov <> 'Norte Centro:70.00 · Norte Mercado:30.00' then
    raise exception 'PRUEBA fin de mes · 4: octubre «%», noviembre «%».', v_oct, v_nov;
  end if;
  if (select id from purchase_accrual where supplier_id = 'c0e00000-0000-4000-8000-000000000001' and month = '2026-10-01' and location_id = 'c01a0000-0000-4000-8000-0000000000a2')
     <> (select id from _id where que = 'octubre_centro') then
    raise exception 'PRUEBA fin de mes · 4: recalcular octubre ha cambiado la fila (y con ella el origen del asiento).';
  end if;
  raise notice '4 · octubre otra vez: % (la factura es del 03/11: a 31/10 no estaba); noviembre: %', v_oct, v_nov;
end $$;

-- ── 5 · El asiento de fin de mes y su contrario ────────────────────────────
do $$
declare v_id uuid := (select id from _id where que = 'octubre_centro'); r1 jsonb; r2 jsonb; r3 jsonb;
  v_lineas jsonb := jsonb_build_array(
    jsonb_build_object('cuenta', '60000000', 'debe', 150, 'haber', 0, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2', 'comun', false),
    jsonb_build_object('cuenta', '40090000', 'debe', 0, 'haber', 150, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2', 'comun', false));
begin
  r1 := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
          jsonb_build_object('series', 2, 'fecha', '2026-10-31', 'concepto', 'Recibido sin factura · Carnes Prueba Siete · octubre',
                             'source_type', 'purchase_accrual', 'source_id', v_id, 'confianza', 'seguro', 'porque', 'prueba', 'razones', '[]'::jsonb),
          v_lineas, null, 'Prueba');
  r2 := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
          jsonb_build_object('series', 2, 'fecha', '2026-10-31', 'concepto', 'otra vez', 'source_type', 'purchase_accrual', 'source_id', v_id,
                             'confianza', 'seguro', 'porque', 'prueba', 'razones', '[]'::jsonb),
          v_lineas, null, 'Prueba');
  r3 := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
          jsonb_build_object('series', 2, 'fecha', '2026-11-01', 'concepto', 'Contrario del recibido sin factura de octubre',
                             'source_type', 'purchase_accrual_reversal', 'source_id', v_id, 'confianza', 'seguro', 'porque', 'prueba', 'razones', '[]'::jsonb),
          jsonb_build_array(
            jsonb_build_object('cuenta', '40090000', 'debe', 150, 'haber', 0, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2', 'comun', false),
            jsonb_build_object('cuenta', '60000000', 'debe', 0, 'haber', 150, 'local_id', 'c01a0000-0000-4000-8000-0000000000a2', 'comun', false)),
          null, 'Prueba');
  if r1->>'id' is null or not coalesce((r2->>'existente')::boolean, false) or r3->>'id' is null then
    raise exception 'PRUEBA fin de mes · 5: proponer con los orígenes nuevos no ha ido (% / % / %).', r1, r2, r3;
  end if;
  if (select count(*) from journal_entry where source_id = v_id and source_type in ('purchase_accrual', 'purchase_accrual_reversal')) <> 2 then
    raise exception 'PRUEBA fin de mes · 5: no hay exactamente dos asientos de ese origen.';
  end if;
  raise notice '5 · §7.4: el asiento del 31/10 y su contrario del 01/11, propuestos una vez cada uno (el segundo intento: ya estaba)';
end $$;

-- ── 6 · Puertas ────────────────────────────────────────────────────────────
select set_config('prueba.factura', (select id::text from _id where que = 'factura'), true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.compras_casar(current_setting('prueba.factura')::uuid, array['c0e00000-0000-4000-8000-000000000104']::uuid[]);
    raise exception 'PRUEBA fin de mes · 6: sin usuario se ha podido casar.';
  exception when sqlstate '42501' then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from purchase_accrual where supplier_id = 'c0e00000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'PRUEBA fin de mes · 6: desde la cuenta B se ve el fin de mes de A.';
  end if;
  begin
    perform public.compras_esperando_factura('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'PRUEBA fin de mes · 6: desde la cuenta B se lee lo que espera factura en A.';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.compras_casar_candidatos(current_setting('prueba.factura')::uuid);
    raise exception 'PRUEBA fin de mes · 6: desde la cuenta B se leen las candidatas de una factura de A.';
  exception when sqlstate '42501' then null;
  end;
  raise notice '6 · sin usuario no se casa; desde la cuenta B: 0 filas y las lecturas paran (bien)';
end $$;
reset role;

rollback;
