-- Aplicada: 2026-08-07 por MCP. F0.5 Etapa B (bloque 2) · 5 tablas con matices -> account_id directo,
-- conservando: auto-verificación de empleado (course_attempt), "propio empleado" (employee_notifications),
-- "propio usuario" (manager_permissions) y "manager del local + auto-solicitud" (vacations).
drop policy if exists course_attempt_select on public.course_attempt;
create policy course_attempt_select on public.course_attempt as permissive for select to authenticated
  using (current_user_is_admin_or_manager_of(account_id) or current_user_is_employee(course_attempt.employee_id, account_id));

drop policy if exists employee_notifications_read   on public.employee_notifications;
drop policy if exists employee_notifications_insert on public.employee_notifications;
drop policy if exists employee_notifications_update on public.employee_notifications;
drop policy if exists employee_notifications_delete on public.employee_notifications;
create policy employee_notifications_read on public.employee_notifications as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy employee_notifications_delete on public.employee_notifications as permissive for delete to authenticated using (current_user_is_admin_of(account_id));
create policy employee_notifications_insert on public.employee_notifications as permissive for insert to authenticated
  with check ((account_id = any(current_user_account_ids())) and ((sender_employee_id is null)
    or exists(select 1 from user_profiles up where up.user_id = auth.uid() and up.employee_id = employee_notifications.sender_employee_id)
    or current_user_is_admin_of(account_id)));
create policy employee_notifications_update on public.employee_notifications as permissive for update to authenticated
  using (current_user_is_admin_of(account_id) or exists(select 1 from user_profiles up where up.user_id = auth.uid() and up.employee_id = employee_notifications.employee_id))
  with check (current_user_is_admin_of(account_id) or exists(select 1 from user_profiles up where up.user_id = auth.uid() and up.employee_id = employee_notifications.employee_id));

drop policy if exists manager_permissions_read  on public.manager_permissions;
drop policy if exists manager_permissions_write on public.manager_permissions;
create policy manager_permissions_read on public.manager_permissions as permissive for select to authenticated
  using (exists(select 1 from user_profiles up where up.id = manager_permissions.user_profile_id and up.user_id = auth.uid()) or current_user_is_admin_of(account_id));
create policy manager_permissions_write on public.manager_permissions as permissive for all to authenticated
  using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists vacations_read   on public.vacations;
drop policy if exists vacations_insert on public.vacations;
drop policy if exists vacations_update on public.vacations;
drop policy if exists vacations_delete on public.vacations;
create policy vacations_read on public.vacations as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy vacations_delete on public.vacations as permissive for delete to authenticated
  using (current_user_is_admin_of(account_id)
    or exists(select 1 from employees e where e.id = vacations.employee_id and current_user_manages_location(e.location_id))
    or (current_user_is_employee(vacations.employee_id, account_id) and vacations.status = 'solicitada'));
create policy vacations_insert on public.vacations as permissive for insert to authenticated
  with check (current_user_is_admin_of(account_id)
    or exists(select 1 from employees e where e.id = vacations.employee_id and current_user_manages_location(e.location_id))
    or (current_user_is_employee(vacations.employee_id, account_id) and vacations.status = 'solicitada'));
create policy vacations_update on public.vacations as permissive for update to authenticated
  using (current_user_is_admin_of(account_id)
    or exists(select 1 from employees e where e.id = vacations.employee_id and current_user_manages_location(e.location_id))
    or (current_user_is_employee(vacations.employee_id, account_id) and vacations.status = 'solicitada'))
  with check (current_user_is_admin_of(account_id)
    or exists(select 1 from employees e where e.id = vacations.employee_id and current_user_manages_location(e.location_id))
    or (current_user_is_employee(vacations.employee_id, account_id) and vacations.status = any(array['solicitada','cancelada'])));

drop policy if exists employee_formations_read  on public.employee_formations;
drop policy if exists employee_formations_write on public.employee_formations;
create policy employee_formations_read on public.employee_formations as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy employee_formations_write on public.employee_formations as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));
