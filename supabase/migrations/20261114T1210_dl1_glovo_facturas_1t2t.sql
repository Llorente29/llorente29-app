-- supabase/migrations/20261114T1210_dl1_glovo_facturas_1t2t.sql
--
-- DL1·26, punto 2 · Glovo: las facturas de comisión del 1T y el 2T que no están
-- en los libros, a 01/10 con su periodo en el concepto (Julio, 13/11). Nada en
-- el camino del pedido. Cifras de los PDF del zip de liquidaciones de Glovo.
--   - Las 5 de marzo de Alcalá (777,75).
--   - Las 14 de 12,10 y 10,81 de la tienda de Vallecas, de marzo a mayo, y sus
--     4 notas de crédito de 12,10 del 01/06, que tampoco están.
--   - Las 16 del 1–15/06 que solo están como venta (las otras 2 de ese tramo, la
--     233690 y la 254737, ya tienen su factura).
-- Cada una: su factura (aprobada), su asiento (62300001 y el IVA soportado a la
-- 47200021, que entra en el 4T) y su compensación con lo que Glovo debe
-- (41000002 contra 43000001), todo a 01/10. Validado como Julio. Sus PDF los
-- sube Julio: por SQL no se puede.
-- Las ventas de marzo NO van aquí: no se pueden separar con certeza (ver el PR).
--
-- sin hueco: no retira ningún asiento ni resumen del día; solo añade facturas y asientos.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_glovo constant uuid := '720afecb-a89b-4ca9-a249-f11dcb451c38';
  v_prov constant uuid := '1311a14f-996e-4a3b-af02-e51f5000a8fa';
  v_t21 constant uuid := '36887d70-bcc4-4590-94ea-331213f90da3';
  r record; v_inv uuid; v_id uuid; v_res jsonb; v_ids jsonb := '[]'::jsonb; v_n int; v_abono boolean; v_k int := 0;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Glovo facturas 1T/2T: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  perform set_config('s01i.sin_buscar', 'si', true);
  for r in select * from (values
      ('200022764059', date '2026-03-15', '01/03–15/03/2026', 33.98, 7.14, 41.12, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('200172745966', date '2026-03-15', '01/03–15/03/2026', 206.48, 43.37, 249.85, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('200212774810', date '2026-03-15', '01/03–15/03/2026', 86.81, 18.23, 105.04, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('200520988958', date '2026-03-15', '01/03–15/03/2026', 177.19, 37.21, 214.4, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('200520989047', date '2026-03-15', '01/03–15/03/2026', 138.29, 29.05, 167.34, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000067714', date '2026-03-31', '16/03–31/03/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000082245', date '2026-04-15', '01/04–15/04/2026', 8.93, 1.88, 10.81, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000117056', date '2026-04-30', '16/04–30/04/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000121190', date '2026-04-30', '16/04–30/04/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000143776', date '2026-04-30', '16/04–30/04/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000145733', date '2026-04-30', '16/04–30/04/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000153232', date '2026-05-15', '01/05–15/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000159928', date '2026-05-15', '01/05–15/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000179687', date '2026-05-15', '01/05–15/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000182979', date '2026-05-15', '01/05–15/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000201893', date '2026-05-31', '16/05–31/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000210590', date '2026-05-31', '16/05–31/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000222474', date '2026-05-31', '16/05–31/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000226180', date '2026-05-31', '16/05–31/05/2026', 10.0, 2.1, 12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('C170326100002853', date '2026-07-10', '01/06/2026', -10.0, -2.1, -12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('C170326100004265', date '2026-07-10', '01/06/2026', -10.0, -2.1, -12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('C170326100015712', date '2026-07-10', '01/06/2026', -10.0, -2.1, -12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('C170326100017723', date '2026-07-10', '01/06/2026', -10.0, -2.1, -12.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000235906', date '2026-06-15', '01/06–15/06/2026', 449.75, 94.45, 544.2, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000236646', date '2026-06-15', '01/06–15/06/2026', 23.48, 4.94, 28.42, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000237846', date '2026-06-15', '01/06–15/06/2026', 5.04, 1.06, 6.1, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000238033', date '2026-06-15', '01/06–15/06/2026', 238.45, 50.08, 288.53, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000238173', date '2026-06-15', '01/06–15/06/2026', 171.88, 36.09, 207.97, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000239801', date '2026-06-15', '01/06–15/06/2026', 60.82, 12.77, 73.59, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000240862', date '2026-06-15', '01/06–15/06/2026', 20.85, 4.38, 25.23, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000242509', date '2026-06-15', '01/06–15/06/2026', 28.86, 6.06, 34.92, '629f9154-b888-48ed-9b8c-ffae77620615'::uuid),
      ('I170326000243469', date '2026-06-15', '01/06–15/06/2026', 78.95, 16.58, 95.53, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000245703', date '2026-06-15', '01/06–15/06/2026', 315.13, 66.18, 381.31, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000245934', date '2026-06-15', '01/06–15/06/2026', 25.57, 5.37, 30.94, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000248661', date '2026-06-15', '01/06–15/06/2026', 42.88, 9.01, 51.89, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000250366', date '2026-06-15', '01/06–15/06/2026', 14.76, 3.1, 17.86, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000250861', date '2026-06-15', '01/06–15/06/2026', 133.65, 28.07, 161.72, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000253888', date '2026-06-15', '01/06–15/06/2026', 304.77, 64.0, 368.77, '38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000264293', date '2026-06-15', '01/06–15/06/2026', 50.77, 10.66, 61.43, '38158159-cd71-4056-950b-53425afac1ce'::uuid)
    ) x(num, fecha, periodo, base, iva, total, loc) loop
    v_k := v_k + 1;
    v_abono := r.total < 0;
    if r.base + r.iva <> r.total then raise exception 'DL1 Glovo facturas 1T/2T: la % no suma (% + % <> %).', r.num, r.base, r.iva, r.total; end if;
    if exists (select 1 from public.supplier_invoice s where s.account_id = v_acc and s.invoice_number = r.num and s.status not in ('anulada', 'descartada'))
       or exists (select 1 from public.journal_entry j where j.company_id = v_e and j.status <> 'anulado' and j.series in (2, 4) and j.concept like '%' || r.num || '%') then
      raise exception 'DL1 Glovo facturas 1T/2T: la % ya está (factura o asiento): no se apunta nada.', r.num;
    end if;
    begin
    insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, status, source,
                                         arrival_channel, tax_base_total, tax_total, grand_total, needs_review, notes, approved_at, approved_by_name, created_by_name)
    values (v_acc, v_e, v_prov, r.loc, case when v_abono then 'credit_note' else 'invoice' end, r.num, r.fecha, 'aprobada', 'manual', 'portal',
            r.base, r.iva, r.total, false, 'DL1·26: ' || case when v_abono then 'nota de crédito' else 'factura de comisión' end || ' de Glovo del ' || r.periodo
            || ', del zip de liquidaciones de Glovo; se apunta a 01/10 (el 1T y el 2T están presentados).', now(), 'Julio (tanda DL1)', 'Julio (tanda DL1)')
    returning id into v_inv;
    exception when others then raise exception using errcode = 'DGA01', message = sqlerrm; end;
    begin
    insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
    values (v_inv, 'Servicios de la plataforma de Glovo (' || r.periodo || ')', 1, r.base, r.base, 21, '62300001', 1);
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
    values (v_acc, v_inv, v_t21, 21, r.base, r.iva);
    exception when others then raise exception using errcode = 'DGB01', message = sqlerrm; end;
    begin
    v_res := public._journal_entry_proponer(v_e,
      jsonb_build_object('series', 2, 'fecha', '2026-10-01', 'concepto', 'Factura GLOVOAPP SPAIN PLATFORM · ' || r.num || ' (' || r.periodo || ')',
        'source_type', 'supplier_invoice', 'source_id', v_inv, 'confianza', 'seguro',
        'porque', 'DL1·26 (Julio, 13/11): ' || case when v_abono then 'nota de crédito' else 'factura de comisión' end || ' de Glovo del ' || r.periodo
          || ' que no estaba en los libros; a 01/10 porque el trimestre está presentado.',
        'razones', '[]'::jsonb, 'party_id', v_glovo, 'documento', r.num),
      case when v_abono then jsonb_build_array(
        jsonb_build_object('cuenta', '41000002', 'debe', -r.total, 'haber', 0, 'local_id', r.loc, 'comun', false, 'tercero_id', v_glovo, 'documento', r.num),
        jsonb_build_object('cuenta', '62300001', 'debe', 0, 'haber', -r.base, 'local_id', r.loc, 'comun', false),
        jsonb_build_object('cuenta', '47200021', 'debe', 0, 'haber', -r.iva, 'local_id', r.loc, 'comun', false,
          'iva', jsonb_build_object('tipo_id', v_t21, 'base', r.base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)))
      else jsonb_build_array(
        jsonb_build_object('cuenta', '62300001', 'debe', r.base, 'haber', 0, 'local_id', r.loc, 'comun', false),
        jsonb_build_object('cuenta', '47200021', 'debe', r.iva, 'haber', 0, 'local_id', r.loc, 'comun', false,
          'iva', jsonb_build_object('tipo_id', v_t21, 'base', r.base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
        jsonb_build_object('cuenta', '41000002', 'debe', 0, 'haber', r.total, 'local_id', r.loc, 'comun', false, 'tercero_id', v_glovo, 'documento', r.num)) end,
      null, 'Julio (tanda DL1)', null);
    exception when others then raise exception using errcode = 'DGC01', message = sqlerrm; end;
    v_id := (v_res->>'id')::uuid;
    if v_id is null or coalesce((v_res->>'existente')::boolean, false) then
      raise exception using errcode = format('DG%s', lpad(v_k::text, 3, '0')), message = format('DL1 Glovo facturas 1T/2T: el asiento de la %s no ha salido nuevo (%s).', r.num, v_res);
    end if;
    update public.supplier_invoice set journal_entry_id = v_id, updated_at = now() where id = v_inv;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', abs(r.total));
    -- Su compensación con lo que Glovo debe.
    begin
    v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
      'Glovo · ' || r.num || ' (' || r.periodo || ') compensada con lo que Glovo debe',
      'DL1·26 (Julio, 13/11): Glovo la descontó de su liquidación; a 01/10 porque el trimestre está presentado.',
      case when v_abono then jsonb_build_array(
        jsonb_build_object('cuenta', '43000001', 'debe', -r.total, 'tercero', v_glovo, 'local', r.loc),
        jsonb_build_object('cuenta', '41000002', 'haber', -r.total, 'tercero', v_glovo, 'local', r.loc, 'documento', r.num))
      else jsonb_build_array(
        jsonb_build_object('cuenta', '41000002', 'debe', r.total, 'tercero', v_glovo, 'local', r.loc, 'documento', r.num),
        jsonb_build_object('cuenta', '43000001', 'haber', r.total, 'tercero', v_glovo, 'local', r.loc)) end);
    exception when others then raise exception using errcode = 'DGD01', message = sqlerrm; end;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', abs(r.total));
  end loop;
  if v_k <> 39 then raise exception 'DL1 Glovo facturas 1T/2T: % documentos, no 39.', v_k; end if;
  -- Uno a uno, con su código: F + su número (2 cifras) + las 2 primeras del error.
  v_n := 0;
  for v_k in 0 .. jsonb_array_length(v_ids) - 1 loop
    begin
      v_n := v_n + public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(v_ids->v_k));
    exception when others then
      raise exception using errcode = format('F%s%s', lpad(((v_k % 100) + 0)::text, 2, '0'), left(sqlstate, 2)), message = sqlerrm;
    end;
  end loop;
  raise notice 'DL1 Glovo facturas 1T/2T: % asientos validados como Julio.', v_n;
end $$;
