-- Aplicada: 2026-08-07 por MCP. F0.5 Etapa B (bloque 1) · 9 tablas de patrón puro de cuenta -> RLS account_id directo.
drop policy if exists employees_read  on public.employees;
drop policy if exists employees_write on public.employees;
create policy employees_read  on public.employees as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy employees_write on public.employees as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists schedules_read  on public.schedules;
drop policy if exists schedules_write on public.schedules;
create policy schedules_read  on public.schedules as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy schedules_write on public.schedules as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists shift_templates_read  on public.shift_templates;
drop policy if exists shift_templates_write on public.shift_templates;
create policy shift_templates_read  on public.shift_templates as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy shift_templates_write on public.shift_templates as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists open_shifts_read  on public.open_shifts;
drop policy if exists open_shifts_write on public.open_shifts;
create policy open_shifts_read  on public.open_shifts as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy open_shifts_write on public.open_shifts as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists monthly_balance_closures_read  on public.monthly_balance_closures;
drop policy if exists monthly_balance_closures_write on public.monthly_balance_closures;
create policy monthly_balance_closures_read  on public.monthly_balance_closures as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy monthly_balance_closures_write on public.monthly_balance_closures as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists open_shift_requests_read  on public.open_shift_requests;
drop policy if exists open_shift_requests_write on public.open_shift_requests;
create policy open_shift_requests_read  on public.open_shift_requests as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy open_shift_requests_write on public.open_shift_requests as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists employee_availability_read  on public.employee_availability;
drop policy if exists employee_availability_write on public.employee_availability;
create policy employee_availability_read  on public.employee_availability as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy employee_availability_write on public.employee_availability as permissive for all to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

drop policy if exists shift_swap_requests_read   on public.shift_swap_requests;
drop policy if exists shift_swap_requests_insert on public.shift_swap_requests;
drop policy if exists shift_swap_requests_modify on public.shift_swap_requests;
drop policy if exists shift_swap_requests_delete on public.shift_swap_requests;
create policy shift_swap_requests_read   on public.shift_swap_requests as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy shift_swap_requests_insert on public.shift_swap_requests as permissive for insert to authenticated with check (account_id = any(current_user_account_ids()));
create policy shift_swap_requests_modify on public.shift_swap_requests as permissive for update to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));
create policy shift_swap_requests_delete on public.shift_swap_requests as permissive for delete to authenticated using (current_user_is_admin_of(account_id));

drop policy if exists training_path_progress_select on public.training_path_progress;
drop policy if exists training_path_progress_write  on public.training_path_progress;
create policy training_path_progress_select on public.training_path_progress as permissive for select to authenticated using (current_user_is_admin_or_manager_of(account_id) or current_user_is_admin());
create policy training_path_progress_write on public.training_path_progress as permissive for all to authenticated using (current_user_is_admin_or_manager_of(account_id) or current_user_is_admin()) with check (current_user_is_admin_or_manager_of(account_id) or current_user_is_admin());
