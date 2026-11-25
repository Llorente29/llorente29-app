-- scripts/conta/produccion/cuentas/x14b-ejercicios.sql
--
-- X14 · 1b · «Traer» crea los ejercicios que falten (0816) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo
-- columnas que existen antes de la tanda. Corte fijo (W06): lo creado antes del 25/11/2026 a las 09:00 de Madrid. La tanda
-- no cambia ningún dato (solo dos funciones):
--   1. Regla 31, por cuenta (regla 9): sus ejercicios (cuántos · huella de su código, sus fechas, su anterior y su origen).
--   2. Y las cargas de «Traer», por cuenta (cuántas · huella de su estado).
--   0. Y la tabla entera de ejercicios, etiquetada como tal (regla 9).
select clave, valor from (
  select 0 o, 'tabla entera · ejercicios (cuántos · huella)' clave,
         count(*) || ' · ' || coalesce(md5(string_agg(concat_ws('|', y.id, y.code, y.starts_on, y.ends_on, y.previous_year_id, y.origin, y.status), ',' order by y.id)), 'ninguno') valor
    from public.fiscal_year y
   where y.created_at < timestamptz '2026-11-25 09:00:00+01'
  union all
  select 1, 'cuenta ' || y.account_id || ' · ejercicios (cuántos · huella)',
         count(*) || ' · ' || md5(string_agg(concat_ws('|', y.id, y.code, y.starts_on, y.ends_on, y.previous_year_id, y.origin, y.status), ',' order by y.id))
    from public.fiscal_year y
   where y.created_at < timestamptz '2026-11-25 09:00:00+01'
   group by y.account_id
  union all
  select 2, 'cuenta ' || r.account_id || ' · cargas de Traer (cuántas · huella)',
         count(*) || ' · ' || md5(string_agg(concat_ws('|', r.id, r.status), ',' order by r.id))
    from public.import_run r
   where r.kind = 'carga' and r.started_at < timestamptz '2026-11-25 09:00:00+01'
   group by r.account_id
) t order by o, clave;
