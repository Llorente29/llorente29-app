-- scripts/conta/produccion/cuentas/q08-decisiones-qbo.sql
--
-- Q08 · Paso 2 (24/11) · LO QUE CUENTA LA TANDA DE «CARGAR DECISIONES DE QBO», antes y después. SOLO LEE.
-- La tanda no escribe filas: añade dos funciones. Lo que tiene que cambiar: las funciones (no existen → existen).
-- Lo demás, igual: las facturas de venta de antes de un corte fijo. conta_gc_enlace no va aquí por filas: la lectura de
-- GoCardless la reescribe en cualquier momento, y lo que cambia al cargar el Excel lo cuenta el parte, antes y después.
-- quieta: las facturas de venta de antes del corte del 24/11 a las 10:00 UTC.
select clave, valor from (
  select 1 o, 'funciones nuevas del Q08 (decisión de fuera · pendiente de fuera)' clave,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('conta_gc_enlace_decision_externa', 'conta_gc_enlace_pendiente_externo'))::text valor union all
  select 2, 'facturas de venta de antes del corte (base entera)',
    (select count(*) from public.customer_invoice where created_at < timestamptz '2026-11-24 10:00:00+00')::text
) t order by o;
