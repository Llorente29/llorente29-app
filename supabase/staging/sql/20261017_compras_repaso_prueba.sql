-- ============================================================================
-- PRUEBA (staging) · Compras · 10 · el repaso. Todo en una transacción con
-- ROLLBACK. Prueba la 0190: _compras_destinatario con los nombres genéricos,
-- compras_sin_iva y compras_liquidacion_recepciones. Nombres inventados.
--
--   1. Una factura a nombre de «CONTADO.» no pregunta de quién es: va a
--      nombre de otro (aviso de IVA). Una a nombre de «Bar Raro Diez» sí
--      pregunta (no es genérico).
--   2. «Apuntarla sin descontar el IVA»: una factura, marcada, el camino a
--      factura y la pregunta cerrada; una sola factura de su papel; otra vez
--      no se puede.
--   3. Los albaranes de una liquidación: los dos del socio en ese local y mes.
--   4. Puertas: desde la cuenta B, nada.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recibe(p_id uuid, p_prov uuid, p_dia date, p_doc jsonb, p_base numeric) returns void language plpgsql as $$
declare v_s uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', p_doc || jsonb_build_object('doc_date', p_dia, 'tax_base_total', p_base,
                               'tax_total', round(p_base * 0.10, 2), 'grand_total', round(p_base * 1.10, 2)),
                             'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Género', 'line_amount', p_base, 'vat_pct', 10))), 'pending_review')
  returning id into v_s;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_prov, 'borrador', p_dia, v_s, 'prueba');
  perform confirm_goods_receipt(p_id);
end $$;

do $$
begin
  insert into supplier (id, account_id, name, tax_id, invoicing_mode, invoicing_frequency, created_by_name) values
    ('c1000000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-00000000000a', 'Bodega Prueba Diez, S.L.', 'B00000101', 'per_delivery', 'per_delivery', 'prueba'),
    ('c1000000-0000-4000-8000-000000000002', 'c01a0000-0000-4000-8000-00000000000a', 'Socio Prueba Diez, S.L.', 'B00000102', 'monthly_settlement', 'monthly', 'prueba');
  perform pg_temp.recibe('c1000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000001', date '2026-10-02',
    '{"doc_type": "factura", "doc_number": "BD-1", "bill_to_name": "CONTADO."}'::jsonb, 80.00);
  perform pg_temp.recibe('c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000001', date '2026-10-03',
    '{"doc_type": "factura", "doc_number": "BD-2", "bill_to_name": "Bar Raro Diez"}'::jsonb, 40.00);
  perform pg_temp.recibe('c1000000-0000-4000-8000-000000000201', 'c1000000-0000-4000-8000-000000000002', date '2026-09-05', '{}'::jsonb, 120.00);
  perform pg_temp.recibe('c1000000-0000-4000-8000-000000000202', 'c1000000-0000-4000-8000-000000000002', date '2026-09-20', '{}'::jsonb, 30.00);
end $$;

-- ── 1 · Los nombres que no son de nadie ────────────────────────────────────
do $$
declare v text;
begin
  select string_agg(right(goods_receipt_id::text, 3) || ':' || path || '/' || coalesce(question, '-') || '/' || coalesce(bill_to_how, '-'), ' · ' order by goods_receipt_id) into v
    from goods_receipt_path where goods_receipt_id::text like 'c1000000-%-0000000001__';
  if v is distinct from '101:a_nombre_de_otro/a_nombre_de_otro/generico · 102:sin_decidir/a_nombre_de/desconocido' then
    raise exception 'PRUEBA repaso · 1: los caminos son «%».', v;
  end if;
  if not public.compras_nombre_generico('Venta al contado') or public.compras_nombre_generico('Bar Raro Diez') then
    raise exception 'PRUEBA repaso · 1: compras_nombre_generico no separa bien.';
  end if;
  raise notice '1 · %', v;
end $$;

