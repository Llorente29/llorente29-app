-- scripts/conta/produccion/cuentas/r03-ventas-tpv.sql
--
-- R03 · Las ventas de un TPV de fuera (0950, 0951) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0950 crea cinco tablas nuevas y añade una columna con valor por defecto a company_tax_profile; la
-- 0951, tres funciones nuevas. No cambia ni una fila de lo que existe: se mide que company_tax_profile
-- sigue igual. Las cifras son de la TABLA ENTERA, a propósito (regla 9, excepción: la huella de «esto
-- no se ha movido» es más fuerte así), y se etiquetan como tal. Las tablas nuevas no se cuentan: antes
-- no existen.
-- Corte fijo (el #241): solo lo creado antes del 17/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  -- corte: perfiles de empresas creadas antes del 17/11 a las 00:00
  select 1 o, 'tabla entera · company_tax_profile filas' clave, count(*)::text valor
    from public.company_tax_profile t join public.company c on c.id = t.company_id
   where c.created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: las mismas, por su ajuste de validar solas las ventas del día
  select 2, 'tabla entera · company_tax_profile journal_autovalidate_sales_day ' || coalesce(t.journal_autovalidate_sales_day::text, '(nulo)'), count(*)::text
    from public.company_tax_profile t join public.company c on c.id = t.company_id
   where c.created_at < timestamptz '2026-11-17 00:00:00+01' group by t.journal_autovalidate_sales_day
) t order by o, clave;
