-- Aplicada 2026-08-07 por MCP. Verificado sobre Julio 2026: Natacha +23,68h, Johanny -1,67h, prorrateo
-- de Keilymar (media jornada) correcto. Los cierres dejan de dar cero.
-- F2 · Motor de balance de horas. contratado (prorrateado al periodo, respeta alta/baja parcial) vs
-- trabajado (team_worked_shifts, ya con pausas descontadas) + ausencias PAGADAS (vacaciones cuentan como
-- cumplidas; baja_medica NO computa). delta = bolsa de horas. Devuelve tambien horas nocturnas.
create or replace function public.compute_employee_balance(
  p_employee_id uuid, p_from date, p_to date
) returns table(
  contracted_hours numeric, worked_hours numeric, paid_absence_hours numeric,
  effective_hours numeric, delta_hours numeric, night_hours numeric
)
language sql stable
as $function$
  with e as (
    select id, coalesce(contracted_hours_week, weekly_hours, 40)::numeric as hw,
           start_date, end_date, account_id,
           (select location_id from employees x where x.id = employees.id) as loc
    from employees where id = p_employee_id
  ),
  dias as (
    select greatest(p_from, coalesce(e.start_date, p_from)) as ini,
           least(p_to, coalesce(e.end_date, p_to)) as fin, e.hw
    from e
  ),
  contratado as (
    select case when fin >= ini then (hw/7.0) * (fin - ini + 1) else 0 end as h_contrato from dias
  ),
  trabajado as (
    select coalesce(sum(w.minutes)/60.0, 0) as h_trab,
           coalesce(sum(public.night_minutes_in_span(w.started_at, w.ended_at))/60.0, 0) as h_noche
    from public.team_worked_shifts((select account_id from e), p_from::timestamptz, (p_to + 1)::timestamptz) w
    where w.employee_id = p_employee_id
  ),
  ausencias as (
    select coalesce(sum(
      (least(v.end_date, p_to) - greatest(v.start_date, p_from) + 1) * ((select hw from dias)/7.0)
    ), 0) as h_ausencia_pagada
    from vacations v
    where v.employee_id = p_employee_id and v.status = 'aprobada' and coalesce(v.paid, false) = true
      and v.start_date <= p_to and v.end_date >= p_from
  )
  select
    round((select h_contrato from contratado), 2),
    round((select h_trab from trabajado), 2),
    round((select h_ausencia_pagada from ausencias), 2),
    round((select h_trab from trabajado) + (select h_ausencia_pagada from ausencias), 2),
    round((select h_trab from trabajado) + (select h_ausencia_pagada from ausencias) - (select h_contrato from contratado), 2),
    round((select h_noche from trabajado), 2);
$function$;
revoke execute on function public.compute_employee_balance(uuid,date,date) from public, anon;
grant execute on function public.compute_employee_balance(uuid,date,date) to authenticated, service_role;
