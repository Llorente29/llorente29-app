-- supabase/migrations/20261113T1225_dl1_uber_octubre.sql
--
-- DL1 · Uber de octubre: cada liquidación compensada en su fecha (Julio, DL1·24,
-- respuesta del 13/11, opción A). Nada en el camino del pedido.
--
-- Las facturas de Portier de octubre estaban compensadas en dos bloques de la
-- 1702 (05/11): el 4/3352 (31/10, 403,55) y el 4/3351 (05/11, 6.303,17, las 43
-- con asiento del 05/11, 28 de octubre que la 0905 ha llevado a su fecha y 15 de
-- noviembre). Los dos se anulan en su misma fecha y se rehace así:
--   1. Las 8 liquidaciones sin tienda toman la marca y el local de las ya
--      asignadas de su misma tienda de Uber (Florencio Llorente 29 → Alcalá,
--      Camichi 4 → Carabanchel).
--   2. Los enlaces con la factura de comisión, a la de su tienda, semana e
--      importe (el emparejador ponía la de la otra tienda de la misma marca).
--      Sin buscar de nuevo (s01i.sin_buscar) para que no los vuelva a poner.
--   3. Las 17 que cuadran se compensan en su fecha por el camino de la pantalla
--      (_conta_proponer_plataforma) y se validan como Julio. La compensación es
--      lo que dice el correo; los céntimos de redondeo frente a la factura
--      (0,47 en total) quedan en la 41000003, el criterio de la 0045.
--   4. Las 23 facturas de octubre sin liquidación que cuadre, en un asiento a
--      31/10 con su lista (3.012,73).
--   5. Las 15 facturas de noviembre (03–04/11) del 4/3351, otra vez a 05/11
--      (1.794,73): son de las liquidaciones de noviembre, que no se apuntan.
-- Las 4 «revisar» de noviembre que tenían la factura de otra tienda quedan con
-- la suya, sin apuntar (van a S).
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_uber constant uuid := '477a9cd0-dce2-452d-a68d-cc1d8076c026';
  v_b31 constant uuid := 'd343aa58-c5fe-4a75-b34b-4fe3b5d73239';   -- 4/3352, 31/10, 403,55
  v_b05 constant uuid := '707dd0f4-8687-476a-8269-b212d1fa095c';   -- 4/3351, 05/11, 6.303,17
  r record; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int; v_loc uuid; v_brand uuid; v_store uuid; v_k int;
  v_resto numeric; v_resto_n int; v_lista text; v_nov numeric; v_nov_n int; v_nov_lista text;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Uber octubre: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  perform set_config('s01i.sin_buscar', 'si', true);

  -- Los dos bloques, como se midieron.
  if not exists (select 1 from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
                  where e.id = v_b31 and e.company_id = v_e and e.status = 'validado' and e.entry_date = date '2026-10-31' and a.code = '41000003' and l.debit = 403.55)
     or not exists (select 1 from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
                     where e.id = v_b05 and e.company_id = v_e and e.status = 'validado' and e.entry_date = date '2026-11-05' and a.code = '41000003' and l.debit = 6303.17) then
    raise exception 'DL1 Uber octubre: los bloques 4/3352 (403,55 a 31/10) y 4/3351 (6.303,17 a 05/11) no son los medidos: no se apunta nada.';
  end if;

  create temp table dl1_uber_liq (liq uuid primary key, fac uuid not null, importe numeric not null, apuntar boolean not null) on commit drop;
  insert into dl1_uber_liq values
    ('647ceee5-b5b0-4085-9465-bd016cd4f9c6', '716397a9-8d08-4b59-88b1-b5134663bab1', 234.33, true),   -- Meraki Pita · Alcalá · 28/09–04/10 · 2081547 (234,38)
    ('14e0be14-96d2-4bfc-afab-0129ab85a57a', '7a7c25ae-2aa8-4a4d-aa35-5804525b62a7', 55.05, true),    -- Milanesa House · Camichi · 28/09–04/10 · 2072161
    ('5ef7ebe0-7fd3-41c5-b1e0-59c452e9e3b4', '08d4d499-d223-4bbd-ae39-580b404a0b6f', 56.98, true),    -- Bendito Burrito · Alcalá · 05–11/10 · 2141553
    ('d56f6034-c225-4177-a779-6a4281aa5a0e', 'fbf31a80-38da-4486-bc5d-9ba5d795597e', 256.11, true),   -- Meraki Pita · Alcalá · 05–11/10 · 2144177 (256,20)
    ('1fcecf0e-e2d3-40db-b7a4-366c734783a6', 'dca4ebcf-7ee9-4d95-a557-dc0d437b5651', 104.61, true),   -- Meraki Pita · Camichi · 05–11/10 · 2126833 (104,63)
    ('4e8744fc-03d4-4013-9338-6d3bf513c82c', '84f560e4-cf3c-4c28-8839-7f0d178b32f3', 111.84, true),   -- Milanesa House · Camichi · 05–11/10 · 2137424 (111,86)
    ('00a3a050-e2b7-4b0f-9cd2-627de5e41ffe', '3315d991-897d-4c9e-93ae-a64631ba5e12', 53.79, true),    -- Bendito Burrito · Alcalá · 12–18/10 · 2168211
    ('9a6c28c7-2144-4491-9a9e-798dd9595b73', '4de8db53-38f3-4842-b74e-a5f0eb27292c', 280.75, true),   -- Meraki Pita · Alcalá · 12–18/10 · 2179661 (280,86)
    ('c07660dd-4e54-45df-acad-ef07b99cb881', '2f159529-ae9a-493a-b6cf-4da0148f4ab4', 37.60, true),    -- Mila's Sandwiches · Alcalá · 12–18/10 · 2166112
    ('34dcfad2-3f2a-4533-9654-3f9d5e582510', 'be5847f7-6aee-4a15-a936-c32179d722ef', 82.72, true),    -- Milanesa House · Alcalá · 12–18/10 · 2178078 (82,76)
    ('93fc8b17-76ae-430f-b816-f0497fe8effc', 'a7302d53-f60d-4680-8e5d-d250194cb800', 2.31, true),     -- Scandal Burgers · Alcalá · 07/09–18/10 · 2179939
    ('0aa641af-8cc8-4256-a82b-ce2a8920fb3c', '7069a401-bb9b-4647-8e1f-6f7dee7d6fa9', 21.98, true),    -- The Urban Kebab · Alcalá · 12–18/10 · 2194806
    ('51981907-b1e6-492d-8f19-18dd612abcb5', '65b146d7-fae4-41b0-9167-1b60046ca4de', 63.66, true),    -- Milanesa House · Camichi · 12–18/10 · 2163411 (63,68)
    ('500ad265-13ce-4b4e-a0a1-6f776e7157fd', '97f6ddeb-aa6f-46ad-a8b3-6f7b9adc6e18', 38.09, true),    -- Bendito Burrito · Alcalá · 19–25/10 · 2235129
    ('bfd9ed75-5194-440c-86a0-250386a5adf1', 'fd7d4988-2805-4e0b-a3c8-86910653f7fa', 331.43, true),   -- Meraki Pita · Alcalá · 19–25/10 · 2240622 (331,47)
    ('fb66cdc9-6729-4bc8-a32d-fd12f31aed4f', '8dde7e6b-94f1-4c3b-899d-2d6ecef2e3f9', 94.71, true),    -- Milanesa House · Alcalá · 19–25/10 · 2232234 (94,75)
    ('3a909164-f1fa-4d3f-b36f-da4f82bc92d4', '22749ec3-fa8f-46c3-b322-521793d3cca5', 107.99, true),   -- Milanesa House · Camichi · 19–25/10 · 2219877 (108,01)
    -- De noviembre, por aclarar (van a S): solo su factura, sin apuntar.
    ('27aec71e-58aa-4c10-bda1-7175bde72352', 'cc05346b-d301-45c7-9cff-91b2becb4c54', 89.63, false),
    ('e9b28c1f-01ad-4c63-a7ab-cf00cfbab02b', '827c6bd1-869a-4826-9487-9f6fa0679478', 167.73, false),
    ('38f3a652-b19e-4bea-b4b8-f19477497998', '5e9fefbf-57f7-4106-b825-5301276c3ce1', 67.30, false),
    ('ed3d2493-72e7-4a34-be53-fee7c3d9e53e', 'f39abc36-a575-413e-9fe7-deb0bc40350d', 164.15, false);

  -- Cada una, de Foodint, de Uber, sin asiento; cada factura, de Portier, con su asiento validado y a menos de 0,12 de lo que dice el correo.
  if (select count(*) from dl1_uber_liq x join public.channel_settlement c on c.id = x.liq join public.sales_channel ch on ch.id = c.channel_id
       join public.supplier_invoice s on s.id = x.fac join public.journal_entry j on j.id = s.journal_entry_id
      where c.account_id = v_acc and ch.name = 'Uber' and s.account_id = v_acc and s.invoice_number like 'B88515200-%' and j.status = 'validado'
        and abs(s.grand_total - x.importe) < 0.12 and (c.raw->'factura'->>'total')::numeric = x.importe
        and not exists (select 1 from public.journal_entry e where e.source_type = 'channel_settlement' and e.source_id = c.id and e.status <> 'anulado')) <> 21 then
    raise exception 'DL1 Uber octubre: alguna liquidación ya tiene asiento o su factura no es la medida: no se apunta nada.';
  end if;

  -- 1 y 2. Tienda y factura.
  for r in select x.*, c.location_id, c.external_location_text, c.review_note from dl1_uber_liq x join public.channel_settlement c on c.id = x.liq loop
    v_loc := r.location_id; v_brand := null; v_store := null;
    if r.location_id is null then
      select count(distinct p.location_id), min(p.location_id::text)::uuid into v_k, v_loc
        from public.channel_settlement p where p.account_id = v_acc and p.external_location_text = r.external_location_text and p.location_id is not null and p.id <> r.liq;
      if v_k <> 1 then raise exception 'DL1 Uber octubre: la tienda «%» no tiene un solo local en las ya asignadas (%): no se apunta nada.', r.external_location_text, v_k; end if;
      select min(p.brand_id::text)::uuid, min(p.store_id::text)::uuid into v_brand, v_store
        from public.channel_settlement p where p.account_id = v_acc and p.external_location_text = r.external_location_text and p.location_id = v_loc and p.id <> r.liq;
      if (r.external_location_text like '%Camichi 4%') <> (v_loc = (select id from public.locations where account_id = v_acc and name = 'Foodint Carabanchel')) then
        raise exception 'DL1 Uber octubre: la tienda «%» no va al local de su dirección: no se apunta nada.', r.external_location_text;
      end if;
    end if;
    update public.channel_settlement c
       set location_id = v_loc, brand_id = coalesce(c.brand_id, v_brand), store_id = coalesce(c.store_id, v_store),
           needs_review = case when c.review_note = 'Tienda sin asignar: dale su marca y su local.' then false else c.needs_review end,
           review_note = case when c.review_note = 'Tienda sin asignar: dale su marca y su local.' then null else c.review_note end,
           commission_invoice_id = r.fac, updated_at = now()
     where c.id = r.liq;
    delete from public.channel_settlement_invoice k where k.settlement_id = r.liq and k.supplier_invoice_id <> r.fac;
    delete from public.channel_settlement_invoice k where k.supplier_invoice_id = r.fac and k.settlement_id <> r.liq;
    if not exists (select 1 from public.channel_settlement_invoice k where k.settlement_id = r.liq and k.supplier_invoice_id = r.fac) then
      insert into public.channel_settlement_invoice (account_id, settlement_id, supplier_invoice_id, matched_by, matched_by_name)
      values (v_acc, r.liq, r.fac, 'persona', 'Julio');
    end if;
  end loop;
  if exists (select 1 from dl1_uber_liq x join public.channel_settlement c on c.id = x.liq where x.apuntar and (c.location_id is null or c.needs_review)) then
    raise exception 'DL1 Uber octubre: alguna de las 17 sigue sin local o por aclarar: no se apunta nada.';
  end if;

  -- Los dos bloques, anulados en su fecha.
  perform public._dl1_anular(v_e, v_julio, 'Julio', v_b31, 'DL1·24: cada liquidación de Uber se compensa en su fecha.', date '2026-10-31');
  perform public._dl1_anular(v_e, v_julio, 'Julio', v_b05, 'DL1·24: cada liquidación de Uber se compensa en su fecha; las facturas de noviembre, otra vez a 05/11.', date '2026-11-05');

  -- 3. Las 17, por el camino de la pantalla.
  for r in select x.* from dl1_uber_liq x where x.apuntar loop
    perform public._conta_proponer_plataforma(v_e, r.liq, 'Julio (tanda DL1)');
    select e.id into v_id from public.journal_entry e
     where e.company_id = v_e and e.source_type = 'channel_settlement' and e.source_id = r.liq and e.status = 'propuesto';
    if v_id is null
       or (select count(*) from public.journal_line l join public.company_account a on a.id = l.company_account_id
            where l.entry_id = v_id and ((a.code = '41000003' and l.debit = r.importe) or (a.code = '43000002' and l.credit = r.importe))) <> 2
       or (select count(*) from public.journal_line where entry_id = v_id) <> 2
       or (select entry_date from public.journal_entry where id = v_id) > date '2026-10-31' then
      raise exception 'DL1 Uber octubre: la propuesta de % no es la compensación de % en octubre (Debe 41000003 / Haber 43000002): no se apunta nada.', r.liq, r.importe;
    end if;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.importe);
  end loop;

  -- 4. Las facturas de octubre que no compensa ninguna liquidación.
  select count(*), sum(s.grand_total), string_agg(right(s.invoice_number, 7) || ' ' || to_char(s.grand_total, 'FM999990.00'), ', ' order by s.invoice_date, s.invoice_number)
    into v_resto_n, v_resto, v_lista
    from public.supplier_invoice s
   where s.account_id = v_acc and s.invoice_number like 'B88515200-%' and s.discarded_at is null
     and s.invoice_date between date '2026-10-01' and date '2026-10-31'
     and not exists (select 1 from public.channel_settlement c join public.journal_entry e on e.source_type = 'channel_settlement' and e.source_id = c.id and e.status = 'validado'
                      where c.commission_invoice_id = s.id)
     and s.id not in (select fac from dl1_uber_liq where apuntar);
  if v_resto_n <> 23 or v_resto <> 3012.73 then
    raise exception 'DL1 Uber octubre: las facturas de octubre sin liquidación son % por % (se midieron 23 por 3.012,73): no se apunta nada.', v_resto_n, v_resto;
  end if;
  v_id := public._dl1_asiento_iva(v_e, date '2026-10-31', 4, 'Facturas de Uber de octubre sin liquidación que cuadre, compensadas a 31/10',
    'DL1·24 (Julio, 13/11): ' || v_resto_n || ' facturas de Portier de octubre sin una liquidación que cuadre: ' || v_lista || '.',
    jsonb_build_array(jsonb_build_object('cuenta', '41000003', 'debe', v_resto, 'tercero', v_uber),
                      jsonb_build_object('cuenta', '43000002', 'haber', v_resto, 'tercero', v_uber)));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', v_resto);

  -- 5. Las de noviembre del 4/3351, otra vez a 05/11.
  select count(*), sum(s.grand_total), string_agg(right(s.invoice_number, 7), ', ' order by s.invoice_date, s.invoice_number)
    into v_nov_n, v_nov, v_nov_lista
    from public.supplier_invoice s join public.journal_entry j on j.id = s.journal_entry_id
   where s.account_id = v_acc and s.invoice_number like 'B88515200-%' and s.discarded_at is null
     and s.invoice_date between date '2026-11-01' and date '2026-11-04' and j.entry_date = date '2026-11-05';
  if v_nov_n <> 15 or v_nov <> 1794.73 then
    raise exception 'DL1 Uber octubre: las facturas de noviembre del 4/3351 son % por % (se midieron 15 por 1.794,73): no se apunta nada.', v_nov_n, v_nov;
  end if;
  v_id := public._dl1_asiento_iva(v_e, date '2026-11-05', 4, 'Facturas de Uber del 03–04/11 compensadas con sus liquidaciones (asientos del 05/11)',
    'DL1·24 (Julio, 13/11): la parte de noviembre del 4/3351, anulado para compensar octubre liquidación a liquidación: ' || v_nov_lista || '.',
    jsonb_build_array(jsonb_build_object('cuenta', '41000003', 'debe', v_nov, 'tercero', v_uber),
                      jsonb_build_object('cuenta', '43000002', 'haber', v_nov, 'tercero', v_uber)));
  v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', v_nov);

  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Uber octubre: % asientos validados como Julio (17 liquidaciones, el resto de octubre y la parte de noviembre).', v_n;
end $$;
