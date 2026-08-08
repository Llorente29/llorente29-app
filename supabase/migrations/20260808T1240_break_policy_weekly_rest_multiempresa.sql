-- Aplicada: 2026-08-08 por MCP.
-- MULTIEMPRESA: el descanso semanal NO puede estar hardcoded en el solver.
-- Vive en break_policy (por cuenta/local), junto al resto de reglas de convenio.
-- 36 h = minimo del art. 37.1 ET. Un convenio puede exigir mas (48 h = 2 dias).

ALTER TABLE public.break_policy
  ADD COLUMN IF NOT EXISTS weekly_rest_minutes integer NOT NULL DEFAULT 2160;  -- 36 h

COMMENT ON COLUMN public.break_policy.weekly_rest_minutes IS
  'Descanso semanal continuo minimo, en minutos. 2160 = 36 h (art. 37.1 ET, minimo legal). Un convenio puede exigir mas.';

-- Resolutor por cuenta/local con fallback al minimo legal
CREATE OR REPLACE FUNCTION public.weekly_rest_minutes_for(p_account uuid, p_location uuid)
RETURNS integer
LANGUAGE sql STABLE
SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT bp.weekly_rest_minutes FROM public.break_policy bp
      WHERE bp.account_id = p_account AND bp.location_id = p_location LIMIT 1),
    (SELECT bp.weekly_rest_minutes FROM public.break_policy bp
      WHERE bp.account_id = p_account AND bp.location_id IS NULL LIMIT 1),
    (SELECT bp.weekly_rest_minutes FROM public.break_policy bp
      WHERE bp.account_id = p_account LIMIT 1),
    2160);
$$;

-- La funcion de descanso pasa a recibir el umbral, no asumirlo
CREATE OR REPLACE FUNCTION public.has_weekly_rest(
  p_turnos jsonb, p_new_ini timestamp, p_new_fin timestamp,
  p_week_start date, p_min_minutes integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $$
  with ivs as (
    select (x->>0)::timestamp as s, (x->>1)::timestamp as e
    from jsonb_array_elements(coalesce(p_turnos,'[]'::jsonb)) x
    union all select p_new_ini, p_new_fin
  ),
  ord as (select s, e, lead(s) over (order by s) as next_s from ivs),
  gaps as (
    select extract(epoch from (next_s - e))/60.0 as m from ord where next_s is not null
    union all
    select extract(epoch from ((select min(s) from ivs) - p_week_start::timestamp))/60.0
    union all
    select extract(epoch from ((p_week_start + 7)::timestamp - (select max(e) from ivs)))/60.0
  )
  select coalesce(max(m), 999999) >= p_min_minutes from gaps;
$$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='break_policy' AND column_name='weekly_rest_minutes') THEN
    RAISE EXCEPTION 'columna weekly_rest_minutes no quedo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='weekly_rest_minutes_for') THEN
    RAISE EXCEPTION 'weekly_rest_minutes_for no quedo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='has_weekly_rest') THEN
    RAISE EXCEPTION 'has_weekly_rest no quedo';
  END IF;
END $guard$;

NOTIFY pgrst, 'reload schema';
