-- F7/F10 · COMPARADOR DE COBERTURA: requerido (team_labor_requirement, demanda en platos) vs asignado
-- en el cuadrante, hora a hora, con coste real de nómina. Responde "¿sobra o falta gente y cuánto cuesta?".
-- NO toca el generador actual: solo lee y compara.
create or replace function public.schedule_coverage_gap(
  p_account uuid, p_location uuid, p_week_start date
) returns table(
  fecha date, hora int,
  required_total int, assigned_total int, gap int,
  assigned_cost_hour numeric, cost_is_partial boolean
)
language sql stable
as $function$
  with req as (
    select r.fecha, r.hora, sum(r.required)::int as required_total
    from public.team_labor_requirement(p_account, p_location, p_week_start) r
    where r.is_estimate = false
    group by r.fecha, r.hora
  ),
  asign as (
    select (p_week_start + ((dia.key)::int))::date as fecha,
           (emp.value #>> '{}')::uuid as employee_id,
           st.start_time, st.end_time
    from public.schedules s
    cross join lateral jsonb_each(s.cells) shift
    cross join lateral jsonb_each(shift.value) dia
    cross join lateral jsonb_array_elements(dia.value) emp
    join public.shift_templates st on st.id = (shift.key)::uuid
    where s.location_id = p_location and s.week_start = p_week_start
  ),
  horas as (
    select a.employee_id,
           (a.fecha + (h || ' hours')::interval)::date as fecha,
           (extract(hour from (a.fecha + (h || ' hours')::interval)))::int as hora
    from asign a
    cross join lateral generate_series(
      extract(hour from a.start_time)::int,
      case when a.end_time <= a.start_time
           then extract(hour from a.end_time)::int + 24
           else extract(hour from a.end_time)::int end - 1
    ) h
  ),
  coste as (
    select e.id as employee_id, pc.total_cost / nullif(w.horas,0) as coste_hora
    from public.employees e
    left join (
      select employee_id, sum(minutes)/60.0 as horas
      from public.team_worked_shifts(p_account,
             (p_week_start - 60)::timestamptz, (p_week_start + 7)::timestamptz)
      group by employee_id) w on w.employee_id = e.id
    left join public.payroll_cost pc on pc.employee_id = e.id
      and (pc.period_year * 12 + pc.period_month) =
          (extract(year from p_week_start)::int * 12 + extract(month from p_week_start)::int)
    where e.account_id = p_account
  ),
  media as (select avg(coste_hora) as m from coste where coste_hora is not null),
  agg as (
    select h.fecha, h.hora, count(*)::int as assigned_total,
           sum(coalesce(c.coste_hora, (select m from media))) as coste,
           bool_or(c.coste_hora is null) as falta_nomina
    from horas h left join coste c on c.employee_id = h.employee_id
    group by h.fecha, h.hora
  )
  select coalesce(r.fecha, a.fecha), coalesce(r.hora, a.hora),
         coalesce(r.required_total, 0), coalesce(a.assigned_total, 0),
         coalesce(a.assigned_total,0) - coalesce(r.required_total,0),
         round(coalesce(a.coste,0), 2), coalesce(a.falta_nomina, false)
  from req r
  full outer join agg a on a.fecha = r.fecha and a.hora = r.hora
  order by 1, 2;
$function$;

grant execute on function public.schedule_coverage_gap(uuid,uuid,date) to authenticated, service_role;