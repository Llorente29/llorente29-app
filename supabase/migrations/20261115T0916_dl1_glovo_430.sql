-- supabase/migrations/20261115T0916_dl1_glovo_430.sql
--
-- DL1 · la 43000001 (Glovo) de 2026, conciliada liquidación a liquidación con el
-- zip de liquidaciones de Glovo (01/03–31/10). Decisiones de Julio del 15/11, 09:14:
-- A1, A2 y A3 aprobados; las ventas de A1 a la 70000000; el IVA al 4T. Los 1.914,12
-- cobrados en la ···2149 quedan pendientes y no van. Todo a 01/10 (el 1T y el 2T
-- están presentados), con el periodo real en el concepto, para que viaje a Diez con
-- el traspaso de octubre. Nada en el camino del pedido.
--   A1. Las ventas que no estaban: las 33 liquidaciones con venta de marzo, la
--       I170326000082245 (01–15/04) y la I170326000288972 (16–30/06). La venta es lo
--       cobrado más la comisión menos la deuda (el IVA del 10 % va dentro): Debe
--       43000001 / Haber 70000000 y 47700010. 17.683,99 (base 16.076,36, IVA 1.607,63).
--   A2. 28 facturas de comisión que se apuntaron al revés, con su compensación (por
--       ejemplo 2/689 y 4/1832): se corrigen por el doble, Debe 62300001 y 47200021 /
--       Haber 43000001. 2.803,12 (base 2.316,60, IVA 486,52).
--   A3. Las 13 compensaciones del 16–30/06 que faltaban (Debe 41000002 / Haber
--       43000001, 1.516,29) y las 4 facturas de comisión de ese tramo que no estaban
--       (I170326000269215, 269904, 292850 y 295313: base 218,72, IVA 45,93).
-- Con esto la 43000001 a 31/10 sube 13.364,58. Validado como Julio. Los PDF de las 4
-- facturas los sube Julio (están en el zip).
--
-- sin hueco: no retira ningún asiento ni resumen del día; solo añade asientos y 4 facturas.
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
  v_t10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';
  v_t21 constant uuid := '36887d70-bcc4-4590-94ea-331213f90da3';
  r record; v_id uuid; v_inv uuid; v_res jsonb; v_ids jsonb := '[]'::jsonb; v_n int := 0; v_k int := 0; v_tot numeric;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Glovo 430: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  perform set_config('s01i.sin_buscar', 'si', true);
  if exists (select 1 from public.journal_entry e where e.company_id = v_e and e.status <> 'anulado'
              and (e.concept like 'Ventas Glovo % · regularización de la 43000001%' or e.concept like 'Glovo % · factura y compensación al revés%'
                   or e.concept like 'Compensación Glovo que faltaba · %' or e.concept like 'Factura Glovo que faltaba · %')) then
    raise exception 'DL1 Glovo 430: ya hay asientos de esta conciliación: no se apunta nada.';
  end if;

  -- A1. Las ventas.
  for r in select * from (values
      ('200012796138','01/03–15/03/2026',67.1,61.0,6.1),
      ('200022763781','01/03–15/03/2026',514.48,467.71,46.77),
      ('200022764059','01/03–15/03/2026',43.6,39.64,3.96),
      ('200172745966','01/03–15/03/2026',181.91,165.37,16.54),
      ('200212774656','01/03–15/03/2026',1293.95,1176.32,117.63),
      ('200212774783','01/03–15/03/2026',649.13,590.12,59.01),
      ('200242742152','01/03–15/03/2026',804.9,731.73,73.17),
      ('200372766317','01/03–15/03/2026',594.1,540.09,54.01),
      ('200491003803','01/03–15/03/2026',99.55,90.5,9.05),
      ('200520988958','01/03–15/03/2026',195.66,177.87,17.79),
      ('200520989047','01/03–15/03/2026',179.26,162.96,16.3),
      ('200520989092','01/03–15/03/2026',93.0,84.55,8.45),
      ('200640939734','01/03–15/03/2026',426.5,387.73,38.77),
      ('200720960755','01/03–15/03/2026',1136.46,1033.15,103.31),
      ('200730958305','01/03–15/03/2026',327.64,297.85,29.79),
      ('200790917959','01/03–15/03/2026',1803.1,1639.18,163.92),
      ('I170326000042699','16/03–31/03/2026',983.31,893.92,89.39),
      ('I170326000050690','16/03–31/03/2026',231.46,210.42,21.04),
      ('I170326000072280','16/03–31/03/2026',31.3,28.45,2.85),
      ('I170326000069211','16/03–31/03/2026',171.75,156.14,15.61),
      ('I170326000049466','16/03–31/03/2026',632.08,574.62,57.46),
      ('I170326000049693','16/03–31/03/2026',76.55,69.59,6.96),
      ('I170326000046451','16/03–31/03/2026',335.2,304.73,30.47),
      ('I170326000066984','16/03–31/03/2026',455.2,413.82,41.38),
      ('I170326000056506','16/03–31/03/2026',14.3,13.0,1.3),
      ('I170326000062783','16/03–31/03/2026',177.94,161.76,16.18),
      ('I170326000074625','16/03–31/03/2026',1910.8,1737.09,173.71),
      ('I170326000074676','16/03–31/03/2026',1635.47,1486.79,148.68),
      ('I170326000044639','16/03–31/03/2026',443.85,403.5,40.35),
      ('I170326000054703','16/03–31/03/2026',356.15,323.77,32.38),
      ('I170326000059223','16/03–31/03/2026',367.8,334.36,33.44),
      ('I170326000059298','16/03–31/03/2026',234.26,212.96,21.3),
      ('I170326000059491','16/03–31/03/2026',1193.83,1085.3,108.53),
      ('I170326000082245','01/04–15/04/2026',27.3,24.82,2.48),
      ('I170326000288972','16/06–30/06/2026',-4.9,-4.45,-0.45)
    ) x(num, periodo, venta, base, iva) loop
    v_k := v_k + 1;
    begin
      v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 1,
        'Ventas Glovo ' || r.num || ' (' || r.periodo || ') · regularización de la 43000001 a 01/10, el trimestre está presentado',
        'DL1, conciliación de la 43000001 con el zip de Glovo (Julio, 15/11): la venta de esta liquidación (lo cobrado más la comisión menos la deuda) no estaba en los libros.',
        case when r.venta > 0 then jsonb_build_array(
          jsonb_build_object('cuenta', '43000001', 'debe', r.venta, 'tercero', v_glovo, 'documento', r.num),
          jsonb_build_object('cuenta', '70000000', 'haber', r.base),
          jsonb_build_object('cuenta', '47700010', 'haber', r.iva, 'iva', jsonb_build_object('tipo', v_t10, 'base', r.base, 'libro', 'issued')))
        else jsonb_build_array(
          jsonb_build_object('cuenta', '70000000', 'debe', -r.base),
          jsonb_build_object('cuenta', '47700010', 'debe', -r.iva, 'iva', jsonb_build_object('tipo', v_t10, 'base', -r.base, 'libro', 'issued')),
          jsonb_build_object('cuenta', '43000001', 'haber', -r.venta, 'tercero', v_glovo, 'documento', r.num)) end);
    exception when others then raise exception using errcode = format('A%s%s', lpad(v_k::text, 2, '0'), left(sqlstate, 2)), message = format('%s: %s', r.num, sqlerrm); end;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', abs(r.venta));
  end loop;
  if v_k <> 35 then raise exception 'DL1 Glovo 430: % ventas, no 35.', v_k; end if;

  -- A2. Las facturas al revés: el doble, al lado bueno.
  v_k := 0;
  for r in select * from (values
      ('200491003803','01/03–15/03/2026',31.28,6.58,37.86),
      ('200640939734','01/03–15/03/2026',211.96,44.51,256.47),
      ('I170326000042827','16/03–31/03/2026',10.0,2.1,12.1),
      ('I170326000056852','16/03–31/03/2026',169.63,35.62,205.25),
      ('I170326000047591','16/03–31/03/2026',68.82,14.45,83.27),
      ('I170326000059298','16/03–31/03/2026',168.96,35.48,204.44),
      ('I170326000094345','01/04–15/04/2026',3.41,0.72,4.13),
      ('I170326000109680','01/04–15/04/2026',29.07,6.11,35.18),
      ('I170326000117675','16/04–30/04/2026',14.97,3.15,18.12),
      ('I170326000114816','16/04–30/04/2026',10.0,2.1,12.1),
      ('I170326000121169','16/04–30/04/2026',10.0,2.1,12.1),
      ('I170326000132360','16/04–30/04/2026',10.0,2.1,12.1),
      ('I170326000130321','16/04–30/04/2026',7.91,1.66,9.57),
      ('I170326000126859','16/04–30/04/2026',19.71,4.14,23.85),
      ('I170326000118258','16/04–30/04/2026',10.0,2.1,12.1),
      ('I170326000135315','16/04–30/04/2026',9.0,1.89,10.89),
      ('I170326000183865','01/05–15/05/2026',10.0,2.1,12.1),
      ('I170326000165872','01/05–15/05/2026',10.0,2.1,12.1),
      ('I170326000161639','01/05–15/05/2026',10.0,2.1,12.1),
      ('I170326000174808','01/05–15/05/2026',10.0,2.1,12.1),
      ('I170326000154703','01/05–15/05/2026',10.0,2.1,12.1),
      ('I170326000154822','01/05–15/05/2026',16.3,3.42,19.72),
      ('I170326000225295','16/05–31/05/2026',10.0,2.1,12.1),
      ('I170326000198967','16/05–31/05/2026',10.0,2.1,12.1),
      ('I170326000215779','16/05–31/05/2026',13.71,2.88,16.59),
      ('I170326000210549','16/05–31/05/2026',10.0,2.1,12.1),
      ('I170326000213060','16/05–31/05/2026',10.0,2.1,12.1),
      ('I170326000206195','16/05–31/05/2026',253.57,53.25,306.82)
    ) x(num, periodo, base, iva, total) loop
    v_k := v_k + 1;
    begin
      v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
        'Glovo ' || r.num || ' (' || r.periodo || ') · factura y compensación al revés, corregidas por el doble a 01/10',
        'DL1, conciliación de la 43000001 con el zip de Glovo (Julio, 15/11): su factura de comisión se apuntó como un abono y su compensación también; esto las deja como dice el PDF.',
        jsonb_build_array(
          jsonb_build_object('cuenta', '62300001', 'debe', 2 * r.base),
          jsonb_build_object('cuenta', '47200021', 'debe', 2 * r.iva, 'tercero', v_glovo, 'documento', r.num,
            'iva', jsonb_build_object('tipo', v_t21, 'base', 2 * r.base, 'libro', 'received')),
          jsonb_build_object('cuenta', '43000001', 'haber', 2 * r.total, 'tercero', v_glovo, 'documento', r.num)));
    exception when others then raise exception using errcode = format('B%s%s', lpad(v_k::text, 2, '0'), left(sqlstate, 2)), message = format('%s: %s', r.num, sqlerrm); end;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 2 * r.total);
  end loop;
  if v_k <> 28 then raise exception 'DL1 Glovo 430: % facturas al revés, no 28.', v_k; end if;

  -- A3. Las 13 compensaciones del 16–30/06 y las 4 facturas que faltaban.
  v_k := 0;
  for r in select * from (values
      ('I170326000275618','16/06–30/06/2026',date '2026-06-30',212.66,44.66,257.32,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000272395','16/06–30/06/2026',date '2026-06-30',42.92,9.02,51.94,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000272679','16/06–30/06/2026',date '2026-06-30',10.39,2.19,12.58,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000283983','16/06–30/06/2026',date '2026-06-30',60.14,12.63,72.77,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000298121','16/06–30/06/2026',date '2026-06-30',104.17,21.88,126.05,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000294452','16/06–30/06/2026',date '2026-06-30',157.98,33.18,191.16,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000283156','16/06–30/06/2026',date '2026-06-30',161.23,33.87,195.1,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000288972','16/06–30/06/2026',date '2026-06-30',4.52,0.95,5.47,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000269904','16/06–30/06/2026',date '2026-06-30',5.24,1.1,6.34,true,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000292850','16/06–30/06/2026',date '2026-06-30',2.09,0.44,2.53,true,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000269215','16/06–30/06/2026',date '2026-06-30',134.52,28.24,162.76,true,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000269268','16/06–30/06/2026',date '2026-06-30',280.37,58.88,339.25,false,'38158159-cd71-4056-950b-53425afac1ce'::uuid),
      ('I170326000295313','16/06–30/06/2026',date '2026-06-30',76.87,16.15,93.02,true,'38158159-cd71-4056-950b-53425afac1ce'::uuid)
    ) x(num, periodo, fecha, base, iva, total, sin_factura, loc) loop
    v_k := v_k + 1;
    if r.sin_factura then
      if exists (select 1 from public.supplier_invoice s where s.account_id = v_acc and s.invoice_number = r.num and s.status not in ('anulada', 'descartada')) then
        raise exception 'DL1 Glovo 430: la factura % ya está: no se apunta nada.', r.num;
      end if;
      begin
        insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, status, source,
                                             arrival_channel, tax_base_total, tax_total, grand_total, needs_review, notes, approved_at, approved_by_name, created_by_name)
        values (v_acc, v_e, v_prov, r.loc, 'invoice', r.num, r.fecha, 'aprobada', 'manual', 'portal', r.base, r.iva, r.total, false,
                'DL1: factura de comisión de Glovo del ' || r.periodo || ', del zip de liquidaciones de Glovo; se apunta a 01/10 (el 2T está presentado).',
                now(), 'Julio (tanda DL1)', 'Julio (tanda DL1)')
        returning id into v_inv;
        insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
        values (v_inv, 'Servicios de la plataforma de Glovo (' || r.periodo || ')', 1, r.base, r.base, 21, '62300001', 1);
        insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
        values (v_acc, v_inv, v_t21, 21, r.base, r.iva);
        v_res := public._journal_entry_proponer(v_e,
          jsonb_build_object('series', 2, 'fecha', '2026-10-01', 'concepto', 'Factura Glovo que faltaba · ' || r.num || ' (' || r.periodo || ')',
            'source_type', 'supplier_invoice', 'source_id', v_inv, 'confianza', 'seguro',
            'porque', 'DL1, conciliación de la 43000001 con el zip de Glovo (Julio, 15/11): factura de comisión del ' || r.periodo || ' que no estaba; a 01/10 porque el 2T está presentado.',
            'razones', '[]'::jsonb, 'party_id', v_glovo, 'documento', r.num),
          jsonb_build_array(
            jsonb_build_object('cuenta', '62300001', 'debe', r.base, 'haber', 0, 'local_id', r.loc, 'comun', false),
            jsonb_build_object('cuenta', '47200021', 'debe', r.iva, 'haber', 0, 'local_id', r.loc, 'comun', false,
              'iva', jsonb_build_object('tipo_id', v_t21, 'base', r.base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
            jsonb_build_object('cuenta', '41000002', 'debe', 0, 'haber', r.total, 'local_id', r.loc, 'comun', false, 'tercero_id', v_glovo, 'documento', r.num)),
          null, 'Julio (tanda DL1)', null);
        v_id := (v_res->>'id')::uuid;
        if v_id is null or coalesce((v_res->>'existente')::boolean, false) then raise exception 'el asiento de la factura no ha salido nuevo (%)', v_res; end if;
        update public.supplier_invoice set journal_entry_id = v_id, updated_at = now() where id = v_inv;
      exception when others then raise exception using errcode = format('C%s%s', lpad(v_k::text, 2, '0'), left(sqlstate, 2)), message = format('%s: %s', r.num, sqlerrm); end;
      v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.total);
    end if;
    begin
      v_id := public._dl1_asiento_iva(v_e, date '2026-10-01', 4,
        'Compensación Glovo que faltaba · ' || r.num || ' (' || r.periodo || ')',
        'DL1, conciliación de la 43000001 con el zip de Glovo (Julio, 15/11): Glovo descontó esta factura de su liquidación y la compensación no estaba; a 01/10 porque el 2T está presentado.',
        jsonb_build_array(jsonb_build_object('cuenta', '41000002', 'debe', r.total, 'tercero', v_glovo, 'local', r.loc, 'documento', r.num),
                          jsonb_build_object('cuenta', '43000001', 'haber', r.total, 'tercero', v_glovo, 'local', r.loc)));
    exception when others then raise exception using errcode = format('D%s%s', lpad(v_k::text, 2, '0'), left(sqlstate, 2)), message = format('%s: %s', r.num, sqlerrm); end;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.total);
  end loop;
  if v_k <> 13 then raise exception 'DL1 Glovo 430: % compensaciones, no 13.', v_k; end if;

  -- Validados como Julio, uno a uno, con su código si alguno para.
  for v_k in 0 .. jsonb_array_length(v_ids) - 1 loop
    begin
      v_n := v_n + public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(v_ids->v_k));
    exception when others then
      raise exception using errcode = format('V%s%s', lpad((v_k % 100)::text, 2, '0'), left(sqlstate, 2)), message = sqlerrm;
    end;
  end loop;
  raise notice 'DL1 Glovo 430: % asientos validados como Julio.', v_n;
end $$;
