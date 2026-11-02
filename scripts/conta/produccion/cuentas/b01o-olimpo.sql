-- scripts/conta/produccion/cuentas/b01o-olimpo.sql
--
-- B01 · Cola 2 (02/11) · LO QUE CUENTA LA TANDA DE OLIMPO, antes y después.
-- SOLO LEE, solo Foodint (regla 9). Es una tanda sin vuelta atrás: el ensayo
-- comprueba que después cada medida es la «esperado:» del manifiesto.
select clave, valor from (
  select 1 o, 'la 26A/10966: estado y día de pago' clave,
    (select status || ' ' || coalesce(paid_at::text, 'sin pagar') from public.supplier_invoice where id = 'e33d20d2-45d6-479e-b5ea-89f338299bb4') valor union all
  select 2, 'la 26A/10965: estado y día de pago',
    (select status || ' ' || coalesce(paid_at::text, 'sin pagar') from public.supplier_invoice where id = '8f11ef90-8535-4d24-882c-5a1d743c5d43') union all
  select 3, 'el −363,67 del 26/10: con qué está casado',
    (select coalesce(string_agg(bm.kind || ' ' || coalesce(si.invoice_number, '(sin factura)'), ', '), 'nada')
       from public.bank_match bm left join public.bank_match_item it on it.match_id = bm.id left join public.supplier_invoice si on si.id = it.supplier_invoice_id
      where bm.movement_id = '0e62eb54-1b29-463a-a67f-242c03174f0a' and bm.status = 'vivo') union all
  select 4, 'el −170,10 del 26/10: con qué está casado',
    (select coalesce(string_agg(bm.kind || ' ' || coalesce(si.invoice_number, '(sin factura)'), ', '), 'nada')
       from public.bank_match bm left join public.bank_match_item it on it.match_id = bm.id left join public.supplier_invoice si on si.id = it.supplier_invoice_id
      where bm.movement_id = '910ca451-c900-4fe4-97b0-9afd40cc287d' and bm.status = 'vivo') union all
  select 5, 'los asientos 4/3312 y 4/3310',
    (select string_agg(series || '/' || number || ' ' || status, ', ' order by number desc) from public.journal_entry
      where id in ('cb8a8506-0110-4d20-9303-2e4a91e91e0f', '68821b3e-a0ce-4ac1-8132-312a6b3173a9')) union all
  select 6, 'casados vivos de Foodint con una factura anulada o descartada',
    (select count(distinct bm.id)::text from public.bank_match bm join public.bank_match_item it on it.match_id = bm.id join public.supplier_invoice si on si.id = it.supplier_invoice_id
      where bm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and bm.status = 'vivo' and (si.status in ('anulada', 'descartada') or si.discarded_at is not null)) union all
  select 7, 'la 26/13028: estado y asiento de pago',
    (select status || ' ' || case when payment_entry_id is null then 'sin asiento de pago' else 'con asiento de pago' end from public.supplier_invoice where id = '37060996-e406-4046-9a5d-c45bf94a260c')
) t order by o;
