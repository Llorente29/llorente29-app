-- scripts/conta/produccion/cuentas/r05-dia-tpv.sql
--
-- R05 · Un día del TPV se valida como uno de Folvy (1601, 1602) · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La 1601 añade una columna a conta_tpv_dia y un disparador a journal_entry (solo
-- escribe al anular un asiento de ventas del día con día del TPV); la 1602, cuatro funciones nuevas.
-- No cambia ni una fila: se mide que los asientos de ventas del día y sus estados siguen igual, y los
-- días del TPV. Las cifras son de la TABLA ENTERA, a propósito (regla 9, excepción: la huella de «esto
-- no se ha movido»), y se etiquetan como tal.
-- Corte fijo (el #241): solo lo creado antes del 17/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  -- corte: asientos de ventas del día creados antes del 17/11 a las 00:00
  select 1 o, 'tabla entera · journal_entry sales_day ' || status clave, count(*)::text valor
    from public.journal_entry where source_type = 'sales_day' and created_at < timestamptz '2026-11-17 00:00:00+01' group by status
  union all
  -- corte: días del TPV subidos antes del 17/11 a las 00:00
  select 2, 'tabla entera · conta_tpv_dia ' || estado, count(*)::text
    from public.conta_tpv_dia where subido_en < timestamptz '2026-11-17 00:00:00+01' group by estado
) t order by o, clave;
