-- scripts/conta/produccion/cuentas/b01o-olimpo.sql
--
-- B01 · Cola 2 (02/11) · LO QUE CUENTA LA TANDA DE OLIMPO, antes y después.
-- SOLO LEE, solo Foodint (regla 9). Es una tanda sin vuelta atrás: el ensayo
-- comprueba que después cada medida es su «esperado:». Cada medida cuenta LO
-- QUE FALTA POR ARREGLAR: en producción pasa de 1 o 2 a 0; en staging (sin
-- Foodint) es 0 antes y después. Así el mismo «esperado: … = 0» vale en los dos.
-- Todas leen filas concretas por su id (o, la 6, los casados con una factura
-- anulada): solo las cambia esta tanda.
select clave, valor from (
  select 1 o, 'la 26A/10966 sin pagar el 26/10' clave,
    -- quieta: una factura concreta, por su id; solo la paga esta tanda
    (select count(*)::text from public.supplier_invoice where id = 'e33d20d2-45d6-479e-b5ea-89f338299bb4'
      and not (status = 'pagada' and paid_at = date '2026-10-26')) valor union all
  select 2, 'la 26A/10965 sin pagar el 26/10',
    -- quieta: una factura concreta, por su id; solo la paga esta tanda
    (select count(*)::text from public.supplier_invoice where id = '8f11ef90-8535-4d24-882c-5a1d743c5d43'
      and not (status = 'pagada' and paid_at = date '2026-10-26')) union all
  select 3, 'el −363,67 del 26/10 casado con lo que no es la 26A/10966',
    -- quieta: los casados de un movimiento concreto, por su id; solo los cambia esta tanda
    (select count(*)::text from public.bank_match bm where bm.movement_id = '0e62eb54-1b29-463a-a67f-242c03174f0a' and bm.status = 'vivo'
      and not exists (select 1 from public.bank_match_item it where it.match_id = bm.id and it.supplier_invoice_id = 'e33d20d2-45d6-479e-b5ea-89f338299bb4')) union all
  select 4, 'el −170,10 del 26/10 casado con lo que no es la 26A/10965',
    -- quieta: los casados de un movimiento concreto, por su id; solo los cambia esta tanda
    (select count(*)::text from public.bank_match bm where bm.movement_id = '910ca451-c900-4fe4-97b0-9afd40cc287d' and bm.status = 'vivo'
      and not exists (select 1 from public.bank_match_item it where it.match_id = bm.id and it.supplier_invoice_id = '8f11ef90-8535-4d24-882c-5a1d743c5d43')) union all
  select 5, 'los asientos 4/3312 y 4/3310 sin anular',
    -- quieta: dos asientos concretos, por su id; solo los anula esta tanda
    (select count(*)::text from public.journal_entry where id in ('cb8a8506-0110-4d20-9303-2e4a91e91e0f', '68821b3e-a0ce-4ac1-8132-312a6b3173a9') and status <> 'anulado') union all
  select 6, 'casados vivos de Foodint con una factura anulada o descartada',
    -- quieta: hoy solo hay uno (el de Olimpo) y lo deshace esta tanda; uno nuevo a mitad del ensayo sería otro error que hay que ver
    (select count(distinct bm.id)::text from public.bank_match bm join public.bank_match_item it on it.match_id = bm.id join public.supplier_invoice si on si.id = it.supplier_invoice_id
      where bm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and bm.status = 'vivo' and (si.status in ('anulada', 'descartada') or si.discarded_at is not null)) union all
  select 7, 'la 26/13028 con asiento de pago',
    -- quieta: una factura concreta, por su id; solo le quita el asiento de pago esta tanda
    (select count(*)::text from public.supplier_invoice where id = '37060996-e406-4046-9a5d-c45bf94a260c' and payment_entry_id is not null)
) t order by o;
