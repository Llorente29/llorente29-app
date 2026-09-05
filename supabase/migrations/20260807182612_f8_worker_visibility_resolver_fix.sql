-- F8 (corrección) · app_settings es una fila GLOBAL (scope='global', account_id NULL), no por cuenta.
-- El resolutor buscaba por account_id y nunca casaba. Se corrige para leer la fila global.
-- La bolsa individual del empleado (employees.show_hours_balance, default true) sigue como AND.
create or replace function public.worker_portal_visibility(p_employee_id uuid)
returns table(
  show_hour_bank boolean, show_night_hours boolean,
  show_labor_cost boolean, show_compliance boolean
)
language sql stable
as $function$
  with g as (select * from public.app_settings where scope='global' limit 1)
  select
    coalesce(g.show_hour_bank_to_employee, false) and coalesce(e.show_hours_balance, true),
    coalesce(g.show_night_hours_to_employee, false),
    coalesce(g.show_labor_cost_to_employee, false),
    coalesce(g.show_compliance_to_employee, false)
  from public.employees e
  left join g on true
  where e.id = p_employee_id;
$function$;
grant execute on function public.worker_portal_visibility(uuid) to authenticated, service_role;