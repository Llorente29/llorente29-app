-- Aplicada: 2026-08-08 por MCP.
-- Fix: los nombres de las columnas OUT (fecha, dow, hora_inicio...) chocaban con las
-- columnas de las CTE dentro del RETURN QUERY. Se prefijan las salidas con o_.
--
-- INCOMPLETA (declarado por Julio, 08/08): falta partir los bloques que exceden la
-- jornada maxima (el `ajustado='supera la jornada maxima'` solo lo señala, no lo corta).
-- No cablear al frontend todavia — propose_shift_blocks no tiene consumidor.

DROP FUNCTION IF EXISTS public.propose_shift_blocks(uuid, uuid, date, text);

CREATE FUNCTION public.propose_shift_blocks(
  p_account uuid, p_location uuid, p_week_start date, p_role text DEFAULT 'cocina')
RETURNS TABLE(
  o_fecha date, o_dow integer, o_role text, o_capa integer,
  o_ini integer, o_fin integer, o_horas numeric,
  o_demanda_media numeric, o_nota text)
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_max_h numeric; v_min_h numeric;
begin
  select coalesce(bp.max_daily_minutes,540)/60.0, coalesce(bp.min_shift_minutes,180)/60.0
    into v_max_h, v_min_h
  from public.break_policy bp
  where bp.account_id = p_account and (bp.location_id = p_location or bp.location_id is null)
  order by bp.location_id nulls last limit 1;
  v_max_h := coalesce(v_max_h, 9); v_min_h := coalesce(v_min_h, 3);

  return query
  with req as (
    select r.fecha as f, r.dow as d, r.hora as h, r.required as q
    from public.team_labor_requirement(p_account, p_location, p_week_start) r
    where r.role_kind = p_role and r.required > 0
  ),
  niveles as (
    select req.f, req.d, req.h, n.nivel
    from req cross join generate_series(1, 6) n(nivel)
    where req.q >= n.nivel
  ),
  grupos as (
    select f, d, nivel, h,
           h - row_number() over (partition by f, d, nivel order by h) as g
    from niveles
  ),
  bloques as (
    select f, d, nivel, min(h) as h_ini, max(h) + 1 as h_fin
    from grupos group by f, d, nivel, g
  ),
  ajustados as (
    select f, d, nivel, h_ini,
           case when (h_fin - h_ini) < v_min_h
                then least(24, h_ini + ceil(v_min_h)::int)
                else h_fin end as h_fin,
           case when (h_fin - h_ini) < v_min_h then 'ampliado al minimo de turno'
                when (h_fin - h_ini) > v_max_h then 'supera la jornada maxima'
                else null end as nota
    from bloques
  )
  select a.f, a.d, p_role, a.nivel,
         a.h_ini, a.h_fin, (a.h_fin - a.h_ini)::numeric,
         round((select avg(r.q) from req r
                 where r.f = a.f and r.h >= a.h_ini and r.h < a.h_fin)::numeric, 2),
         a.nota
  from ajustados a
  order by a.f, a.nivel, a.h_ini;
end $function$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='propose_shift_blocks') THEN
    RAISE EXCEPTION 'propose_shift_blocks no quedo';
  END IF;
END $guard$;

NOTIFY pgrst, 'reload schema';
