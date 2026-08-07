-- Aplicada 2026-08-07. Verificado: cerro 6 empleados de Llorente29 (NO los de sandbox Folvy Interno).
-- F2 · Cierre de mes en bloque ACOTADO POR CUENTA (imposible mezclar inquilinos). Recorre solo empleados
-- activos de p_account y hace UPSERT en monthly_balance_closures. Idempotente por (employee, periodo).
-- IMPORTANTE: exige p_account para no repetir el riesgo de cruzar cuentas (copias sandbox con mismo nombre).
create or replace function public.close_month_balance(
  p_account uuid, p_period_label text, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_count int := 0; r record; b record;
begin
  for r in
    select e.id, e.location_id from public.employees e
    where e.account_id = p_account and e.active = true
  loop
    select * into b from public.compute_employee_balance(r.id, p_from, p_to);
    insert into public.monthly_balance_closures(
      employee_id, location_id, account_id, period_label, period_start, period_end,
      scheduled_hours, vacation_hours, contracted_hours_period, delta, resolution)
    values (r.id, r.location_id, p_account, p_period_label, p_from, p_to,
      b.worked_hours, b.paid_absence_hours, b.contracted_hours, b.delta_hours, 'pendiente')
    on conflict (employee_id, period_start, period_end) do update set
      scheduled_hours = excluded.scheduled_hours,
      vacation_hours = excluded.vacation_hours,
      contracted_hours_period = excluded.contracted_hours_period,
      delta = excluded.delta;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;
revoke execute on function public.close_month_balance(uuid,text,date,date) from public, anon;
grant execute on function public.close_month_balance(uuid,text,date,date) to authenticated, service_role;
