-- F8 · Resolutor único de visibilidad del portal del trabajador. El frontend pregunta UNA vez qué puede
-- ver este empleado y respeta la respuesta. Centraliza los flags para que ningún dato sensible se escape
-- por olvido de comprobar en una pantalla. Lee app_settings de la cuenta del empleado + su flag individual.
create or replace function public.worker_portal_visibility(p_employee_id uuid)
returns table(
  show_hour_bank boolean, show_night_hours boolean,
  show_labor_cost boolean, show_compliance boolean
)
language sql stable
as $function$
  select
    -- bolsa: flag de cuenta AND flag individual del empleado (ambos deben permitir)
    coalesce(a.show_hour_bank_to_employee, false) and coalesce(e.show_hours_balance, true),
    coalesce(a.show_night_hours_to_employee, false),
    coalesce(a.show_labor_cost_to_employee, false),
    coalesce(a.show_compliance_to_employee, false)
  from public.employees e
  left join public.app_settings a on a.account_id = e.account_id
  where e.id = p_employee_id;
$function$;

grant execute on function public.worker_portal_visibility(uuid) to authenticated, service_role;