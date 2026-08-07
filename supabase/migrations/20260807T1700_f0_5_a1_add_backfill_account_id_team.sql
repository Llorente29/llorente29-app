-- Aplicada: 2026-08-07 por MCP (verificado: 0 nulos en las 15)
-- F0.5 Etapa A1 · account_id (nullable) + backfill + índice en las 15 tablas núcleo de Team. Additive.

alter table employees                add column if not exists account_id uuid;
alter table clock_entries            add column if not exists account_id uuid;
alter table vacations                add column if not exists account_id uuid;
alter table employee_availability    add column if not exists account_id uuid;
alter table employee_formations      add column if not exists account_id uuid;
alter table employee_notifications   add column if not exists account_id uuid;
alter table training_path_progress   add column if not exists account_id uuid;
alter table course_attempt           add column if not exists account_id uuid;
alter table open_shift_requests      add column if not exists account_id uuid;
alter table shift_swap_requests      add column if not exists account_id uuid;
alter table schedules                add column if not exists account_id uuid;
alter table shift_templates          add column if not exists account_id uuid;
alter table open_shifts              add column if not exists account_id uuid;
alter table monthly_balance_closures add column if not exists account_id uuid;
alter table manager_permissions      add column if not exists account_id uuid;

update employees e set account_id = l.account_id
  from locations l where l.id = e.location_id and e.account_id is null;

update clock_entries x          set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update vacations x              set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update employee_availability x  set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update employee_formations x    set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update employee_notifications x set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update training_path_progress x set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update open_shift_requests x    set account_id = e.account_id from employees e where e.id = x.employee_id  and x.account_id is null;
update shift_swap_requests x    set account_id = e.account_id from employees e where e.id = x.requester_id and x.account_id is null;

update schedules x                set account_id = l.account_id from locations l where l.id = x.location_id and x.account_id is null;
update shift_templates x          set account_id = l.account_id from locations l where l.id = x.location_id and x.account_id is null;
update open_shifts x              set account_id = l.account_id from locations l where l.id = x.location_id and x.account_id is null;
update monthly_balance_closures x set account_id = l.account_id from locations l where l.id = x.location_id and x.account_id is null;

update course_attempt x set account_id = ca.account_id from course_assignment ca where ca.id = x.assignment_id and x.account_id is null;
update manager_permissions x set account_id = up.account_id from user_profiles up where up.id = x.user_profile_id and x.account_id is null;

create index if not exists idx_employees_account                on employees(account_id);
create index if not exists idx_clock_entries_account            on clock_entries(account_id);
create index if not exists idx_vacations_account                on vacations(account_id);
create index if not exists idx_employee_availability_account    on employee_availability(account_id);
create index if not exists idx_employee_formations_account      on employee_formations(account_id);
create index if not exists idx_employee_notifications_account   on employee_notifications(account_id);
create index if not exists idx_training_path_progress_account   on training_path_progress(account_id);
create index if not exists idx_course_attempt_account           on course_attempt(account_id);
create index if not exists idx_open_shift_requests_account      on open_shift_requests(account_id);
create index if not exists idx_shift_swap_requests_account      on shift_swap_requests(account_id);
create index if not exists idx_schedules_account               on schedules(account_id);
create index if not exists idx_shift_templates_account          on shift_templates(account_id);
create index if not exists idx_open_shifts_account              on open_shifts(account_id);
create index if not exists idx_monthly_balance_closures_account on monthly_balance_closures(account_id);
create index if not exists idx_manager_permissions_account      on manager_permissions(account_id);
