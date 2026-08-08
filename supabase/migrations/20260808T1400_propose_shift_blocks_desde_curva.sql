-- Aplicada: 2026-08-08 por MCP.
-- GENERADOR DE TURNOS DESDE LA CURVA (pieza que no existia).
-- Entrada: team_labor_requirement (personas necesarias por hora, ya calculado desde ventas).
-- Salida: bloques de turno CONTINUOS por dia y rol. No usa shift_templates.
--
-- Metodo: descomposicion por capas. Capa 1 = horas con required>=1, partida en tramos
-- contiguos; capa 2 = horas con required>=2; etc. Cada tramo contiguo es un turno seguido.
-- Respeta jornada maxima y duracion minima de turno (de break_policy, por cuenta/local).
--
-- NOTA (superada por 20260808T1410_propose_shift_blocks_fix_ambiguedad.sql en el mismo
-- dia): los nombres de columna OUT de esta version chocaban con las CTE del RETURN QUERY.
-- Se versiona igualmente porque es lo que corrio en produccion en ese momento.

ALTER TABLE public.break_policy
  ADD COLUMN IF NOT EXISTS min_shift_minutes integer NOT NULL DEFAULT 180;

COMMENT ON COLUMN public.break_policy.min_shift_minutes IS
  'Duracion minima de un turno propuesto, en minutos. Evita proponer turnos de 1 h. Default 180 (3 h).';

CREATE OR REPLACE FUNCTION public.propose_shift_blocks(
  p_account uuid, p_location uuid, p_week_start date, p_role text DEFAULT 'cocina')
RETURNS TABLE(
  fecha date, dow integer, role_kind text, capa integer,
  hora_inicio integer, hora_fin integer, horas numeric,
  personas_hora_media numeric, ajustado text)
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_max_h numeric; v_min_h numeric;
begin
  select coalesce(max_daily_minutes,540)/60.0, coalesce(min_shift_minutes,180)/60.0
    into v_max_h, v_min_h
  from public.break_policy
  where account_id = p_account and (location_id = p_location or location_id is null)
  order by location_id nulls last limit 1;
  v_max_h := coalesce(v_max_h, 9); v_min_h := coalesce(v_min_h, 3);

  return query
  with req as (
    select r.fecha, r.dow, r.hora, r.required
    from public.team_labor_requirement(p_account, p_location, p_week_start) r
    where r.role_kind = p_role and r.required > 0
  ),
  niveles as (
    select req.fecha, req.dow, req.hora, n.nivel
    from req cross join generate_series(1, 6) n(nivel)
    where req.required >= n.nivel
  ),
  grupos as (
    select fecha, dow, nivel, hora,
           hora - row_number() over (partition by fecha, dow, nivel order by hora) as g
    from niveles
  ),
  bloques as (
    select fecha, dow, nivel, min(hora) as h_ini, max(hora) + 1 as h_fin
    from grupos group by fecha, dow, nivel, g
  ),
  -- extender los que no llegan al minimo (hacia adelante, tope 24 h)
  ajustados as (
    select fecha, dow, nivel, h_ini,
           case when (h_fin - h_ini) < v_min_h
                then least(24, h_ini + ceil(v_min_h)::int)
                else h_fin end as h_fin,
           case when (h_fin - h_ini) < v_min_h then 'ampliado al minimo de turno'
                when (h_fin - h_ini) > v_max_h then 'supera la jornada maxima'
                else null end as nota
    from bloques
  )
  select a.fecha, a.dow, p_role, a.nivel,
         a.h_ini, a.h_fin, (a.h_fin - a.h_ini)::numeric,
         round((select avg(r.required) from req r
                 where r.fecha = a.fecha and r.hora >= a.h_ini and r.hora < a.h_fin)::numeric, 2),
         a.nota
  from ajustados a
  order by a.fecha, a.nivel, a.h_ini;
end $function$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='propose_shift_blocks') THEN
    RAISE EXCEPTION 'propose_shift_blocks no quedo';
  END IF;
END $guard$;

NOTIFY pgrst, 'reload schema';
