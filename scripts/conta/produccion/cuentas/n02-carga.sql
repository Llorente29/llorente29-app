-- scripts/conta/produccion/cuentas/n02-carga.sql
--
-- N02 · La carga abierta y el día de inicio (0832, 0833) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0832 solo amplía cinco CHECK y la 0833 solo añade tres columnas que admiten nulos y una función:
-- no cambia ni una fila. Se mide que todo sigue igual. Las cifras son de la TABLA ENTERA, a propósito
-- (regla 9, excepción: la huella de «esto no se ha movido» es más fuerte así), y se etiquetan como tal.
-- Corte fijo (el #241): solo lo creado antes del 17/11/2026 a las 00:00 de Madrid, para que lo que entre
-- a mitad del ensayo no lo pare sin culpa de la tanda.
select clave, valor from (
  -- corte: cargas empezadas antes del 17/11 a las 00:00
  select 1 o, 'tabla entera · import_run ' || program || '/' || kind || '/' || status clave, count(*)::text valor
    from public.import_run where started_at < timestamptz '2026-11-17 00:00:00+01' group by program, kind, status
  union all
  -- corte: facturas recibidas creadas antes del 17/11 a las 00:00
  select 2, 'tabla entera · supplier_invoice.source ' || coalesce(source, '(nulo)'), count(*)::text
    from public.supplier_invoice where created_at < timestamptz '2026-11-17 00:00:00+01' group by source
  union all
  -- corte: facturas emitidas creadas antes del 17/11 a las 00:00
  select 3, 'tabla entera · customer_invoice.origin ' || coalesce(origin, '(nulo)'), count(*)::text
    from public.customer_invoice where created_at < timestamptz '2026-11-17 00:00:00+01' group by origin
  union all
  -- corte: anotaciones del libro creadas antes del 17/11 a las 00:00
  select 4, 'tabla entera · vat_book_entry filas', count(*)::text
    from public.vat_book_entry where created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: empresas creadas antes del 17/11 a las 00:00
  select 5, 'todas las empresas · con _conta_corte no nulo', count(*)::text
    from public.company c where c.created_at < timestamptz '2026-11-17 00:00:00+01' and public._conta_corte(c.id) is not null
) t order by o, clave;
