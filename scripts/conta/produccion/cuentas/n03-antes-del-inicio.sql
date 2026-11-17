-- scripts/conta/produccion/cuentas/n03-antes-del-inicio.sql
--
-- N03 · Una factura de antes del día de inicio (0955, 0956) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0955 solo añade (tres columnas que admiten nulos y cuatro funciones) y la 0956 cambia tres funciones
-- con la misma firma: no cambia ni una fila. Se mide que todo sigue igual, con corte fijo (el #241): lo
-- creado antes del 17/11/2026 a las 00:00 de Madrid. Cifras de la TABLA ENTERA, a propósito (regla 9,
-- excepción: la huella de «esto no se ha movido»), y se etiquetan como tal.
select clave, valor from (
  -- corte: facturas recibidas creadas antes del 17/11 a las 00:00
  select 1 o, 'tabla entera · supplier_invoice ' || status clave, count(*)::text valor
    from public.supplier_invoice where created_at < timestamptz '2026-11-17 00:00:00+01' group by status
  union all
  -- corte: asientos de facturas recibidas creados antes del 17/11 a las 00:00
  select 2, 'tabla entera · asientos de recibidas ' || status, count(*)::text
    from public.journal_entry where source_type = 'supplier_invoice' and created_at < timestamptz '2026-11-17 00:00:00+01' group by status
) t order by o, clave;
