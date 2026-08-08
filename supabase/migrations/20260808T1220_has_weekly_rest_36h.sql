-- Aplicada: 2026-08-08 por MCP.
-- Helper para 20260808T1230_propose_schedule_descanso_36h_real.sql — sustituye el
-- contador "max 5 dias" de T1200/T1210 por la regla real del art. 37.1 ET.
--
-- art. 37.1 ET: descanso semanal de DIA Y MEDIO ININTERRUMPIDO (36 h continuas).
-- No es "maximo N dias": es que exista un hueco continuo >= 36 h en la semana.
CREATE OR REPLACE FUNCTION public.has_weekly_rest_36h(
  p_turnos jsonb, p_new_ini timestamp, p_new_fin timestamp, p_week_start date
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $$
  with ivs as (
    select (x->>0)::timestamp as s, (x->>1)::timestamp as e
    from jsonb_array_elements(coalesce(p_turnos,'[]'::jsonb)) x
    union all
    select p_new_ini, p_new_fin
  ),
  ord as (
    select s, e, lead(s) over (order by s) as next_s from ivs
  ),
  gaps as (
    select extract(epoch from (next_s - e))/3600.0 as h
      from ord where next_s is not null
    union all
    select extract(epoch from ((select min(s) from ivs) - p_week_start::timestamp))/3600.0
    union all
    select extract(epoch from ((p_week_start + 7)::timestamp - (select max(e) from ivs)))/3600.0
  )
  select coalesce(max(h), 999) >= 36 from gaps;
$$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='has_weekly_rest_36h') THEN
    RAISE EXCEPTION 'has_weekly_rest_36h no quedo';
  END IF;
END $guard$;
