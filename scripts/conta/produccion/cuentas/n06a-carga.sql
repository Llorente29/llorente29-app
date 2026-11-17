-- scripts/conta/produccion/cuentas/n06a-carga.sql
--
-- N06a · La carga en prueba y deshacerla (1806, 1807, 1808) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 1806 solo añade columnas que admiten nulos, la 1807 cambia cinco funciones con la misma firma y amplía un
-- CHECK, y la 1808 solo añade funciones: no cambia ni una fila. Se mide que todo sigue igual, con corte fijo (el
-- #241): lo creado antes del 17/11/2026 a las 00:00 de Madrid. Cifras de todas las cuentas, a propósito (regla 9,
-- excepción: la huella de «esto no se ha movido»), y se etiquetan como tal.
select clave, valor from (
  -- corte: lecturas de otro programa creadas antes del 17/11 a las 00:00
  select 1 o, 'todas las cuentas · lecturas ' || program || ' · ' || kind || ' · ' || status clave, count(*)::text valor
    from public.import_run where started_at < timestamptz '2026-11-17 00:00:00+01'
   group by program, kind, status
  union all
  -- corte: asientos creados antes del 17/11 a las 00:00
  select 2, 'todas las cuentas · asientos ' || source_type || ' · ' || status, count(*)::text
    from public.journal_entry where created_at < timestamptz '2026-11-17 00:00:00+01' group by source_type, status
  union all
  -- corte: recibidas creadas antes del 17/11 a las 00:00
  select 3, 'todas las cuentas · recibidas ' || source || ' · ' || status, count(*)::text
    from public.supplier_invoice where created_at < timestamptz '2026-11-17 00:00:00+01' group by source, status
  union all
  -- corte: emitidas creadas antes del 17/11 a las 00:00
  select 4, 'todas las cuentas · emitidas ' || origin || ' · ' || status, count(*)::text
    from public.customer_invoice where created_at < timestamptz '2026-11-17 00:00:00+01' group by origin, status
  union all
  -- corte: proveedores creados antes del 17/11 a las 00:00
  select 5, 'todas las cuentas · proveedores', count(*)::text
    from public.supplier where created_at < timestamptz '2026-11-17 00:00:00+01'
) t order by o, clave;
