-- F1.5 (corrección) · El chequeo DESCANSO_ENTRE_JORNADAS marcaba turnos PARTIDOS como infraccion:
-- comida (12:26-16:45) + cena (19:43-23:49) del mismo dia se leian como 2 jornadas con "solo 3h de
-- descanso". Eso es jornada partida (legal), no descanso insuficiente entre jornadas.
-- Correccion: la regla de 12h (ET 34.3) aplica entre el fin de un DIA de trabajo y el inicio del
-- SIGUIENTE. Solo se marca si el arranque de la jornada cae en un dia natural DISTINTO al fin de la previa.
create or replace function public.team_compliance_scan(p_account uuid, p_from timestamptz, p_to timestamptz)
returns table(
  employee_id uuid, employee_name text, location_id uuid,
  started_at timestamptz, ended_at timestamptz,
  worked_minutes numeric, night_minutes numeric,
  issue_code text, issue_severity text, issue_detail text, legal_ref text
)
language sql stable
as $function$
  with pol as (
    select distinct on (loc.id) loc.id as location_id,
           coalesce(bl.max_continuous_minutes, bc.max_continuous_minutes) as max_cont,
           coalesce(bl.min_rest_between_shifts_minutes, bc.min_rest_between_shifts_minutes, 720) as min_rest,
           coalesce(bl.max_daily_minutes, bc.max_daily_minutes, 540) as max_daily,
           coalesce(bl.rules, bc.rules, '[]'::jsonb) as rules,
           coalesce(bl.night_start, bc.night_start, '22:00'::time) as ns,
           coalesce(bl.night_end,   bc.night_end,   '06:00'::time) as ne
    from public.locations loc
    left join public.break_policy bc on bc.account_id = loc.account_id and bc.location_id is null
    left join public.break_policy bl on bl.location_id = loc.id
    where loc.account_id = p_account
  ),
  j as (
    select w.*, e.name as emp_name,
           public.night_minutes_in_span(w.started_at, w.ended_at, p.ns, p.ne) as night_min,
           p.max_cont, p.min_rest, p.max_daily, p.rules,
           lag(w.ended_at) over (partition by w.employee_id order by w.started_at) as prev_end
    from public.team_worked_shifts(p_account, p_from, p_to) w
    join public.employees e on e.id = w.employee_id
    left join pol p on p.location_id = w.location_id
  )
  select j.employee_id, j.emp_name, j.location_id, j.started_at, j.ended_at, j.minutes, j.night_min,
         'SIN_DESCANSO', 'serious',
         'Jornada de '||round(j.presence_minutes/60.0,1)||' h sin descanso registrado',
         'ET art. 34.4 / convenio'
  from j
  where j.rules <> '[]'::jsonb
    and j.presence_minutes >= coalesce((j.rules->0->>'min_shift_minutes')::numeric, 360)
    and j.break_minutes = 0
  union all
  select j.employee_id, j.emp_name, j.location_id, j.started_at, j.ended_at, j.minutes, j.night_min,
         'EXCESO_CONTINUO', 'warning',
         'Mas de '||round(j.max_cont/60.0,1)||' h seguidas sin pausa',
         'Convenio (jornada continuada)'
  from j
  where j.max_cont is not null and j.break_minutes = 0 and j.presence_minutes > j.max_cont
  union all
  -- DESCANSO_ENTRE_JORNADAS: solo si cambia el dia natural (Madrid) -> excluye turno partido del mismo dia
  select j.employee_id, j.emp_name, j.location_id, j.started_at, j.ended_at, j.minutes, j.night_min,
         'DESCANSO_ENTRE_JORNADAS', 'serious',
         'Solo '||round(extract(epoch from (j.started_at - j.prev_end))/3600.0,1)||' h desde la jornada del dia anterior',
         'ET art. 34.3 (12 h)'
  from j
  where j.prev_end is not null
    and j.started_at > j.prev_end
    and j.started_at - j.prev_end < make_interval(mins => j.min_rest::int)
    and (j.started_at at time zone 'Europe/Madrid')::date
        > (j.prev_end at time zone 'Europe/Madrid')::date   -- distinto dia natural = no es partida
  union all
  select j.employee_id, j.emp_name, j.location_id, j.started_at, j.ended_at, j.minutes, j.night_min,
         'EXCESO_JORNADA_DIARIA', 'warning',
         'Jornada trabajada de '||round(j.minutes/60.0,1)||' h (max '||round(j.max_daily/60.0,1)||' h)',
         'ET art. 34.3 (9 h ordinarias)'
  from j
  where j.minutes > j.max_daily;
$function$;

revoke execute on function public.team_compliance_scan(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.team_compliance_scan(uuid,timestamptz,timestamptz) to authenticated, service_role;