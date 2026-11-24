-- scripts/conta/produccion/cuentas/g06-cuadre.sql
--
-- G06 · Tarea 3 (12/11) · LO QUE CUENTA LA TANDA DE LAS PROPUESTAS, antes y después. SOLO LEE.
-- La tanda no escribe filas: añade una columna, amplía un CHECK y crea o cambia funciones. Lo que tiene que cambiar:
-- las funciones (no existen → existen) y la columna antes. Lo demás, igual: las facturas de antes de un corte fijo.
-- conta_gc_enlace no va aquí por filas: la lectura de GoCardless la reescribe en cualquier momento.
select clave, valor from (
  select 1 o, 'funciones nuevas de la tarea 3 (confirmar · sin ficha · deshacer · guardar)' clave,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('conta_gc_enlace_confirmar', 'conta_gc_enlace_sin_ficha', 'conta_gc_enlace_deshacer', '_conta_gc_enlace_guardar'))::text valor union all
  select 2, 'conta_gc_enlace tiene la columna antes',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_enlace' and column_name = 'antes')::text union all
  select 3, 'facturas de venta de antes del corte (base entera)',
    (select count(*) from public.customer_invoice where created_at < timestamptz '2026-11-12 09:00:00+00')::text
) t order by o;
