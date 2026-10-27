-- supabase/vuelta-atras/20261027T1215_l00_datos_de_los_trabajadores.down.sql
--
-- Vuelta atrás de 20261027T1215_l00_datos_de_los_trabajadores (L00).
-- Deja todo como estaba el 27/10, y eso INCLUYE LO MALO:
--   · el almacén employee-documents vuelve a ser público, con anon_all;
--   · las lecturas de personal vuelven a ser de toda la cuenta;
--   · fichar vuelve a no tener condición;
--   · el PIN vuelve a employees.pin (también los que se hayan puesto después).
-- Si salta sola (la comprobación de después falla), HAY QUE VOLVER A CERRAR el
-- almacén a mano en cuanto se sepa por qué ha saltado: es la fuga de antes.
--
-- Lo único que NO devuelve: la auditoría sigue admitiendo la acción «create».
-- Quitarla del CHECK obligaría a borrar el rastro de las altas que se hayan
-- apuntado mientras tanto, y el rastro del registro de jornada no se borra.

-- Lo pendiente de esta transacción (el alta en la auditoría y la clave de
-- employee_kiosk_pin son diferidos), antes de quitar lo que lo dispara: con
-- avisos pendientes no se puede quitar un disparador ni borrar una tabla.
set constraints all immediate;

-- 6 · employee_clock_status, la de antes, byte a byte (del respaldo).
select public._restaurar_funcion('public.employee_clock_status(uuid)', '20261027T1215_l00_datos_de_los_trabajadores');

-- 7 · Los permisos de antes de las cuatro funciones sin guarda.
grant execute on function public.migrate_locations_and_staff(uuid, uuid, boolean) to authenticated;
grant execute on function public.location_labor_cost(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.location_economics(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.close_month_balance(uuid, text, date, date) to authenticated;

-- 5 · El PIN, de vuelta a employees (primero se quita el disparador que lo vacía).
drop trigger if exists trg_employee_pin_guardar on public.employees;
drop function if exists public._employee_pin_guardar();
update public.employees e set pin = k.pin from public.employee_kiosk_pin k where k.employee_id = e.id;
drop function if exists public.kiosko_comprobar_pin(uuid, text);
drop function if exists public.kiosko_con_pin(uuid[]);
drop table if exists public.employee_kiosk_pin;

-- 4 · Fichar: fuera los dos disparadores.
drop trigger if exists clock_entry_audit_alta on public.clock_entries;
drop function if exists public._clock_entry_audit_alta();
drop trigger if exists trg_clock_a_quien_y_hora on public.clock_entries;
drop function if exists public._clock_entry_quien_y_hora();

-- 3 · Los compañeros.
drop function if exists public.companeros_de_trabajo(uuid[]);

-- 2 · Las lecturas, como estaban.
drop policy employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (account_id = any (public.current_user_account_ids()));
drop policy clock_entries_read on public.clock_entries;
create policy clock_entries_read on public.clock_entries for select to authenticated
  using (account_id = any (public.current_user_account_ids()));
drop policy clock_entries_insert on public.clock_entries;
create policy clock_entries_insert on public.clock_entries for insert to authenticated
  with check (account_id = any (public.current_user_account_ids()));
drop policy vacations_read on public.vacations;
create policy vacations_read on public.vacations for select to authenticated
  using (account_id = any (public.current_user_account_ids()));
drop policy payroll_cost_read on public.payroll_cost;
create policy payroll_cost_read on public.payroll_cost for select
  using (account_id = any (public.current_user_account_ids()));
drop policy payroll_inbox_read on public.payroll_inbox;
create policy payroll_inbox_read on public.payroll_inbox for select
  using (account_id = any (public.current_user_account_ids()));
drop policy documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (exists (select 1 from public.employees e join public.locations l on l.id = e.location_id
                  where e.id = documents.employee_id and l.account_id = any (public.current_user_account_ids())));
drop policy clock_audit_read on public.clock_entry_audit;
create policy clock_audit_read on public.clock_entry_audit for select
  using (account_id = any (public.current_user_account_ids()));
drop policy clock_req_read on public.clock_correction_request;
create policy clock_req_read on public.clock_correction_request for select
  using (account_id = any (public.current_user_account_ids()));
drop policy employee_notifications_read on public.employee_notifications;
create policy employee_notifications_read on public.employee_notifications for select to authenticated
  using (account_id = any (public.current_user_account_ids()));
drop policy monthly_balance_closures_read on public.monthly_balance_closures;
create policy monthly_balance_closures_read on public.monthly_balance_closures for select to authenticated
  using (account_id = any (public.current_user_account_ids()));

-- 1 · El almacén, como estaba (público y con anon_all).
drop policy if exists employee_documents_leer on storage.objects;
drop policy if exists employee_documents_subir on storage.objects;
drop policy if exists employee_documents_cambiar on storage.objects;
drop policy if exists employee_documents_borrar on storage.objects;
create policy anon_all_employee_documents on storage.objects for all
  using (bucket_id = 'employee-documents'::text) with check (bucket_id = 'employee-documents'::text);
update storage.buckets set public = true where id = 'employee-documents';
drop function if exists public._documento_trabajador_puede(text, boolean);
