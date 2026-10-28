-- supabase/vuelta-atras/20261027T1905_l1a_fichar_en_el_servidor.down.sql
--
-- Vuelta atrás de 20261027T1905_l1a_fichar_en_el_servidor (L1a · PR 1).
-- Deja la base como la dejó la 1215: las lecturas de antes (el encargado ve
-- toda la cuenta, también nóminas y documentos), add_manual_clock_entry solo
-- para el administrador, y sin fichar(), sin conservación y sin su vigía.
--
-- LO QUE NO PUEDE DEVOLVER: las coordenadas que la limpieza nocturna ya haya
-- borrado (las de más de 3 meses) y lo que haya anonimizado. Eso es la decisión
-- 2 de Julio cumpliéndose, no un efecto lateral. Si la vuelta atrás salta antes
-- de la primera pasada (02:37 UTC), no se ha borrado nada.
-- Las columnas nuevas de clock_entries (distancia, dentro del radio, hora
-- declarada) se quitan: los fichajes hechos mientras tanto conservan su hora y
-- sus coordenadas, pierden la distancia calculada.

set constraints all immediate;

-- 7 · Conservación y su vigía.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'registro-jornada-conservacion') then
      perform cron.unschedule('registro-jornada-conservacion');
    end if;
    if exists (select 1 from cron.job where jobname = 'registro-jornada-conservacion-vigia') then
      perform cron.unschedule('registro-jornada-conservacion-vigia');
    end if;
  end if;
end $$;
drop function if exists public.conservacion_vigia(integer, boolean);
drop function if exists public.conservar_registro_de_jornada(boolean);
drop table if exists public.registro_conservacion;

-- 8 · El valor por defecto del radio, el de antes.
alter table public.locations alter column clock_geofence_mode set default 'block';

-- 5 · Las lecturas, las de la 1215.
drop policy employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(id, account_id));

drop policy clock_entries_read on public.clock_entries;
create policy clock_entries_read on public.clock_entries for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy vacations_read on public.vacations;
create policy vacations_read on public.vacations for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy payroll_cost_read on public.payroll_cost;
create policy payroll_cost_read on public.payroll_cost for select
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy payroll_inbox_read on public.payroll_inbox;
create policy payroll_inbox_read on public.payroll_inbox for select
  using (public.current_user_is_admin_or_manager_of(account_id));

drop policy documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (exists (select 1 from public.employees e
                  where e.id = documents.employee_id
                    and (public.current_user_is_admin_or_manager_of(e.account_id) or public.current_user_is_employee(e.id, e.account_id))));

drop policy clock_audit_read on public.clock_entry_audit;
create policy clock_audit_read on public.clock_entry_audit for select
  using (public.current_user_is_admin_or_manager_of(account_id)
         or (employee_id is not null and public.current_user_is_employee(employee_id, account_id)));

drop policy clock_req_read on public.clock_correction_request;
create policy clock_req_read on public.clock_correction_request for select
  using (public.current_user_is_admin_or_manager_of(account_id)
         or public.current_user_is_employee(employee_id, account_id)
         or public.current_user_is_employee(requested_by_employee_id, account_id));

drop policy employee_notifications_read on public.employee_notifications;
create policy employee_notifications_read on public.employee_notifications for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id)
         or public.current_user_is_employee(employee_id, account_id)
         or (sender_employee_id is not null and public.current_user_is_employee(sender_employee_id, account_id)));

drop policy monthly_balance_closures_read on public.monthly_balance_closures;
create policy monthly_balance_closures_read on public.monthly_balance_closures for select
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

-- Las funciones de antes, byte a byte (del respaldo).
select public._restaurar_funcion('public._documento_trabajador_puede(text,boolean)', '20261027T1905_l1a_fichar_en_el_servidor');
select public._restaurar_funcion('public.employee_clock_status(uuid)', '20261027T1905_l1a_fichar_en_el_servidor');
select public._restaurar_funcion('public.add_manual_clock_entry(uuid,text,timestamp with time zone,text,text,boolean)', '20261027T1905_l1a_fichar_en_el_servidor');
select public._restaurar_funcion('public._clock_entry_quien_y_hora()', '20261027T1905_l1a_fichar_en_el_servidor');

-- 6, 5 y 3 · Lo nuevo, fuera.
drop function if exists public.empleados_datos_privados(uuid);
drop function if exists public.ausencias_visibles(date, date, uuid[]);
drop function if exists public.fichar(uuid, text, text, uuid, double precision, double precision, timestamptz, timestamptz, text, boolean, integer, text, text, boolean, text);
drop function if exists public._distancia_metros(double precision, double precision, double precision, double precision);
drop function if exists public.current_user_ve_persona(uuid, uuid);

-- 2 · Las columnas nuevas.
alter table public.clock_entries drop column if exists anonimizado_at;
alter table public.clock_entries drop column if exists ubicacion_borrada_at;
alter table public.clock_entries drop column if exists declared_at;
alter table public.clock_entries drop column if exists within_radius;
alter table public.clock_entries drop column if exists distance_m;
