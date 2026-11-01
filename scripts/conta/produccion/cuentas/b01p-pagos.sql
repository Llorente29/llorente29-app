-- scripts/conta/produccion/cuentas/b01p-pagos.sql
--
-- B01 Revolut · PR 2a (01/11) · LO QUE CUENTA LA TANDA DE LA BASE DEL «PAGAR»,
-- antes y después. SOLO LEE. Lo de las facturas y las remesas es de Foodint
-- (regla 9), con un corte fijo; lo de las tablas y funciones nuevas es de la
-- base entera, y se dice. Las tablas nuevas solo se nombran dentro de cadenas.
-- Lo que tiene que cambiar: las tablas del «Pagar» (0 → 8 de 8) y sus funciones
-- (0 → 37). Lo demás, igual: nadie puede pagar todavía (no hay ningún permiso
-- hasta que un administrador pulse «Activar pagos», 2c), y las facturas por
-- pagar y las remesas de Foodint no se mueven.
select clave, valor from (
  select 1 o, 'tablas del «Pagar» (base entera)' clave,
    (select count(*) from unnest(array['conta_pago_permiso', 'conta_pago_ajustes', 'conta_pago_lote', 'conta_pago_salida', 'conta_pago_evento',
                                       'conta_llave', 'conta_pago_reto', 'conta_pago_pin']) t where to_regclass('public.' || t) is not null) || ' de 8' valor union all
  select 2, 'funciones del «Pagar» (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and (proname like 'conta\_pago\_%' and proname <> 'conta_pago_a_mano' or proname like '\_conta\_pago\_%' or proname like 'conta\_llave%'))::text union all
  select 3, 'facturas recibidas de Foodint aprobadas y sin pagar, hasta el corte',
    -- quieta: la tanda no paga ni toca ninguna factura
    (select count(*) || ' · ' || coalesce(sum(grand_total), 0) from public.supplier_invoice
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'aprobada' and paid_at is null and created_at < timestamptz '2026-11-01 14:00:00+00') union all
  select 4, 'remesas de pagos de Foodint, hasta el corte',
    -- quieta: la tanda no crea remesas
    (select count(*)::text from public.conta_pago_remesa where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 14:00:00+00')
) t order by o;
