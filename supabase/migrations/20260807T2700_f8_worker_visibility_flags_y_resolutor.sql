-- Aplicada 2026-08-07 por MCP. Verificado: los 4 flags salen invisibles por defecto; la bolsa respeta el
-- AND global × individual (hoy los 6 empleados de Llorente29 tienen show_hours_balance=false → bolsa oculta).
-- F8 (portal) · Flags de visibilidad AL TRABAJADOR + resolutor único.
--
-- OJO ESTRUCTURA: app_settings es una fila GLOBAL (scope='global', account_id NULL), NO por cuenta.
-- Estos flags son de plataforma (iguales para todos los clientes). DEUDA para cliente 2: si cada cliente
-- debe decidir su propia visibilidad, mover estos flags a una tabla por cuenta.
--
-- Patrón: default FALSE (invisible). Dato sensible no se enseña al trabajador salvo activación explícita.
-- Coherente con la regla del portal "tono suave, nunca semáforos de culpa" (F8).

alter table public.app_settings add column if not exists show_night_hours_to_employee boolean not null default false;
alter table public.app_settings add column if not exists show_labor_cost_to_employee  boolean not null default false;
alter table public.app_settings add column if not exists show_compliance_to_employee  boolean not null default false;

comment on column public.app_settings.show_night_hours_to_employee is
  'F8 Si el trabajador ve sus horas nocturnas en el portal. Default false (prudente).';
comment on column public.app_settings.show_labor_cost_to_employee is
  'F8 Si el trabajador ve su coste laboral en el portal. Default false. Dato muy sensible.';
comment on column public.app_settings.show_compliance_to_employee is
  'F8 Si el trabajador ve avisos de convenio/infracciones propios. Default false (evita semaforo de culpa).';

-- Resolutor único: el portal pregunta UNA vez qué puede ver este empleado. Centraliza los 4 flags para
-- que ningún dato sensible se escape por olvido de comprobar en una pantalla.
-- La bolsa = flag global AND flag individual del empleado (employees.show_hours_balance, default true).
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
