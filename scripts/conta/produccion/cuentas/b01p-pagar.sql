-- scripts/conta/produccion/cuentas/b01p-pagar.sql
--
-- B01 · Cola 1e (02/11) · LO QUE CUENTA LA TANDA DE PAGAR, antes y después.
-- SOLO LEE. La función, de la base entera; lo de Foodint (regla 9), con corte.
-- Lo que tiene que cambiar: la función nueva (0 → 1). Lo demás, igual: la tanda
-- no toca ninguna factura.
select clave, valor from (
  select 1 o, 'conta_pagos_por_revisar (base entera)' clave,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_pagos_por_revisar')::text valor union all
  select 2, 'facturas recibidas de Foodint por estado, hasta el corte',
    -- quieta: la tanda no toca ninguna factura
    (select string_agg(status || '=' || n, ', ' order by status) from (select status, count(*) n from public.supplier_invoice
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-02 21:00:00+00' group by status) x)
) t order by o;
