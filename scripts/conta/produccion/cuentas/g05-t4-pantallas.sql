-- scripts/conta/produccion/cuentas/g05-t4-pantallas.sql
--
-- G05 · T4 · Lo que necesita el modelo de factura «Sumied» · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Todas las cuentas a propósito (la tanda es de la estructura), con un corte
-- fijo (antes del 09/11 a las 00:00 UTC) en lo que se cuenta.
-- Medido antes el 09/11 a las 12:50 UTC (solo lectura). Lo que tiene que pasar:
--   1. conta_servicio.incluye existe: false → true.
--   2. conta_gc_mandato.cuenta_final existe: false → true.
--   3. La pantalla de clientes devuelve el «incluye» de los servicios: false → true.
--   4. Servicios (todas las cuentas, hasta el corte): 31 → 31.
--   5. Mandatos de GoCardless (todas las cuentas): 2099 → 2099.
--   6. La lectura de la ficha de la factura de un recibo existe (1403): false → true.
--   7. La tabla de los pagos de GoCardless al banco existe (1426): false → true.
--   8. Cobros de GoCardless (todas las cuentas): quieta, la lectura los escribe; la 1426 solo añade una columna vacía.
select clave, valor from (
  select 1 o, 'conta_servicio.incluye existe' clave,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_servicio' and column_name = 'incluye')::text valor union all
  select 2, 'conta_gc_mandato.cuenta_final existe',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_mandato' and column_name = 'cuenta_final')::text union all
  select 3, 'La pantalla de clientes devuelve el «incluye» de los servicios',
    (select (p.prosrc like '%''incluye'', x.incluye) order by x.id)%')::text from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.conta_pantalla_clientes(uuid)')) union all
  select 4, 'Servicios (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_servicio where created_at < timestamptz '2026-11-09 00:00:00+00') union all
  select 5, 'Mandatos de GoCardless (todas las cuentas)',
    -- quieta: los escribe la lectura de GoCardless; la tanda no los toca (solo añade columnas que nacen vacías)
    (select count(*)::text from public.conta_gc_mandato) union all
  select 6, 'La lectura de la ficha de la factura de un recibo existe',
    (to_regprocedure('public.conta_pantalla_factura_recibo(uuid,uuid)') is not null)::text union all
  select 7, 'La tabla de los pagos de GoCardless al banco existe',
    (to_regclass('public.conta_gc_payout') is not null)::text union all
  select 8, 'Cobros de GoCardless (todas las cuentas)',
    -- quieta: los escribe la lectura de GoCardless; la tanda no los toca (solo añade una columna que nace vacía)
    (select count(*)::text from public.conta_gc_cobro)
) q order by o;
