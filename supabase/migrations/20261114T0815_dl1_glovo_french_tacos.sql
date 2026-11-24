-- supabase/migrations/20261114T0815_dl1_glovo_french_tacos.sql
--
-- DL1·26 · Glovo, French Tacos Club de Vallecas (Julio, 14/11, 07:50). Nada en
-- el camino del pedido. Cifras de los PDF de las liquidaciones de Glovo.
--
-- La tienda de Glovo «French Tacos Club - C. de Juan Antonio Bardem» (Avenida
-- del Ensanche de Vallecas 106) es de Llorente29, con su NIF, pero su marca no
-- existe en Folvy: sus ventas no están en ningún asiento del día. Glovo le paga
-- a una cuenta particular de Julio (···2149): el cobro NO se apunta y queda en la
-- 43000001, pendiente de registrar.
--   1. Sus cuentas: 70000012 VENTAS FRENCH TACOS CLUB y 70800012 DEVOL. VENTAS
--      FRENCH TACOS CLUB, en la numeración de las demás marcas.
--   2. Sus ventas, liquidación a liquidación, como un asiento del día de Folvy:
--      la venta bruta (70000012), la promoción a su cargo (70009002) y el coste
--      de incidencias sobre productos (70800012) al Debe, y el IVA del 10 % sobre
--      lo neto (47700010). Las de agosto y septiembre a 01/10 (el 3T está
--      presentado: su IVA va al 4T), las de octubre en su fecha.
--   3. La tasa de tiempo de espera de octubre (12,00 y 36,75), sin IVA, a la
--      62900006, como las de Diez.
--   4. La I170326000551592: su factura ya está (2/3328); su compensación, enlazada
--      a su liquidación, a 16/10, por el total de la factura (577,42). La propuesta
--      de la pasada de noche (406,81, del Excel sin promociones) se borra y se rehace.
--   5. La I170326000585810 (16–31/10, 879,87), que no estaba: su factura de
--      comisión con su asiento (62300001 y su IVA) y su compensación, a 31/10.
--   6. La nota «Cobrado fuera de la empresa (···2149), pendiente de registrar» en
--      sus 12 liquidaciones de la ···2149 que están en Sumied, sin darlas por
--      cobradas.
-- Todo validado como Julio.
--
-- sin hueco: solo borra la propuesta de compensación de la liquidación 551592 (no es un asiento del día) y la rehace en este mismo fichero con _journal_entry_proponer.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_glovo constant uuid := '720afecb-a89b-4ca9-a249-f11dcb451c38';      -- Glovo, su tercero
  v_prov constant uuid := '1311a14f-996e-4a3b-af02-e51f5000a8fa';       -- Glovo, su ficha de proveedor
  v_loc constant uuid := '38158159-cd71-4056-950b-53425afac1ce';        -- el local de la tienda en Sumied
  v_t10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';
  v_t21 constant uuid := '36887d70-bcc4-4590-94ea-331213f90da3';
  v_nota constant text := 'Cobrado fuera de la empresa (···2149), pendiente de registrar';
  r record; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int; v_lin jsonb; v_res jsonb; v_inv uuid; v_tot numeric;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Glovo French Tacos: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  -- La propuesta que hizo sola la pasada de noche para la 551592 (406,81, lo que lee del Excel sin las promociones) se
  -- rehace por el total de su factura, como hizo la 1615.
  delete from public.journal_entry e where e.company_id = v_e and e.source_type = 'channel_settlement'
     and e.source_id = '6b27b083-b05c-4df9-b42b-fb0118f91dda' and e.status = 'propuesto';
  -- Que la factura nueva no vaya a buscarse una liquidación de otra tienda.
  perform set_config('s01i.sin_buscar', 'si', true);
  if exists (select 1 from public.company_account where company_id = v_e and code in ('70000012', '70800012'))
     or exists (select 1 from public.supplier_invoice where account_id = v_acc and invoice_number = 'I170326000585810')
     or exists (select 1 from public.journal_entry where company_id = v_e and status <> 'anulado' and concept like 'Ventas Glovo · French Tacos Club%')
     or exists (select 1 from public.journal_entry j where j.company_id = v_e and j.source_type = 'channel_settlement'
                 and j.source_id = '6b27b083-b05c-4df9-b42b-fb0118f91dda' and j.status <> 'anulado') then
    raise exception 'DL1 Glovo French Tacos: algo ya está (sus cuentas, la factura 585810, sus ventas o la compensación de la 551592): no se apunta nada.';
  end if;

  -- 1. Sus cuentas.
  insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
  values (v_acc, v_e, '70000012', 'VENTAS FRENCH TACOS CLUB', 'own', 'pymes', 'manual', '700'),
         (v_acc, v_e, '70800012', 'DEVOL. VENTAS FRENCH TACOS CLUB', 'own', 'pymes', 'manual', '7080');

  -- 2 y 3. Sus ventas, liquidación a liquidación.
  for r in select * from (values
      ('I170326000442607', '446598c6-4b7c-4c1e-b16d-5fbaebb88b65'::uuid, '2026-10-01', '16–31/08/2026', 95.50, 47.75, 15.50, 0, 86.82, 43.41, 14.09, 32.25, 2.93),
      ('I170326000473754', '12c89ce9-d516-457f-93cf-04b827315620'::uuid, '2026-10-01', '01–15/09/2026', 322.08, 150.39, 0, 0, 292.80, 136.72, 0.00, 171.69, 15.61),
      ('I170326000512971', 'e8a76512-93ba-44ed-84e1-90e54514ba09'::uuid, '2026-10-01', '16–30/09/2026', 404.00, 174.00, 0, 0, 367.27, 158.18, 0.00, 230.00, 20.91),
      ('I170326000551592', '6b27b083-b05c-4df9-b42b-fb0118f91dda'::uuid, '2026-10-15', '01–15/10/2026', 1989.40, 903.50, 36.55, 12.00, 1808.55, 821.36, 33.23, 1049.35, 95.39),
      ('I170326000585810', null::uuid, '2026-10-31', '16–31/10/2026', 3343.06, 1524.50, 35.80, 36.75, 3039.15, 1385.91, 32.55, 1782.76, 162.07)
    ) x(ref, liq, fecha, periodo, productos, promo, incid, espera, b_venta, b_promo, b_incid, neto, iva) loop
    v_lin := jsonb_build_array(
      jsonb_build_object('cuenta', '43000001', 'debe', r.neto, 'tercero', v_glovo, 'local', v_loc, 'concepto', 'Ventas de la liquidación ' || r.ref || ' (' || r.periodo || '), cobro pendiente'),
      jsonb_build_object('cuenta', '70009002', 'debe', r.b_promo, 'local', v_loc, 'concepto', 'Promoción de producto a su cargo, ' || r.promo || ' con IVA'));
    if r.incid > 0 then
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '70800012', 'debe', r.b_incid, 'local', v_loc, 'concepto', 'Coste de incidencias sobre productos, ' || r.incid || ' con IVA'));
    end if;
    v_lin := v_lin || jsonb_build_array(
      jsonb_build_object('cuenta', '70000012', 'haber', r.b_venta, 'local', v_loc, 'concepto', 'Productos, ' || r.productos || ' con IVA'),
      jsonb_build_object('cuenta', '47700010', 'haber', r.iva, 'local', v_loc, 'iva', jsonb_build_object('tipo', v_t10, 'base', r.b_venta - r.b_promo - r.b_incid, 'libro', 'issued')));
    if r.espera > 0 then
      v_lin := v_lin || jsonb_build_array(
        jsonb_build_object('cuenta', '62900006', 'debe', r.espera, 'local', v_loc, 'concepto', 'Tasa de tiempo de espera, sin IVA'),
        jsonb_build_object('cuenta', '43000001', 'haber', r.espera, 'tercero', v_glovo, 'local', v_loc, 'concepto', 'Tasa de tiempo de espera, descontada'));
    end if;
    v_id := public._dl1_asiento_iva(v_e, r.fecha::date, 1,
      'Ventas Glovo · French Tacos Club · Vallecas · ' || r.ref || ' (' || r.periodo || ')',
      'DL1·26 (Julio, 14/11): ventas de Llorente29 de su tienda de Glovo de Vallecas, leídas del PDF de la liquidación; la marca no está en Folvy y no entraron en los asientos del día. El cobro lo recibió Julio (···2149): queda en la 43000001, pendiente de registrar.',
      v_lin);
    select sum(debit) into v_tot from public.journal_line where entry_id = v_id;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', v_tot);
  end loop;

  -- 4. La compensación de la 551592, enlazada a su liquidación.
  if not exists (select 1 from public.supplier_invoice s join public.journal_entry j on j.id = s.journal_entry_id
                  where s.id = 'a9c0d1a1-b18d-4b12-a787-08be62c5f8e5' and s.grand_total = 577.42 and j.status = 'validado') then
    raise exception 'DL1 Glovo French Tacos: la factura I170326000551592 no está apuntada por 577,42: no se apunta nada.';
  end if;
  v_res := public._journal_entry_proponer(v_e,
    jsonb_build_object('series', 4, 'fecha', '2026-10-16', 'concepto', 'Liquidación Glovo · I170326000551592', 'source_type', 'channel_settlement',
      'source_id', '6b27b083-b05c-4df9-b42b-fb0118f91dda', 'confianza', 'seguro',
      'porque', 'DL1·26 (Julio, 14/11): su factura de comisión compensada con lo que Glovo debe; el cobro (···2149) no se apunta.',
      'razones', '[]'::jsonb, 'party_id', null, 'documento', 'I170326000551592'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '41000002', 'debe', 577.42, 'haber', 0, 'concepto', 'Factura de Glovo I170326000551592, compensada', 'local_id', v_loc, 'comun', false, 'tercero_id', v_glovo),
      jsonb_build_object('cuenta', '43000001', 'debe', 0, 'haber', 577.42, 'concepto', 'Compensada con su factura', 'local_id', v_loc, 'comun', false, 'tercero_id', v_glovo)),
    null, 'Julio (tanda DL1)', null);
  v_id := (v_res->>'id')::uuid;
  if v_id is null or coalesce((v_res->>'existente')::boolean, false) then raise exception 'DL1 Glovo French Tacos: la compensación de la 551592 no ha salido nueva (%).', v_res; end if;
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 577.42);

  -- 5. La I170326000585810: su factura, su asiento y su compensación.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, status, source,
                                       arrival_channel, tax_base_total, tax_total, grand_total, needs_review, notes, approved_at, approved_by_name, created_by_name)
  values (v_acc, v_e, v_prov, v_loc, 'invoice', 'I170326000585810', date '2026-10-31', 'aprobada', 'manual', 'portal', 727.17, 152.70, 879.87, false,
          'DL1·26: factura de comisión de Glovo del 16–31/10/2026 (French Tacos Club · Vallecas), del zip de liquidaciones de Glovo.', now(), 'Julio (tanda DL1)', 'Julio (tanda DL1)')
  returning id into v_inv;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
  values (v_inv, 'Tasa de acceso a la plataforma de Glovo', 1, 178.71, 178.71, 21, '62300001', 1),
         (v_inv, 'Servicio de los repartidores', 1, 362.85, 362.85, 21, '62300001', 2),
         (v_inv, 'Recargo por pedido con Glovo Prime', 1, 26.64, 26.64, 21, '62300001', 3),
         (v_inv, 'Glovo Ads', 1, 158.97, 158.97, 21, '62300001', 4);
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
  values (v_acc, v_inv, v_t21, 21, 727.17, 152.70);
  v_res := public._journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-10-31', 'concepto', 'Factura GLOVOAPP SPAIN PLATFORM · I170326000585810', 'source_type', 'supplier_invoice',
      'source_id', v_inv, 'confianza', 'seguro', 'porque', 'DL1·26 (Julio, 14/11): factura de comisión de Glovo de la tienda de Vallecas, del 16–31/10.',
      'razones', '[]'::jsonb, 'party_id', v_glovo, 'documento', 'I170326000585810'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62300001', 'debe', 727.17, 'haber', 0, 'local_id', v_loc, 'comun', false),
      jsonb_build_object('cuenta', '47200021', 'debe', 152.70, 'haber', 0, 'local_id', v_loc, 'comun', false,
        'iva', jsonb_build_object('tipo_id', v_t21, 'base', 727.17, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '41000002', 'debe', 0, 'haber', 879.87, 'local_id', v_loc, 'comun', false, 'tercero_id', v_glovo, 'documento', 'I170326000585810')),
    null, 'Julio (tanda DL1)', null);
  v_id := (v_res->>'id')::uuid;
  if v_id is null or coalesce((v_res->>'existente')::boolean, false) then raise exception 'DL1 Glovo French Tacos: el asiento de la factura 585810 no ha salido nuevo (%).', v_res; end if;
  update public.supplier_invoice set journal_entry_id = v_id, updated_at = now() where id = v_inv and journal_entry_id is distinct from v_id;
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 879.87);
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-31', 4,
    'Glovo · I170326000585810 (16–31/10/2026, French Tacos Club · Vallecas) compensada con lo que Glovo debe',
    'DL1·26 (Julio, 14/11): su factura de comisión compensada con la 43000001; el cobro (866,14 el 20/11, a la ···2149) no se apunta.',
    jsonb_build_array(jsonb_build_object('cuenta', '41000002', 'debe', 879.87, 'tercero', v_glovo, 'local', v_loc, 'documento', 'I170326000585810'),
                      jsonb_build_object('cuenta', '43000001', 'haber', 879.87, 'tercero', v_glovo, 'local', v_loc)));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', 879.87);

  -- 6. La nota en sus liquidaciones de la ···2149, sin darlas por cobradas.
  update public.channel_settlement c set collection_note = v_nota, updated_at = now()
   where c.account_id = v_acc and c.collected_on is null
     and c.id in ('56eedbe5-5380-4732-ad7e-6c1b21531cef', 'c37e766a-e85e-4b25-b268-813aa0e553d5', '7822bad0-aa5f-4648-9d59-c8ed403db12d',
                  '446598c6-4b7c-4c1e-b16d-5fbaebb88b65', '12c89ce9-d516-457f-93cf-04b827315620', 'e8a76512-93ba-44ed-84e1-90e54514ba09',
                  '6b27b083-b05c-4df9-b42b-fb0118f91dda', 'ed39ee40-1364-4a8b-b108-434ec53c7077', '4012c24c-e05b-43d4-9bb9-867eccb98642',
                  '143f6110-5a6b-4695-8b02-dea834a17fa1', '91a54b57-2327-4e62-88aa-3a26bc9aac8c', '6e22811f-c001-48ec-9e3a-6907f1f28b8d');
  get diagnostics v_n = row_count;
  if v_n <> 12 then raise exception 'DL1 Glovo French Tacos: la nota ha entrado en % liquidaciones, no en las 12.', v_n; end if;

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Glovo French Tacos: % asientos validados como Julio.', v_n;
end $$;
