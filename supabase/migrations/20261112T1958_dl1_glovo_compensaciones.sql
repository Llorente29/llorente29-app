-- supabase/migrations/20261112T1958_dl1_glovo_compensaciones.sql
--
-- DL1 · Octubre de Llorente29: las compensaciones de Glovo del 01–15/10 (Julio,
-- DL1·19, 12/11). Cada liquidación de Glovo de esa quincena tiene su asiento
-- propuesto del 16/10: Debe 41000002 (la factura de comisión de Glovo, ya
-- contabilizada en la 2/3309–2/3322) / Haber 43000001, por la comisión. No
-- duplican nada («aquí solo se compensa») y la validación no les pone ningún
-- motivo: se validan como Julio (_dl1_validar, journal_entry_validar).
--
-- Solo las 10 que casan al céntimo con su factura. Tres no (448,05 contra
-- 448,06; 21,45 contra 21,46; 402,77 contra 402,78): se quedan propuestas y van
-- en el informe. Las 12 ventas del día de Glovo de Carabanchel tampoco se
-- tocan: tienen envíos por aclarar y se validan con su PDF.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  r record; v_ids jsonb := '[]'::jsonb; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Glovo: sin la cuenta de Foodint, no hay nada que validar.';
    return;
  end if;
  for r in select * from (values
      ('106fdbeb-4f44-4cc8-bd54-986dc92ac998'::uuid, 'I170326000537098', 25.19),
      ('ff418538-0873-4118-bc4a-0d87d859d0e3', 'I170326000540680', 43.23),
      ('5fdaed3b-94bc-49a8-9a26-ef5956a45fbe', 'I170326000544202', 37.17),
      ('8891cbd3-b6d1-4218-a455-a1cefd584d79', 'I170326000544453', 5.20),
      ('79215592-7bd2-45a6-b627-4b3685d39b74', 'I170326000544676', 102.02),
      ('99051fa6-9c68-484b-aa9e-421e1052af26', 'I170326000544855', 114.16),
      ('c9bf98c9-0c87-4d95-a60c-5a3ae49e1aab', 'I170326000545597', 262.85),
      ('e09eaa1a-64f0-4fae-9156-1f8e88579159', 'I170326000546269', 10.26),
      ('19f0e54e-d45b-4d08-a98f-94296e02b8a0', 'I170326000549795', 7.14),
      ('c9cc6381-a261-41e7-8d28-e1402e245326', 'I170326000552348', 5.52)
    ) x(id, ref, importe) loop
    if not exists (
        select 1 from public.journal_entry e join public.channel_settlement c on c.id = e.source_id
         where e.id = r.id and e.company_id = v_e and e.status = 'propuesto' and e.source_type = 'channel_settlement'
           and e.entry_date = date '2026-10-16' and c.settlement_ref = r.ref)
       or (select count(*) from public.journal_line l join public.company_account a on a.id = l.company_account_id
            where l.entry_id = r.id and ((a.code = '41000002' and l.debit = r.importe) or (a.code = '43000001' and l.credit = r.importe))) <> 2
       or (select count(*) from public.journal_line where entry_id = r.id) <> 2
       or not exists (select 1 from public.journal_entry f join public.journal_line l on l.entry_id = f.id join public.company_account a on a.id = l.company_account_id
                       where f.company_id = v_e and f.status = 'validado' and f.document_ref = r.ref and a.code = '41000002' and l.credit = r.importe) then
      raise exception 'DL1 Glovo: la compensación % no está como se midió (propuesta, 41000002/43000001 por % y su factura validada por lo mismo): no se valida nada.', r.ref, r.importe;
    end if;
    v_ids := v_ids || jsonb_build_object('id', r.id, 'importe', r.importe);
  end loop;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Glovo: % compensaciones validadas como Julio.', v_n;
end $$;
