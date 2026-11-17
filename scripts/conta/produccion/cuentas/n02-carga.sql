-- scripts/conta/produccion/cuentas/n02-carga.sql
--
-- N02 · La carga abierta y el día de inicio (0832, 0833) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0832 solo amplía cinco CHECK y la 0833 solo añade tres columnas que admiten nulos y una función:
-- no cambia ni una fila. Se mide que todo sigue igual. Las cifras son de la TABLA ENTERA, a propósito
-- (regla 9, excepción: la huella de «esto no se ha movido» es más fuerte así), y se etiquetan como tal.
select clave, valor from (
  select 1 o, 'tabla entera · import_run ' || program || '/' || kind || '/' || status clave, count(*)::text valor
    from public.import_run group by program, kind, status
  union all
  select 2, 'tabla entera · supplier_invoice.source ' || coalesce(source, '(nulo)'), count(*)::text
    from public.supplier_invoice group by source
  union all
  select 3, 'tabla entera · customer_invoice.origin ' || coalesce(origin, '(nulo)'), count(*)::text
    from public.customer_invoice group by origin
  union all
  select 4, 'tabla entera · vat_book_entry filas', count(*)::text from public.vat_book_entry
  union all
  select 5, 'todas las empresas · con _conta_corte no nulo', count(*)::text
    from public.company c where public._conta_corte(c.id) is not null
) t order by o, clave;
