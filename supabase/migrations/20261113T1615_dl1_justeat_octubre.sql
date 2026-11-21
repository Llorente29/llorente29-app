-- supabase/migrations/20261113T1615_dl1_justeat_octubre.sql
--
-- DL1 · Just Eat del 01–15/10: las 3 liquidaciones que no entraron y los cargos
-- GL de la campaña JET+ (Julio, DL1·24, respuesta del 13/11). Nada en el camino
-- del pedido.
--
-- Las 3 llegaron el 16/10 con la factura en el cuerpo del correo y el lector no
-- las vio (inbound_email_log «sin_facturas»). Cifras leídas de los PDF de los
-- correos (4126424, 4126364 y 4126341), por el camino de la aplicación:
--   1. conta_liquidacion_registrar: la liquidación, en su tienda (ya asignada).
--   2. conta_comision_del_correo: su factura de comisión, ligada.
--   3. _conta_plataforma_apuntar: la factura aprobada y apuntada (serie 2).
--   4. Un asiento por liquidación, enlazado a ella (_journal_entry_proponer) y
--      validado como Julio: la compensación de su factura con la 43000003.
--   5. Su cargo GL de la campaña (el estado de cuenta lo descuenta aparte, por
--      el mismo importe que el abono de campaña de la factura, IVA incluido), en
--      su propio asiento, sin IVA, como gasto (62300003) contra la 43000003: el
--      de la liquidación no puede llevar gasto (tg_journal_line_liquidacion_no_repite).
-- Y lo mismo para la 4126387 (Meraki Pita, abono de campaña de 5,98 y su cargo
-- GL de 5,98: neto 0), que tenía la factura pero no su asiento.
--   4126424 Milanesa House · Alcalá      ventas 144,02 · factura  32,79 · GL 20,93 · neto 90,30
--   4126364 Mila's Sandwiches · Alcalá   ventas  66,99 · factura −13,66 · GL 26,91 · neto 53,74
--   4126341 Milanesa House · Camichi 4   ventas   0,00 · factura  −2,99 · GL  2,99 · neto  0,00
--   4126387 Meraki Pita · Cañaveral      ventas   0,00 · factura  −5,98 · GL  5,98 · neto  0,00
-- Los cobros del 20/10 (90,30 y 53,74) ya están en la 43000003 desde Bancos: la
-- compensación no los toca.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.
--
-- sin hueco: la propuesta que pueda haber hecho sola la liquidación al ligar su factura se borra y se rehace en el mismo bucle, con su cargo GL.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  r record; p jsonb; v_res jsonb; v_i int := 0; v_k int := 0; v_con text; v_liq uuid; v_inv uuid; v_loc uuid; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int; v_lin jsonb; v_tot numeric;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Just Eat octubre: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  if exists (select 1 from public.channel_settlement where account_id = v_acc and settlement_ref in ('4126424', '4126364', '4126341'))
     or exists (select 1 from public.supplier_invoice where account_id = v_acc and invoice_number in ('4126424', '4126364', '4126341')) then
    raise exception 'DL1 Just Eat octubre: alguna de las 3 ya está: no se apunta nada.';
  end if;

  for r in select * from (values
      ('4126424', 'Milanesa House', 'Milanesa House (Calle de Florencio Llorente 29)', 4, 144.02, 27.10, 5.69, 32.79, 20.93, 90.30, 'GL011103997'),
      ('4126364', 'Mila''s Sandwiches', 'Mila''s Sandwiches (Calle de Florencio Llorente 29)', 3, 66.99, -11.29, -2.37, -13.66, 26.91, 53.74, 'GL011103995'),
      ('4126341', 'Milanesa House', 'Milanesa House (Calle de Camichi 4)', 0, 0.00, -2.47, -0.52, -2.99, 2.99, 0.00, 'GL011103985')
    ) x(ref, marca, tienda, pedidos, ventas, base, iva, total, gl, neto, gl_ref) loop
    p := jsonb_build_object('proveedor', 'justeat', 'origen', 'correo', 'tienda', r.tienda, 'marca', r.marca,
      'desde', '2026-10-01', 'hasta', '2026-10-15', 'pago_el', '2026-10-22', 'fecha_factura', '2026-10-15',
      'referencia', r.ref, 'referencia_asunto', r.ref, 'pedidos', r.pedidos, 'ventas', jsonb_build_object('total', r.ventas),
      'comision', r.total, 'otros', -r.gl, 'neto', r.neto, 'avisos', '[]'::jsonb,
      'factura', jsonb_build_object('numero', r.ref, 'base', r.base, 'iva', r.iva, 'total', r.total),
      'intermediario', jsonb_build_object('nombre', 'Just Eat Spain S.L.', 'nif', 'B86008539'),
      'dl1', 'DL1·24: leída del PDF del correo, que el lector no vio (sin adjunto).');
    v_i := v_i + 1;
    -- Cada paso para con su código (DJ<paso><liquidación>0): el ensayo solo enseña el SQLSTATE.
    begin v_res := public.conta_liquidacion_registrar(v_e, p, 'Julio (tanda DL1)');
    exception when others then raise exception using errcode = format('DJ1%s0', v_i), message = sqlerrm; end;
    v_liq := (v_res->>'liquidacion_id')::uuid;
    if v_liq is null or coalesce((v_res->>'ya_estaba')::boolean, false) or coalesce((v_res->>'tienda_nueva')::boolean, false)
       or (select location_id from public.channel_settlement where id = v_liq) is null then
      raise exception 'DL1 Just Eat octubre: la liquidación % no ha entrado nueva en su tienda (%): no se apunta nada.', r.ref, v_res;
    end if;
    begin v_res := public.conta_comision_del_correo(v_liq, p);
    exception when others then raise exception using errcode = format('DJ2%s0', v_i), message = sqlerrm; end;
    v_inv := (v_res->>'factura_id')::uuid;
    if v_inv is null or v_res->>'estado' <> 'creada' then
      raise exception 'DL1 Just Eat octubre: la factura % no se ha creado (%): no se apunta nada.', r.ref, v_res;
    end if;
    begin update public.channel_settlement set commission_invoice_id = v_inv, updated_at = now() where id = v_liq and commission_invoice_id is distinct from v_inv;
    exception when others then raise exception using errcode = format('DJ3%s0', v_i), message = sqlerrm; end;
    begin v_res := public._conta_plataforma_apuntar(v_inv);
    exception when others then raise exception using errcode = format('DJ4%s0', v_i), message = sqlerrm; end;
    if not coalesce((v_res->>'apuntada')::boolean, false) then
      raise exception 'DL1 Just Eat octubre: la factura % no se ha apuntado (%): no se apunta nada.', r.ref, v_res;
    end if;
  end loop;

  -- 4. Un asiento por liquidación: su factura compensada con la 43000003 y su cargo GL.
  for r in select * from (values
      ('4126424', 32.79, 20.93, 'GL011103997'),
      ('4126364', -13.66, 26.91, 'GL011103995'),
      ('4126341', -2.99, 2.99, 'GL011103985'),
      ('4126387', -5.98, 5.98, null)
    ) x(ref, total, gl, gl_ref) loop
    v_k := v_k + 1;
    select c.id, c.location_id into v_liq, v_loc from public.channel_settlement c
     where c.account_id = v_acc and c.settlement_ref = r.ref and c.period_from = date '2026-10-01' and c.period_to = date '2026-10-15';
    -- La propuesta que haya hecho sola al ligar la factura (Debe/Haber por el total, sin el cargo GL) se rehace, como hace la aplicación.
    delete from public.journal_entry e where e.company_id = v_e and e.source_type = 'channel_settlement' and e.source_id = v_liq and e.status = 'propuesto';
    if v_liq is null or exists (select 1 from public.journal_entry e where e.company_id = v_e and e.source_type = 'channel_settlement' and e.source_id = v_liq and e.status <> 'anulado')
       or not exists (select 1 from public.channel_settlement c join public.supplier_invoice s on s.id = c.commission_invoice_id
                       join public.journal_entry j on j.id = s.journal_entry_id
                      where c.id = v_liq and s.grand_total = r.total and j.status = 'validado') then
      raise exception 'DL1 Just Eat octubre: la liquidación % no está, ya tiene asiento o su factura no está apuntada por %: no se apunta nada.', r.ref, r.total;
    end if;
    v_lin := case when r.total > 0 then jsonb_build_array(
        jsonb_build_object('cuenta', '41000004', 'debe', r.total, 'haber', 0, 'concepto', 'Factura de JustEat ' || r.ref || ', compensada', 'local_id', v_loc, 'comun', false),
        jsonb_build_object('cuenta', '43000003', 'debe', 0, 'haber', r.total, 'concepto', 'Compensada con su factura', 'local_id', v_loc, 'comun', false))
      else jsonb_build_array(
        jsonb_build_object('cuenta', '43000003', 'debe', -r.total, 'haber', 0, 'concepto', 'Abono de JustEat ' || r.ref || ', compensado', 'local_id', v_loc, 'comun', false),
        jsonb_build_object('cuenta', '41000004', 'debe', 0, 'haber', -r.total, 'concepto', 'Compensado con su abono', 'local_id', v_loc, 'comun', false)) end;
    begin v_res := public._journal_entry_proponer(v_e,
      jsonb_build_object('series', 4, 'fecha', '2026-10-22', 'concepto', 'Liquidación JustEat · ' || r.ref, 'source_type', 'channel_settlement',
        'source_id', v_liq, 'confianza', 'seguro',
        'porque', 'DL1·24 (Julio, 13/11): su factura de comisión compensada con lo que Just Eat debe (43000003).',
        'razones', '[]'::jsonb, 'party_id', null, 'documento', r.ref),
      v_lin, null, 'Julio (tanda DL1)', null);
    exception when others then
      get stacked diagnostics v_con = constraint_name;
      v_k := v_k;
      raise exception using message = r.ref || ': ' || sqlerrm,
        errcode = 'D' || v_k || case v_con when 'ux_journal_entry_origen' then 'O' when 'ux_journal_entry_numero' then 'N' when 'ux_journal_entry_cadena' then 'C'
                                           when 'ux_journal_entry_anula' then 'A' else 'X' end
                  || coalesce((select upper(left(e.status, 1)) from public.journal_entry e where e.company_id = v_e and e.source_type = 'channel_settlement'
                                and e.source_id = v_liq and e.status <> 'anulado' limit 1), '0') || '9';
    end;
    v_id := (v_res->>'id')::uuid;
    if v_id is null or coalesce((v_res->>'existente')::boolean, false) then
      raise exception 'DL1 Just Eat octubre: el asiento de % no ha salido nuevo (%): no se apunta nada.', r.ref, v_res;
    end if;
    select sum(debit) into v_tot from public.journal_line where entry_id = v_id;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', v_tot);
    -- Su cargo GL, aparte: el asiento de una liquidación con factura de comisión no lleva gasto (no se apunta dos veces la comisión).
    begin
      v_id := public._dl1_asiento_iva(v_e, date '2026-10-15', 4,
        'Just Eat · cargo de campaña JET+' || coalesce(' ' || r.gl_ref, '') || ' · liquidación ' || r.ref,
        'DL1·24 (Julio, 13/11): el estado de cuenta de Just Eat descuenta aparte la campaña de envío gratis JET+, por el mismo importe que el abono de campaña de su factura con IVA. Sin IVA, como gasto contra la 43000003.',
        jsonb_build_array(jsonb_build_object('cuenta', '62300003', 'debe', r.gl, 'local', v_loc),
                          jsonb_build_object('cuenta', '43000003', 'haber', r.gl, 'local', v_loc)));
    exception when others then raise exception using errcode = format('DJ7%s0', v_k), message = r.ref || ': ' || sqlerrm; end;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.gl);
  end loop;

  begin v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  exception when others then raise exception using errcode = 'DJ600', message = sqlerrm; end;
  raise notice 'DL1 Just Eat octubre: 3 liquidaciones con su factura, y % asientos de compensación y cargo GL validados como Julio.', v_n;
end $$;
