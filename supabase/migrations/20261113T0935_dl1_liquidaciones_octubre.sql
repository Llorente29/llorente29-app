-- supabase/migrations/20261113T0935_dl1_liquidaciones_octubre.sql
--
-- DL1 · Las liquidaciones de plataformas que tocan octubre y no tenían su
-- asiento (Julio, DL1·23, 13/11). De las 42, se apuntan las 12 cuya propuesta
-- cuadra al céntimo con su factura de comisión, por el camino de la aplicación:
-- _conta_proponer_plataforma (el del disparador y la pasada de noche) propone
-- la compensación de la comisión contra la cuenta de la plataforma, como las 13
-- de Glovo del 01–15/10, y se valida como Julio (_dl1_validar).
--   Glovo 16–31/10 (9): 62,47 · 453,19 · 27,68 · 47,22 · 30,86 · 45,78 · 227,35 ·
--     490,95 · 16,95 (a 01/11, la fecha de la liquidación).
--   Just Eat 16–31/10 (2): 54,00 y 57,75 (a 07/11).
--   Uber 19–25/10 (1): 11,98 (a 26/10).
-- Fuera, y en el informe: la de Glovo I170326000551592 (propone 406,81 y su
-- factura es de 577,42), 5 de Uber que no cuadran con su factura, el abono de
-- Just Eat 4126387 (−5,98, neto 0) y las 23 de Uber que la aplicación no propone
-- (tienda sin asignar, sin factura de comisión o por aclarar).
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  r record; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 liquidaciones: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  for r in select * from (values
      ('9898413d-3e24-434c-a653-3e9c7f97239f'::uuid, 62.47, '41000002', '43000001'),
      ('7c336ed5-3825-4177-b1a8-11068b16a7a7', 453.19, '41000002', '43000001'),
      ('0a36579b-883e-4816-a188-12b78aa5f5ec', 27.68, '41000002', '43000001'),
      ('509360e3-0116-45dc-a71d-2ec15ab08da2', 47.22, '41000002', '43000001'),
      ('3476eeba-ee42-4bc4-ae1e-5bf5cecbbc3b', 30.86, '41000002', '43000001'),
      ('514868a1-a61c-4dbb-a016-b968044b1aa2', 45.78, '41000002', '43000001'),
      ('d6ecc55f-6bb5-4042-818e-3a7f1266d978', 227.35, '41000002', '43000001'),
      ('80a20dfb-7c7d-4cf3-9db2-37369acc4b72', 490.95, '41000002', '43000001'),
      ('6fa3dcae-ba1f-441d-a5cc-d1fb7c40c850', 16.95, '41000002', '43000001'),
      ('3e1fa8d7-ec67-49c8-9209-0a94f58add16', 54.00, '41000004', '43000003'),
      ('31c67dd0-d6c5-4975-a706-51ddc89a5050', 57.75, '41000004', '43000003'),
      ('2431b50f-0449-41ce-933a-d563ceb3a988', 11.98, '41000003', '43000002')
    ) x(liq, importe, acreedor, cliente) loop
    if exists (select 1 from public.journal_entry where company_id = v_e and source_type = 'channel_settlement' and source_id = r.liq and status <> 'anulado')
       or not exists (select 1 from public.channel_settlement c join public.supplier_invoice s on s.id = c.commission_invoice_id
                       where c.id = r.liq and c.account_id = v_acc and s.grand_total = r.importe) then
      raise exception 'DL1 liquidaciones: la liquidación % ya tiene asiento o su factura de comisión no es de %: no se apunta nada.', r.liq, r.importe;
    end if;
    perform public._conta_proponer_plataforma(v_e, r.liq, 'Julio (tanda DL1)');
    select e.id into v_id from public.journal_entry e
     where e.company_id = v_e and e.source_type = 'channel_settlement' and e.source_id = r.liq and e.status = 'propuesto';
    if v_id is null
       or (select count(*) from public.journal_line l join public.company_account a on a.id = l.company_account_id
            where l.entry_id = v_id and ((a.code = r.acreedor and l.debit = r.importe) or (a.code = r.cliente and l.credit = r.importe))) <> 2
       or (select count(*) from public.journal_line where entry_id = v_id) <> 2 then
      raise exception 'DL1 liquidaciones: la propuesta de % no es la compensación de % (Debe % / Haber %): no se apunta nada.', r.liq, r.importe, r.acreedor, r.cliente;
    end if;
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.importe);
  end loop;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 liquidaciones: % compensaciones apuntadas y validadas como Julio.', v_n;
end $$;
