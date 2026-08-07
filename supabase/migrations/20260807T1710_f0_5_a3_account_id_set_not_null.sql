-- Aplicada: 2026-08-07 por MCP (verificado: las 15 con not_null + índice + trigger)
-- F0.5 Etapa A3 · account_id NOT NULL en las 15 (tras backfill y triggers).

alter table employees                alter column account_id set not null;
alter table clock_entries            alter column account_id set not null;
alter table vacations                alter column account_id set not null;
alter table employee_availability    alter column account_id set not null;
alter table employee_formations      alter column account_id set not null;
alter table employee_notifications   alter column account_id set not null;
alter table training_path_progress   alter column account_id set not null;
alter table course_attempt           alter column account_id set not null;
alter table open_shift_requests      alter column account_id set not null;
alter table shift_swap_requests      alter column account_id set not null;
alter table schedules                alter column account_id set not null;
alter table shift_templates          alter column account_id set not null;
alter table open_shifts              alter column account_id set not null;
alter table monthly_balance_closures alter column account_id set not null;
alter table manager_permissions      alter column account_id set not null;
