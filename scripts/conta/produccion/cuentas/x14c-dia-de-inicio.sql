-- scripts/conta/produccion/cuentas/x14c-dia-de-inicio.sql
--
-- X14 · 2 · Lo traído no fija el día de inicio (0903) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo
-- columnas que existen antes de la tanda. Corte fijo (W06): lo creado antes del 25/11/2026 a las 10:00 de Madrid. La tanda
-- no cambia ningún dato (solo cuatro funciones):
--   1. Regla 31, por cuenta (regla 9): sus ejercicios (cuántos · huella de su código, sus fechas, su origen y hasta dónde
--      se trajo), y el día de inicio de sus empresas (cuántas lo tienen · huella de empresa y día).
--   0. Y la tabla entera de ejercicios, etiquetada como tal (regla 9).
select clave, valor from (
  select 0 o, 'tabla entera · ejercicios (cuántos · huella)' clave,
         count(*) || ' · ' || coalesce(md5(string_agg(concat_ws('|', y.id, y.code, y.starts_on, y.ends_on, y.origin, y.origin_program, y.imported_until), ',' order by y.id)), 'ninguno') valor
    from public.fiscal_year y
   where y.created_at < timestamptz '2026-11-25 10:00:00+01'
  union all
  select 1, 'cuenta ' || y.account_id || ' · ejercicios (cuántos · huella)',
         count(*) || ' · ' || md5(string_agg(concat_ws('|', y.id, y.code, y.starts_on, y.ends_on, y.origin, y.origin_program, y.imported_until), ',' order by y.id))
    from public.fiscal_year y
   where y.created_at < timestamptz '2026-11-25 10:00:00+01'
   group by y.account_id
  union all
  select 2, 'cuenta ' || c.account_id || ' · empresas con día de inicio (cuántas · huella)',
         count(*) || ' · ' || md5(string_agg(c.id || '|' || public.conta_dia_de_inicio(c.id), ',' order by c.id))
    from public.company c
   where c.created_at < timestamptz '2026-11-25 10:00:00+01' and public.conta_dia_de_inicio(c.id) is not null
   group by c.account_id
) t order by o, clave;
