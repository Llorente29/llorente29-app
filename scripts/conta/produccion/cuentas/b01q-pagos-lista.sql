-- scripts/conta/produccion/cuentas/b01q-pagos-lista.sql
--
-- B01 · Respuesta 15 (03/11) · LO QUE CUENTA LA TANDA DE PAGOS RÁPIDO, antes y después.
-- SOLO LEE. Las funciones, de la base entera; lo de Foodint (regla 9), con corte.
-- Lo que tiene que cambiar: las dos funciones pasan a SECURITY DEFINER (0 → 2) y
-- dejan de poder llamarlas anon y PUBLIC (1 → 0). Lo demás, igual: la tanda no
-- toca ninguna factura ni ningún pago.
select clave, valor from (
  select 1 o, 'conta_pagos_lista y conta_pagos_por_revisar con SECURITY DEFINER (base entera)' clave,
    (select count(*) from pg_proc where oid in ('public.conta_pagos_lista(uuid,date)'::regprocedure, 'public.conta_pagos_por_revisar(uuid)'::regprocedure) and prosecdef)::text valor union all
  select 2, 'de las dos, las que puede llamar anon (base entera)',
    (select count(*) from (values ('public.conta_pagos_lista(uuid,date)'), ('public.conta_pagos_por_revisar(uuid)')) f(n) where has_function_privilege('anon', f.n, 'execute'))::text union all
  select 3, 'facturas recibidas de Foodint por estado, hasta el corte',
    -- quieta: la tanda no toca ninguna factura
    (select string_agg(status || '=' || n, ', ' order by status) from (select status, count(*) n from public.supplier_invoice
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-03 17:00:00+00' group by status) x) union all
  select 4, 'pagos de facturas de Foodint, hasta el corte',
    -- quieta: la tanda no toca ningún pago
    (select count(*) || ' · ' || coalesce(sum(amount), 0) from public.supplier_invoice_payment
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-03 17:00:00+00')::text
) t order by o;
