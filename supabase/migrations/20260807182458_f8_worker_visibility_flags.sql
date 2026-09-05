-- F8 (portal) · Flags de visibilidad AL TRABAJADOR, mismo patrón que show_hour_bank_to_employee.
-- Por defecto FALSE (invisible): dato sensible no se enseña al trabajador salvo que el cliente lo active.
-- Coherente con la regla del portal "tono suave, nunca semáforos de culpa".
alter table public.app_settings add column if not exists show_night_hours_to_employee boolean not null default false;
alter table public.app_settings add column if not exists show_labor_cost_to_employee boolean not null default false;
alter table public.app_settings add column if not exists show_compliance_to_employee boolean not null default false;

comment on column public.app_settings.show_night_hours_to_employee is
  'F8 Si el trabajador ve sus horas nocturnas en el portal. Default false (prudente).';
comment on column public.app_settings.show_labor_cost_to_employee is
  'F8 Si el trabajador ve su coste laboral en el portal. Default false. Dato muy sensible.';
comment on column public.app_settings.show_compliance_to_employee is
  'F8 Si el trabajador ve avisos de convenio/infracciones propios. Default false (evita semaforo de culpa).';