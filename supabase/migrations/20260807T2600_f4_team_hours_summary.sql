-- Aplicada 2026-08-07 por MCP. Verificado julio 2026: 6 empleados Llorente29 (sin sandbox), coste real de
-- nóminas cargado (Natacha 1.935,34€), bolsas correctas (Natacha +23,68 / Mirlenys -83,32).
-- F4.2 · RPC de la pantalla Plantilla. INVOKER (RLS acota a la cuenta). Una fila por empleado activo con
-- balance (compute_employee_balance) + coste laboral real de nóminas de los meses del periodo.
create or replace function public.team_hours_summary(
  p_account_id uuid, p_from date, p_to date, p_location_id uuid default null
) returns table(
  employee_id uuid, employee_name text, location_id uuid,
  contracted_hours numeric, worked_hours numeric, vacation_hours numeric,
  night_hours numeric, delta_hours numeric,
  labor_cost numeric, cost_is_partial boolean
)
language sql stable
as $function$
  with emp as (
    select e.id, e.name, e.location_id
    from public.employees e
    where e.account_id = p_account_id and e.active = true
      and (p_location_id is null or e.location_id = p_location_id)
  ),
  bal as (
    select emp.id as employee_id, emp.name, emp.location_id, b.*
    from emp cross join lateral public.compute_employee_balance(emp.id, p_from, p_to) b
  ),
  months as (
    select distinct extract(year from d)::int as y, extract(month from d)::int as m
    from generate_series(p_from, p_to, interval '1 month') d
  ),
  cost as (
    select pc.employee_id, sum(pc.total_cost) as labor_cost
    from public.payroll_cost pc
    join months mo on mo.y = pc.period_year and mo.m = pc.period_month
    where pc.account_id = p_account_id
    group by pc.employee_id
  )
  select bal.employee_id, bal.name, bal.location_id,
    bal.contracted_hours, bal.worked_hours, bal.paid_absence_hours,
    bal.night_hours, bal.delta_hours,
    c.labor_cost, (c.labor_cost is null) as cost_is_partial
  from bal left join cost c on c.employee_id = bal.employee_id
  order by bal.name;
$function$;
grant execute on function public.team_hours_summary(uuid,date,date,uuid) to authenticated, service_role;
