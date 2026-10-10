-- ============================================================================
-- PRUEBA (staging) · Compras · 7 · la liquidación mensual desde sus
-- documentos, y SEPTIEMBRE AL CÉNTIMO (aceptación 5). Todo en una transacción
-- con ROLLBACK: no deja nada en staging (las e2e cuentan asientos de A).
--
-- Prueba la 0160 sobre licensed_settlement: guardar, contrastar, casar un
-- producto, confirmar, y los tres asientos propuestos y VALIDADOS con el
-- libro registro que escriben.
--
-- La lectura es la de los cinco PDF reales de septiembre pasados por
-- lectorLiquidacionMensual.ts fuera del repositorio, con los nombres y los
-- NIF cambiados por los de prueba; las ventas y el inventario, inventados
-- (llevan marcas y productos del socio). Los asientos son los que da
-- liquidacionMensual() con esa lectura y las cuentas de la empresa de A.
--
--   1. Guardar: los importes de siempre rellenos (servicios, género que pones
--      tú, su factura, saldo) y una sola fila aunque se guarde dos veces. Un
--      proveedor que no liquida, no.
--   2. Contraste: compras (la base de sus recepciones contra «compras
--      valoradas»), ventas por plataforma y producto a producto (casado una vez).
--   3. Confirmar: con bloqueos, no; sin ellos, su factura queda registrada y
--      aprobada, sus recepciones del mes cubiertas, y no se confirma dos veces.
--   4. Septiembre al céntimo: compra 3.587,15 al 4/10/21 % y 3.987,81;
--      ingreso 8.666,95 + 866,70 = 9.533,65 en el libro de expedidas con el
--      nº AF-02927; queda 5.545,84 a favor en su cuenta de cliente.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
create temp table _liq (que text primary key, id uuid) on commit drop;

-- ── 0 · Siembra: el socio, que liquida cada mes, y una recepción suya ──────
do $$
declare v_s uuid := 'c0f00000-0000-4000-8000-000000000001'; v_ses uuid;
begin
  insert into supplier (id, account_id, name, tax_id, invoicing_mode, created_by_name)
  values (v_s, 'c01a0000-0000-4000-8000-00000000000a', 'Marcas de Prueba, S.L.', 'B00000088', 'monthly_settlement', 'prueba');
  insert into supplier (id, account_id, name, invoicing_mode, created_by_name)
  values ('c0f00000-0000-4000-8000-000000000002', 'c01a0000-0000-4000-8000-00000000000a', 'Otro Que No Liquida', 'per_delivery', 'prueba');
  if not exists (select 1 from party_role where supplier_id = v_s) then raise exception 'PRUEBA liquidación · 0: el socio no tiene tercero.'; end if;
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          '{"document": {"doc_type": "albaran", "bill_to_name": "MARCAS DE PRUEBA SL", "tax_base_total": 100.00},
            "lines": [{"raw_text": "Barril", "line_amount": 100.00, "vat_pct": 10}]}'::jsonb, 'pending_review')
  returning id into v_ses;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, created_by_name)
  values ('c0f00000-0000-4000-8000-000000000101', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', v_s,
          'borrador', date '2026-09-15', v_ses, 'prueba');
  insert into goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values ('c01a0000-0000-4000-8000-00000000000a', 'c0f00000-0000-4000-8000-000000000101', 'Barril', 10, '7e000000-0000-4000-8000-000000000a01', 10, 10);
  perform confirm_goods_receipt('c0f00000-0000-4000-8000-000000000101');
  if (select path from goods_receipt_path where goods_receipt_id = 'c0f00000-0000-4000-8000-000000000101') <> 'liquidacion'
     or exists (select 1 from supplier_invoice where supplier_id = v_s) then
    raise exception 'PRUEBA liquidación · 0: la recepción del socio no va a su liquidación, o ha creado factura (§7.8).';
  end if;
  raise notice '0 · el socio liquida cada mes; su recepción del 15/09 va a su liquidación y no crea factura (§7.8)';
end $$;

