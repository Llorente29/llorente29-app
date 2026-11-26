-- scripts/conta/produccion/cuentas/x14i-repetida.sql
--
-- X14 · 2 · «Repetida en ERP10» (20261126T0710) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. SOLO NÚMEROS (T11). Al
-- aplicarse no cambia ningún dato: una columna nueva (en «no»), su guarda, el índice que sustituye a la restricción de un solo
-- número y «Darlo por bueno» cambiado. Corte fijo (W06): emitidas creadas antes del 26/11/2026 a las 08:00 de Madrid.
--   1. Por cuenta (regla 9): cuántas emitidas, y cuántos números (empresa, serie, ejercicio y número) repetidos.
--   2. Las marcadas «repetida en ERP10» (to_jsonb: antes de la tanda la columna no existe): ninguna.
select clave, valor from (
  select 1 o, 'cuenta ' || c.account_id || ' · emitidas · números repetidos' clave,
         count(*) || ' · ' || (count(*) - count(distinct (c.company_id, c.series_code, c.fiscal_year, c.number))) valor
    from public.customer_invoice c where c.created_at < timestamptz '2026-11-26 08:00:00+01'
   group by c.account_id
  union all
  select 2, 'tabla entera · emitidas marcadas repetida en ERP10',
         count(*) filter (where coalesce((to_jsonb(c)->>'import_repeated')::boolean, false))::text
    from public.customer_invoice c where c.created_at < timestamptz '2026-11-26 08:00:00+01'
) t order by o, clave;
