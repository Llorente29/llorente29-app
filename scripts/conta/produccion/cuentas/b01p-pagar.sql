-- scripts/conta/produccion/cuentas/b01p-pagar.sql
--
-- B01 · Cola 1e (02/11) · LO QUE CUENTA LA TANDA DE PAGAR, antes y después.
-- SOLO LEE. Las funciones y la tabla, de la base entera; lo de Foodint (regla 9), con corte.
-- Lo que tiene que cambiar: las funciones nuevas (0 → 1, y 0 → 6), la tabla y la
-- casilla del proveedor (0 → 1). Lo demás, igual: la tanda no toca ninguna factura
-- ni ningún proveedor.
select clave, valor from (
  select 1 o, 'conta_pagos_por_revisar (base entera)' clave,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_pagos_por_revisar')::text valor union all
  select 2, 'funciones del justificante (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('conta_pago_justificante_por_hacer', 'conta_pago_justificante_datos',
      'conta_pago_justificante_guardar', 'conta_pago_justificante_correo', 'conta_justificante_publico', 'conta_factura_justificantes'))::text union all
  select 3, 'tabla conta_pago_justificante y columna supplier.justificante_al_pagar (base entera)',
    ((to_regclass('public.conta_pago_justificante') is not null)::int
     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'justificante_al_pagar'))::text union all
  select 4, 'facturas recibidas de Foodint por estado, hasta el corte',
    -- quieta: la tanda no toca ninguna factura
    (select string_agg(status || '=' || n, ', ' order by status) from (select status, count(*) n from public.supplier_invoice
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-02 21:00:00+00' group by status) x) union all
  select 5, 'proveedores de Foodint, hasta el corte',
    -- quieta: la tanda no toca ningún proveedor (la columna nueva nace nula)
    (select count(*) from public.supplier where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-02 21:00:00+00')::text
) t order by o;