-- ── 1 · Guardar ────────────────────────────────────────────────────────────
do $$
declare v_id uuid; v_id2 uuid; l licensed_settlement; v_lec jsonb := '{"emitida": {"numero": "AF-02927", "fecha": "2026-10-04", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "desde": {"nombre": "Taberna de Prueba Norte, S.L.", "nif": "B28000016"}, "a": {"nombre": "Marcas de Prueba, SL", "nif": "B00000088"}, "lineas": [{"concepto": "Servicio por Ventas Multimarcas", "base": 6746.87, "tipo": 10, "total": 7421.56}, {"concepto": "Servicio por Ventas con Reparto Propio", "base": 153.71, "tipo": 10, "total": 169.08}, {"concepto": "Mercaderías Aportadas por el Partner", "base": 1738.74, "tipo": 10, "total": 1912.61}, {"concepto": "Delivery fee Ventas con Reparto Propio", "base": 27.63, "tipo": 10, "total": 30.39}], "total": 9533.65}, "recibida": {"numero": "FV-02927", "fecha": "2026-10-04", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "desde": {"nombre": "Marcas de Prueba, SL", "nif": "B00000088"}, "a": {"nombre": "Taberna de Prueba Norte, S.L.", "nif": "B28000016"}, "lineas": [{"concepto": "Mercaderías en Stock", "base": 777.69, "tipo": 4, "total": 808.8}, {"concepto": "Mercaderías en Stock", "base": 2003.91, "tipo": 10, "total": 2204.3}, {"concepto": "Mercaderías en Stock", "base": 805.55, "tipo": 21, "total": 974.72}], "total": 3987.81}, "transaccion": {"fecha": "2026-10-04", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "lineas": [{"concepto": "Auto Factura AF-02927", "importe": 9533.65, "referencia": "AF-02927"}, {"concepto": "Factura Stock FV-02927", "importe": -3987.81, "referencia": "FV-02927"}, {"concepto": "Ventas Anticipadas en Efectivo", "importe": 0, "referencia": null}], "saldo": {"concepto": "Saldo a Ingresar", "importe": 5545.84}}, "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "bloqueos": [], "avisos": ["La factura que le haces suma 9.533,64 € por líneas y dice 9.533,65 €: 1 céntimo de redondeo del IVA. Manda el total.", "Su factura suma 3.987,82 € por líneas y dice 3.987,81 €: 1 céntimo de redondeo del IVA. Manda el total.", "«Ventas Anticipadas en Efectivo» viene a cero."], "ventas": {"referencia": "AF-02927", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "plataformas": [{"plataforma": "Glovo", "marcas": [], "totales": {"ventas": 120.0, "devoluciones": 0, "total": 120.0}, "reparto": []}, {"plataforma": "Uber", "marcas": [], "totales": {"ventas": 50.0, "devoluciones": 0, "total": 50.0}, "reparto": []}]}, "inventario": {"referencia": "AF-02927", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "repetidas": 0, "totalDocumento": null, "productos": [{"nombre": "Barril de Prueba", "precio": 0.6, "compras": 30, "unidad": "Uni", "consumo": -10, "saldo": 20, "total": 12.0}, {"nombre": "Salsa de Prueba", "precio": 5.35, "compras": 2, "unidad": "Kg", "consumo": -1, "saldo": 1, "total": 5.35}]}}'::jsonb;
begin
  v_id := public.compras_liquidacion_guardar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0f00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-0000000000a2', v_lec);
  v_id2 := public.compras_liquidacion_guardar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0f00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-0000000000a2', v_lec);
  select * into l from licensed_settlement where id = v_id;
  if v_id <> v_id2 or (l.service_revenue, l.materials_supplied, l.stock_invoice_cost, l.net_settlement, l.settlement_ref, l.status, l.period_from, l.period_to)
     is distinct from (6928.21::numeric, 1738.74::numeric, 3587.15::numeric, 5545.84::numeric, 'AF-02927', 'borrador', date '2026-09-01', date '2026-09-30') then
    raise exception 'PRUEBA liquidación · 1: lo guardado no es lo leído (% / % / % / % / % / %).', l.service_revenue, l.materials_supplied, l.stock_invoice_cost, l.net_settlement, l.settlement_ref, l.status;
  end if;
  begin
    perform public.compras_liquidacion_guardar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0f00000-0000-4000-8000-000000000002', 'c01a0000-0000-4000-8000-0000000000a2', v_lec);
    raise exception 'PRUEBA liquidación · 1: se ha guardado una liquidación de un proveedor que no liquida.';
  exception when sqlstate '22023' then null;
  end;
  insert into _liq values ('liq', v_id);
  raise notice '1 · guardada AF-02927: servicios 6.928,21 · género que pones tú 1.738,74 · su factura 3.587,15 · saldo 5.545,84 (una fila aunque se guarde dos veces)';
