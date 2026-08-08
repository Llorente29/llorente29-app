-- Aplicada: 2026-08-08 por MCP.
-- Margen operativo sobre el minimo legal de descanso semanal.
-- No es una restriccion dura: un cuadrante a 36h05 es LEGAL y no debe rechazarse
-- si es la unica opcion. Es un umbral de AVISO: por debajo de minimo+margen,
-- la semana esta al limite y un fichaje tardio la vuelve ilegal.
-- 30 min = lo que realmente se alarga un cierre de cocina (criterio de Julio, 08/08).

ALTER TABLE public.break_policy
  ADD COLUMN IF NOT EXISTS rest_safety_margin_minutes integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.break_policy.rest_safety_margin_minutes IS
  'Colchon operativo sobre el descanso semanal minimo, en minutos. Umbral de AVISO, no restriccion dura. Default 30.';

CREATE OR REPLACE FUNCTION public.rest_safety_margin_for(p_account uuid, p_location uuid)
RETURNS integer
LANGUAGE sql STABLE
SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT bp.rest_safety_margin_minutes FROM public.break_policy bp
      WHERE bp.account_id = p_account AND bp.location_id = p_location LIMIT 1),
    (SELECT bp.rest_safety_margin_minutes FROM public.break_policy bp
      WHERE bp.account_id = p_account AND bp.location_id IS NULL LIMIT 1),
    (SELECT bp.rest_safety_margin_minutes FROM public.break_policy bp
      WHERE bp.account_id = p_account LIMIT 1),
    30);
$$;

-- propose_schedule_rest pasa a devolver ESTADO de tres niveles, no un booleano.
-- 'ok' | 'al_limite' | 'incumple'
DROP FUNCTION IF EXISTS public.propose_schedule_rest(uuid, uuid, date);

CREATE FUNCTION public.propose_schedule_rest(
  p_account uuid, p_location uuid, p_week_start date)
RETURNS TABLE(
  employee_id uuid, employee_name text, dias_trabajados int, horas_semana numeric,
  descanso_desde timestamp, descanso_hasta timestamp, descanso_horas numeric,
  minimo_exigido_horas numeric, margen_horas numeric, estado text, cumple boolean)
LANGUAGE sql STABLE
SET search_path TO 'public','pg_temp'
AS $$
  with cfg as (
    select public.weekly_rest_minutes_for(p_account,p_location) as m,
           public.rest_safety_margin_for(p_account,p_location)  as s
  ),
  t as (
    select ps.employee_id, ps.employee_name,
           (ps.dia + st.start_time)::timestamp as ini,
           (ps.dia + st.start_time)::timestamp
             + case when st.end_time <= st.start_time then interval '24h' else interval '0' end
             + (st.end_time - st.start_time) as fin
    from public.propose_schedule(p_account,p_location,p_week_start) ps
    join public.shift_templates st on st.id = ps.shift_template_id
    where not ps.es_hueco
  ),
  g as (
    select employee_id, employee_name, fin as desde,
           lead(ini) over (partition by employee_id order by ini) as hasta
    from t
    union all
    select employee_id, employee_name, p_week_start::timestamp, min(ini)
    from t group by employee_id, employee_name
    union all
    select employee_id, employee_name, max(fin), (p_week_start + 7)::timestamp
    from t group by employee_id, employee_name
  ),
  best as (
    select distinct on (employee_id) employee_id, employee_name, desde, hasta,
           extract(epoch from (hasta - desde))/3600.0 as h
    from g where hasta is not null
    order by employee_id, extract(epoch from (hasta - desde)) desc
  )
  select b.employee_id, b.employee_name,
         (select count(distinct ini::date) from t where t.employee_id=b.employee_id)::int,
         round((select sum(extract(epoch from (fin-ini))/3600.0)
                from t where t.employee_id=b.employee_id)::numeric,1),
         b.desde, b.hasta, round(b.h::numeric,1),
         round((select m from cfg)/60.0,1),
         round((b.h - (select m from cfg)/60.0)::numeric,1),
         case
           when b.h < (select m from cfg)/60.0 then 'incumple'
           when b.h < (select m + s from cfg)/60.0 then 'al_limite'
           else 'ok' end,
         b.h >= (select m from cfg)/60.0
  from best b order by b.h;
$$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='break_policy' AND column_name='rest_safety_margin_minutes') THEN
    RAISE EXCEPTION 'rest_safety_margin_minutes no quedo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='rest_safety_margin_for') THEN
    RAISE EXCEPTION 'rest_safety_margin_for no quedo';
  END IF;
END $guard$;

NOTIFY pgrst, 'reload schema';
