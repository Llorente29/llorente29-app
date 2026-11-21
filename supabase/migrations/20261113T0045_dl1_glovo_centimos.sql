-- supabase/migrations/20261113T0045_dl1_pagadas.sql
--
-- DL1 · Facturas pagadas que Pagos enseñaba «por pagar» (Julio, DL1·21, 13/11).
-- De las tres cosas del encargo, esta tanda hace una; las otras dos no tienen
-- un camino en la aplicación que no rompa algo, y van en el informe:
--   · Coheldi: sus pagos son asientos traídos de Diez y sus movimientos del
--     banco son de antes del corte (bank_casar solo los enlaza con un asiento,
--     sin factura); marcarla pagada a mano no se puede (PC01).
--   · La factura 195: casarla en Bancos pide deshacer el casado del 4/3178, y
--     bank_deshacer lo anula con fecha de hoy: la 57200001 a 31/10 llevaría el
--     pago dos veces.
--
-- Lo que hace: valida como Julio las tres compensaciones de Glovo del 16/10 que
-- difieren 0,01 de su factura (I170326000547001, I170326000544739 e
-- I170326000541469). Julio acepta los 0,03, que quedan en la 41000002. No crea
-- ni cambia ningún objeto.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_ids jsonb := '[]'::jsonb; v_n int; r record;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 compensaciones: sin la cuenta de Foodint, no hay nada que validar.';
    return;
  end if;
  for r in select * from (values
      ('f6198b69-5d00-4c0d-a5f9-01efe4e5ef34'::uuid, 'I170326000547001', 448.05),
      ('5f1033e2-fc29-48bb-8706-9fdd94f80c0a', 'I170326000544739', 21.45),
      ('6c08951f-efd7-4952-93ac-de3d69b586c9', 'I170326000541469', 402.77)
    ) x(id, ref, importe) loop
    if not exists (select 1 from public.journal_entry e join public.channel_settlement c on c.id = e.source_id
                    where e.id = r.id and e.company_id = v_e and e.status = 'propuesto' and e.source_type = 'channel_settlement'
                      and e.entry_date = date '2026-10-16' and c.settlement_ref = r.ref)
       or (select count(*) from public.journal_line l join public.company_account a on a.id = l.company_account_id
            where l.entry_id = r.id and ((a.code = '41000002' and l.debit = r.importe) or (a.code = '43000001' and l.credit = r.importe))) <> 2
       or (select count(*) from public.journal_line where entry_id = r.id) <> 2 then
      raise exception 'DL1 compensaciones: la % no está como se midió (propuesta, 41000002/43000001 por %): no se valida nada.', r.ref, r.importe;
    end if;
    v_ids := v_ids || jsonb_build_object('id', r.id, 'importe', r.importe);
  end loop;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 compensaciones: % validadas como Julio; 0,03 quedan en la 41000002.', v_n;
end $$;