end $$;

-- ── 2 · Contraste ──────────────────────────────────────────────────────────
do $$
declare v jsonb; v_liq uuid := (select id from _liq where que = 'liq');
begin
  perform public.compras_liquidacion_casar_producto('c0f00000-0000-4000-8000-000000000001', 'Barril de Prueba', '7e000000-0000-4000-8000-000000000a01');
  v := public.compras_liquidacion_contraste(v_liq);
  if (v->'compras'->>'folvy')::numeric <> 100.00 or (v->'compras'->>'documento')::numeric <> 28.70 or (v->'compras'->>'diferencia')::numeric <> 71.30
     or (v->'compras'->>'recepciones')::int <> 1 then
    raise exception 'PRUEBA liquidación · 2: el contraste de compras no es el esperado (%).', v->'compras';
  end if;
  if jsonb_array_length(v->'ventas') <> 2 or (v->'ventas'->0->>'documento')::numeric <> 120.00 then
    raise exception 'PRUEBA liquidación · 2: el contraste de ventas no trae sus dos plataformas (%).', v->'ventas';
  end if;
  if (v->'productos'->>'casados')::int <> 1 or (v->'productos'->>'sin_casar')::int <> 1 then
    raise exception 'PRUEBA liquidación · 2: el casado por producto no se recuerda (%).', v->'productos';
  end if;
  raise notice '2 · contraste: compras %; ventas %; productos %', v->'compras', v->'ventas', v->'productos';
end $$;

-- ── 3 · Confirmar ──────────────────────────────────────────────────────────
do $$
declare v jsonb; v_liq uuid := (select id from _liq where que = 'liq'); v_mal uuid; f supplier_invoice;
begin
  -- Una con bloqueos no se confirma.
  v_mal := public.compras_liquidacion_guardar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c0f00000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-0000000000a2',
             jsonb_set(jsonb_set('{"emitida": {"numero": "AF-02927", "fecha": "2026-10-04", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "desde": {"nombre": "Taberna de Prueba Norte, S.L.", "nif": "B28000016"}, "a": {"nombre": "Marcas de Prueba, SL", "nif": "B00000088"}, "lineas": [{"concepto": "Servicio por Ventas Multimarcas", "base": 6746.87, "tipo": 10, "total": 7421.56}, {"concepto": "Servicio por Ventas con Reparto Propio", "base": 153.71, "tipo": 10, "total": 169.08}, {"concepto": "Mercaderías Aportadas por el Partner", "base": 1738.74, "tipo": 10, "total": 1912.61}, {"concepto": "Delivery fee Ventas con Reparto Propio", "base": 27.63, "tipo": 10, "total": 30.39}], "total": 9533.65}, "recibida": {"numero": "FV-02927", "fecha": "2026-10-04", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "desde": {"nombre": "Marcas de Prueba, SL", "nif": "B00000088"}, "a": {"nombre": "Taberna de Prueba Norte, S.L.", "nif": "B28000016"}, "lineas": [{"concepto": "Mercaderías en Stock", "base": 777.69, "tipo": 4, "total": 808.8}, {"concepto": "Mercaderías en Stock", "base": 2003.91, "tipo": 10, "total": 2204.3}, {"concepto": "Mercaderías en Stock", "base": 805.55, "tipo": 21, "total": 974.72}], "total": 3987.81}, "transaccion": {"fecha": "2026-10-04", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "lineas": [{"concepto": "Auto Factura AF-02927", "importe": 9533.65, "referencia": "AF-02927"}, {"concepto": "Factura Stock FV-02927", "importe": -3987.81, "referencia": "FV-02927"}, {"concepto": "Ventas Anticipadas en Efectivo", "importe": 0, "referencia": null}], "saldo": {"concepto": "Saldo a Ingresar", "importe": 5545.84}}, "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "bloqueos": [], "avisos": ["La factura que le haces suma 9.533,64 € por líneas y dice 9.533,65 €: 1 céntimo de redondeo del IVA. Manda el total.", "Su factura suma 3.987,82 € por líneas y dice 3.987,81 €: 1 céntimo de redondeo del IVA. Manda el total.", "«Ventas Anticipadas en Efectivo» viene a cero."], "ventas": {"referencia": "AF-02927", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "plataformas": [{"plataforma": "Glovo", "marcas": [], "totales": {"ventas": 120.0, "devoluciones": 0, "total": 120.0}, "reparto": []}, {"plataforma": "Uber", "marcas": [], "totales": {"ventas": 50.0, "devoluciones": 0, "total": 50.0}, "reparto": []}]}, "inventario": {"referencia": "AF-02927", "periodo": {"desde": "2026-09-01", "hasta": "2026-09-30"}, "repetidas": 0, "totalDocumento": null, "productos": [{"nombre": "Barril de Prueba", "precio": 0.6, "compras": 30, "unidad": "Uni", "consumo": -10, "saldo": 20, "total": 12.0}, {"nombre": "Salsa de Prueba", "precio": 5.35, "compras": 2, "unidad": "Kg", "consumo": -1, "saldo": 1, "total": 5.35}]}}'::jsonb, '{emitida,numero}', '"AF-99999"'), '{bloqueos}', '["«Ventas Anticipadas en Efectivo» trae 12,00 € y Folvy no sabe qué es."]'));
  begin
    perform public.compras_liquidacion_confirmar(v_mal);
    raise exception 'PRUEBA liquidación · 3: se ha confirmado una liquidación con bloqueos.';
  exception when sqlstate '22023' then null;
  end;
  v := public.compras_liquidacion_confirmar(v_liq);
  select * into f from supplier_invoice where id = (v->>'factura')::uuid;
  if f.status <> 'aprobada' or f.invoice_number <> 'FV-02927' or f.grand_total <> 3987.81 or f.tax_base_total <> 3587.15
     or (select count(*) from supplier_invoice_line where supplier_invoice_id = f.id) <> 3
     or (select status from licensed_settlement where id = v_liq) <> 'confirmada'
     or (select consumed_at from goods_receipt_path where goods_receipt_id = 'c0f00000-0000-4000-8000-000000000101') is null then
    raise exception 'PRUEBA liquidación · 3: confirmar no ha dejado su factura, el estado o la recepción como debía (%).', v;
  end if;
  begin
    perform public.compras_liquidacion_confirmar(v_liq);
    raise exception 'PRUEBA liquidación · 3: se ha confirmado dos veces.';
  exception when sqlstate '22023' then null;
  end;
  insert into _liq values ('fv', f.id);
  raise notice '3 · «%»', v->>'frase';
