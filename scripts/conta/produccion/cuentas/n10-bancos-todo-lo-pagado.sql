-- scripts/conta/produccion/cuentas/n10-bancos-todo-lo-pagado.sql
--
-- N10 · Bancos descuenta todo lo pagado (1930) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1930 cambia dos funciones con la misma firma: no cambia ni una fila. Corte fijo (el #241): lo creado antes del
-- 19/11/2026 a las 00:00 de Madrid. Cifras de todas las cuentas, a propósito (regla 9, excepción: la huella de «esto
-- no se ha movido»), y se etiquetan como tal.
--   · las recibidas sin pagos a mano: lo que propone Bancos, la misma huella antes y después (regla 31);
--   · las recibidas con pagos a mano: cuántas y lo que propone Bancos sumado (puede bajar, y es lo que se quiere);
--   · lo casado vivo en el banco sin su pago apuntado (si hay, la regla nueva lo sigue contando aparte).
with pagos_a_mano as (
  select distinct p.invoice_id from public.supplier_invoice_payment p where p.bank_match_id is null
), bancos as (
  select b.id, b.total::numeric(14,2) total, b.pagado::numeric(14,2) pagado
    from public.company co, public.bank_facturas_para_casar(co.id) b
    join public.supplier_invoice si on si.id = b.id
   where si.created_at < timestamptz '2026-11-19 00:00:00+01'
)
select clave, valor from (
  -- corte: recibidas creadas antes del 19/11 a las 00:00, sin pagos a mano
  select 1 o, 'todas las cuentas · Bancos propone · recibidas sin pagos a mano · cuántas y su huella' clave,
         count(*) || ' · ' || md5(coalesce(string_agg(b.id || '|' || b.total || '|' || b.pagado, ',' order by b.id), '')) valor
    from bancos b where b.id not in (select invoice_id from pagos_a_mano)
  union all
  -- corte: recibidas creadas antes del 19/11 a las 00:00, con pagos a mano
  select 2, 'todas las cuentas · Bancos propone · recibidas con pagos a mano · cuántas y lo que les queda', count(*) || ' · ' || coalesce(sum(b.total - b.pagado), 0)
    from bancos b where b.id in (select invoice_id from pagos_a_mano)
  union all
  -- todo: lo casado vivo en el banco sin su pago apuntado
  select 3, 'todas las cuentas · casados vivos de recibidas sin su pago apuntado', count(*)::text
    from public.bank_match_item i join public.bank_match bm on bm.id = i.match_id
   where bm.status = 'vivo' and i.supplier_invoice_id is not null
     and not exists (select 1 from public.supplier_invoice_payment x where x.bank_match_id = i.match_id and x.invoice_id = i.supplier_invoice_id)
) t order by o, clave;
