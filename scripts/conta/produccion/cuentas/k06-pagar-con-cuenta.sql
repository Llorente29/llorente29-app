-- scripts/conta/produccion/cuentas/k06-pagar-con-cuenta.sql
--
-- K06 · El pago de una recibida con otra cuenta (0840) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La tanda añade una función nueva y no cambia ninguna otra. Se mide que los pagos de
-- las recibidas y lo que Bancos ve como pagado siguen igual (tabla entera, a propósito: regla 9,
-- excepción). Corte fijo (el #241): lo creado antes del 21/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · supplier_invoice_payment (filas · importe)' clave,
         count(*)::text || ' · ' || coalesce(sum(amount), 0)::text valor
    from public.supplier_invoice_payment where created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 2, 'tabla entera · supplier_invoice pagadas', count(*)::text
    from public.supplier_invoice where status = 'pagada' and created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 3, 'funciones · _bank_recibida_pagado (md5)', md5(pg_get_functiondef('public._bank_recibida_pagado(uuid)'::regprocedure))
) t order by o, clave;
