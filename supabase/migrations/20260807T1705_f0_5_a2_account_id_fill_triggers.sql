-- Aplicada: 2026-08-07 por MCP (verificado con insert de prueba en shift_templates -> account_id auto)
-- F0.5 Etapa A2 · triggers BEFORE INSERT/UPDATE que rellenan account_id desde el ancla si viene null.

create or replace function _fill_acc_from_employee() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.account_id is null then
    select e.account_id into new.account_id from employees e where e.id = new.employee_id;
  end if; return new;
end $$;

create or replace function _fill_acc_from_requester() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.account_id is null then
    select e.account_id into new.account_id from employees e where e.id = new.requester_id;
  end if; return new;
end $$;

create or replace function _fill_acc_from_location() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.account_id is null then
    select l.account_id into new.account_id from locations l where l.id = new.location_id;
  end if; return new;
end $$;

create or replace function _fill_acc_from_assignment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.account_id is null then
    select ca.account_id into new.account_id from course_assignment ca where ca.id = new.assignment_id;
  end if; return new;
end $$;

create or replace function _fill_acc_from_user_profile() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.account_id is null then
    select up.account_id into new.account_id from user_profiles up where up.id = new.user_profile_id;
  end if; return new;
end $$;

revoke execute on function _fill_acc_from_employee()     from public, anon, authenticated;
revoke execute on function _fill_acc_from_requester()    from public, anon, authenticated;
revoke execute on function _fill_acc_from_location()     from public, anon, authenticated;
revoke execute on function _fill_acc_from_assignment()   from public, anon, authenticated;
revoke execute on function _fill_acc_from_user_profile() from public, anon, authenticated;

create trigger trg_fill_acc before insert or update on clock_entries            for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on vacations                for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on employee_availability    for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on employee_formations      for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on employee_notifications   for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on training_path_progress   for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on open_shift_requests      for each row execute function _fill_acc_from_employee();
create trigger trg_fill_acc before insert or update on shift_swap_requests      for each row execute function _fill_acc_from_requester();
create trigger trg_fill_acc before insert or update on employees                for each row execute function _fill_acc_from_location();
create trigger trg_fill_acc before insert or update on schedules                for each row execute function _fill_acc_from_location();
create trigger trg_fill_acc before insert or update on shift_templates          for each row execute function _fill_acc_from_location();
create trigger trg_fill_acc before insert or update on open_shifts              for each row execute function _fill_acc_from_location();
create trigger trg_fill_acc before insert or update on monthly_balance_closures for each row execute function _fill_acc_from_location();
create trigger trg_fill_acc before insert or update on course_attempt           for each row execute function _fill_acc_from_assignment();
create trigger trg_fill_acc before insert or update on manager_permissions      for each row execute function _fill_acc_from_user_profile();
