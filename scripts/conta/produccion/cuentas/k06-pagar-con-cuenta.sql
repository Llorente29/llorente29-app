-- scripts/conta/produccion/cuentas/k06-pagar-con-cuenta.sql
--
-- K06 · El pago de una recibida con otra cuenta (0840) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La tanda añade una función nueva y no cambia ninguna otra. Se mide que los pagos de
-- las recibidas y lo que Bancos ve como pagado siguen igual (tabla entera, a propósito: regla 9,
-- excepción). Corte fijo (el #241): lo creado antes del 21/11/2026 a las 00:00 de Madrid.
-- Y lo que pidió Julio (20/11) para el parte, sin arreglarlo aquí: en Foodint (por su cuenta, regla 9),
-- las recibidas de plataforma ligadas a su liquidación que están validadas y sin pagar, y cuántas de
-- ellas tienen la liquidación con la referencia igual a su número (S01o «por su número»: en la base
-- local, al aprobarla, el disparador la da por ligada y no la paga).
select clave, valor from (
  select 1 o, 'tabla entera · supplier_invoice_payment (filas · importe)' clave,
         count(*)::text || ' · ' || coalesce(sum(amount), 0)::text valor
    from public.supplier_invoice_payment where created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 2, 'tabla entera · supplier_invoice pagadas', count(*)::text
    from public.supplier_invoice where status = 'pagada' and created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 3, 'funciones · _bank_recibida_pagado (md5)', md5(pg_get_functiondef('public._bank_recibida_pagado(uuid)'::regprocedure))
  union all
  select 4, 'Foodint · recibidas ligadas a su liquidación: todas · pagadas · validadas sin pagar',
         count(*)::text || ' · ' || count(*) filter (where si.status = 'pagada')::text || ' · ' || count(*) filter (where si.status = 'aprobada' and si.paid_at is null)::text
    from public.supplier_invoice si join public.channel_settlement_invoice k on k.supplier_invoice_id = si.id and k.account_id = si.account_id
   where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 5, 'Foodint · de las validadas sin pagar, con la referencia de su liquidación igual a su número',
         count(*)::text
    from public.supplier_invoice si join public.channel_settlement_invoice k on k.supplier_invoice_id = si.id and k.account_id = si.account_id
    join public.channel_settlement cs on cs.id = k.settlement_id and cs.account_id = si.account_id
   where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.created_at < timestamptz '2026-11-21 00:00:00+01'
     and si.status = 'aprobada' and si.paid_at is null and cs.settlement_ref = si.invoice_number
) t order by o, clave;