-- ── 2 · Apuntarla sin descontar el IVA ─────────────────────────────────────
do $$
declare v jsonb; f supplier_invoice; p goods_receipt_path; n int;
begin
  v := public.compras_sin_iva('c1000000-0000-4000-8000-000000000101', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  select * into f from supplier_invoice where id = (v->>'factura')::uuid;
  select * into p from goods_receipt_path where goods_receipt_id = 'c1000000-0000-4000-8000-000000000101';
  if not f.vat_non_deductible or f.company_id <> '3b34403a-a7d6-4a48-a8d7-737e8cababdc' or f.tax_base_total <> 80.00
     or p.path <> 'factura' or p.supplier_invoice_id <> f.id or p.consumed_at is null or p.question_closed is distinct from 'a_nombre_de_otro' then
    raise exception 'PRUEBA repaso · 2: factura % / camino %.', to_jsonb(f) - 'raw_document_url', to_jsonb(p);
  end if;
  select count(*) into n from supplier_invoice where ai_session_id = (select ai_session_id from goods_receipt where id = 'c1000000-0000-4000-8000-000000000101');
  if n <> 1 then raise exception 'PRUEBA repaso · 2: % facturas del mismo papel (esperaba 1).', n; end if;
  if exists (select 1 from jsonb_array_elements(public.compras_mirar('c01a0000-0000-4000-8000-00000000000a')->'recepciones') r
              where r->>'recepcion' = 'c1000000-0000-4000-8000-000000000101') then
    raise exception 'PRUEBA repaso · 2: apuntada, sigue en «Qué tienes que mirar».';
  end if;
  begin
    perform public.compras_sin_iva('c1000000-0000-4000-8000-000000000101', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
    raise exception 'PRUEBA repaso · 2: se ha podido apuntar dos veces.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.compras_sin_iva('c1000000-0000-4000-8000-000000000102', '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
    raise exception 'PRUEBA repaso · 2: se ha apuntado sin IVA un papel que no va a nombre de otro.';
  exception when sqlstate '22023' then null;
  end;
  raise notice '2 · «%»', v->>'frase';
end $$;

-- ── 3 · Los albaranes de una liquidación ───────────────────────────────────
do $$
declare v_liq uuid; v jsonb;
begin
  v_liq := public.compras_liquidacion_guardar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c1000000-0000-4000-8000-000000000002', 'c01a0000-0000-4000-8000-0000000000a2',
    jsonb_build_object(
      'emitida', jsonb_build_object('numero', 'AF-D10', 'fecha', '2026-09-30', 'total', 110, 'lineas', jsonb_build_array(jsonb_build_object('concepto', 'Servicio', 'base', 100, 'tipo', 10, 'total', 110))),
      'recibida', jsonb_build_object('numero', 'FV-D10', 'fecha', '2026-09-30', 'total', 44, 'lineas', jsonb_build_array(jsonb_build_object('concepto', 'Género', 'base', 40, 'tipo', 10, 'total', 44))),
      'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'), 'bloqueos', '[]'::jsonb));
  v := public.compras_liquidacion_recepciones(v_liq);
  if jsonb_array_length(v) <> 2 or (select sum((x->>'base')::numeric) from jsonb_array_elements(v) x) <> 150.00 then
    raise exception 'PRUEBA repaso · 3: los albaranes son %.', v;
  end if;
  perform set_config('prueba.liq', v_liq::text, true);
  raise notice '3 · % albaranes por %', jsonb_array_length(v), (select sum((x->>'base')::numeric) from jsonb_array_elements(v) x);
end $$;

-- ── 4 · Puertas ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare n int := 0;
begin
  begin perform public.compras_sin_iva('c1000000-0000-4000-8000-000000000102', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'); exception when sqlstate '42501' then n := n + 1; end;
  begin perform public.compras_liquidacion_recepciones(current_setting('prueba.liq')::uuid); exception when sqlstate '42501' then n := n + 1; end;
  if n <> 2 then raise exception 'PRUEBA repaso · 4: desde la cuenta B solo se paran % de 2.', n; end if;
  raise notice '4 · puertas: la cuenta B no apunta ni ve nada (2 de 2)';
end $$;

rollback;