end $$;

-- ── 4 · Septiembre al céntimo: los tres asientos, propuestos y validados ───
do $$
declare
  v_liq uuid := (select id from _liq where que = 'liq'); v_fv uuid := (select id from _liq where que = 'fv');
  v_party uuid := (select party_id from party_role where supplier_id = 'c0f00000-0000-4000-8000-000000000001');
  a jsonb; r jsonb; v_ids uuid[] := '{}'; v_src uuid; e text; v_430 numeric; v_400 numeric;
begin
  for a in select * from jsonb_array_elements('[{"serie": 2, "fecha": "2026-10-04", "concepto": "Factura Marcas de Prueba · FV-02927", "source_type": "supplier_invoice", "confianza": "probable", "porque": "Lo que te factura cada mes: compra, con su IVA por tipo, a su cuenta de proveedor.", "documento": "FV-02927", "lineas": [{"cuenta": "60000000", "debe": 3587.15, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "FV-02927", "iva": null}, {"cuenta": "47200004", "debe": 31.11, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "FV-02927", "iva": {"tipo_id": "b8bddc11-51a0-48a6-9bef-5686b2345337", "base": 777.69, "libro": "received", "deducible": "yes", "facturas": 1}}, {"cuenta": "47200010", "debe": 200.39, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "FV-02927", "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 2003.91, "libro": "received", "deducible": "yes", "facturas": 1}}, {"cuenta": "47200021", "debe": 169.16, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "FV-02927", "iva": {"tipo_id": "28f9a398-2c95-4a3c-aebe-66d8cf37154f", "base": 805.55, "libro": "received", "deducible": "yes", "facturas": 1}}, {"cuenta": "40000000", "debe": 0, "haber": 3987.81, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "FV-02927", "iva": null}]}, {"serie": 4, "fecha": "2026-10-04", "concepto": "Le facturas a Marcas de Prueba · AF-02927", "source_type": "licensed_settlement", "confianza": "seguro", "porque": "La factura que le haces (la extiende él en tu nombre): ingreso con su IVA, a su cuenta de cliente, con su número en el libro de expedidas.", "documento": "AF-02927", "lineas": [{"cuenta": "43000000", "debe": 9533.65, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "AF-02927", "iva": null}, {"cuenta": "70500000", "debe": 0, "haber": 6928.21, "concepto": "Servicios por sus ventas", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "AF-02927", "iva": null}, {"cuenta": "70000000", "debe": 0, "haber": 1738.74, "concepto": "Género que le pones tú", "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "AF-02927", "iva": null}, {"cuenta": "47700010", "debe": 0, "haber": 866.7, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "AF-02927", "iva": {"tipo_id": "5bbab66f-a022-44a6-b146-ac577a2988d3", "base": 8666.95, "libro": "issued", "deducible": null, "facturas": 1}}]}, {"serie": 4, "fecha": "2026-10-04", "concepto": "Compensación con Marcas de Prueba · AF-02927 y FV-02927", "source_type": "supplier_payment", "confianza": "seguro", "porque": "Su factura se paga con lo que te debe. Te paga 5.545,84 €: es lo que queda en su cuenta de cliente, y llega por el banco.", "documento": null, "lineas": [{"cuenta": "40000000", "debe": 3987.81, "haber": 0, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "FV-02927", "iva": null}, {"cuenta": "43000000", "debe": 0, "haber": 3987.81, "concepto": null, "local_id": "c01a0000-0000-4000-8000-0000000000a2", "comun": false, "documento": "AF-02927", "iva": null}]}]'::jsonb) loop
    v_src := case a->>'source_type' when 'licensed_settlement' then v_liq else v_fv end;
    r := public.journal_entry_proponer('3b34403a-a7d6-4a48-a8d7-737e8cababdc',
           jsonb_build_object('series', a->'serie', 'fecha', a->'fecha', 'concepto', a->'concepto', 'source_type', a->'source_type', 'source_id', v_src,
                              'confianza', a->'confianza', 'porque', a->'porque', 'razones', '[]'::jsonb, 'party_id', v_party, 'documento', a->'documento'),
           a->'lineas', null, 'Prueba');
    if r->>'id' is null then raise exception 'PRUEBA liquidación · 4: no se ha propuesto «%» (%).', a->>'concepto', r; end if;
    perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba');
    v_ids := v_ids || (r->>'id')::uuid;
  end loop;
  -- El libro de expedidas: AF-02927, 8.666,95 + 866,70 = 9.533,65.
  select string_agg(format('%s %s %s+%s=%s', book, number, tax_base, tax_amount, total), ' · ' order by book, tax_rate) into e
    from vat_book_entry where entry_id = any(v_ids) and voided_at is null;
  if not exists (select 1 from vat_book_entry where entry_id = any(v_ids) and book = 'issued' and number = 'AF-02927'
                   and tax_base = 8666.95 and tax_rate = 10 and tax_amount = 866.70 and total = 9533.65) then
    raise exception 'PRUEBA liquidación · 4: el libro de expedidas no tiene AF-02927 al céntimo: %', e;
  end if;
  if (select sum(tax_base) from vat_book_entry where entry_id = any(v_ids) and book = 'received') <> 3587.15
     or (select sum(total) from vat_book_entry where entry_id = any(v_ids) and book = 'received') <> 3987.81
     or (select count(*) from vat_book_entry where entry_id = any(v_ids) and book = 'received' and number = 'FV-02927') <> 3 then
    raise exception 'PRUEBA liquidación · 4: el libro de recibidas no da 3.587,15 / 3.987,81 con FV-02927: %', e;
  end if;
  select sum(l.debit - l.credit) filter (where ca.code = '43000000'), sum(l.debit - l.credit) filter (where ca.code = '40000000')
    into v_430, v_400 from journal_line l join company_account ca on ca.id = l.company_account_id where l.entry_id = any(v_ids);
  if v_430 <> 5545.84 or v_400 <> 0 then
    raise exception 'PRUEBA liquidación · 4: queda % en su cuenta de cliente y % en la de proveedor (esperaba 5.545,84 y 0).', v_430, v_400;
  end if;
  raise notice '4 · §7.5 septiembre al céntimo, validado: % · su cuenta de cliente %, la de proveedor %', e, v_430, v_400;
end $$;

rollback;
