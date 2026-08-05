-- ============================================================================
-- ENCARGO CODE — Toggle de opt-out del recordatorio de olvido de fichaje.
--
-- Contexto: employees.forgot_clockout_reminder (boolean, default true) ya
-- existe y ya lo respeta enqueue_clockout_reminders() (candidatos filtrados
-- por a.forgot_clockout_reminder = true). Lo que falta es que el PROPIO
-- empleado pueda cambiarlo desde su portal — hoy no puede: la policy
-- employees_write exige current_user_is_admin_of(location.account_id), y una
-- sesión de empleado (magic link, sin rol admin/manager) no la cumple.
--
-- Esta función es el único camino de escritura para el empleado: SECURITY
-- DEFINER, resuelve auth.uid() -> empleado con current_employee_and_account()
-- (mismo helper que ya usa my_pending_courses), y solo puede tocar SU PROPIA
-- fila -- no recibe employee_id como parámetro, así que no hay forma de que
-- un empleado cambie el ajuste de otro.
--
-- NO toca la detección (enqueue_clockout_reminders), el Edge de envío ni el
-- cron -- únicamente añade este RPC de lectura/escritura del propio ajuste.
-- ============================================================================

create or replace function public.set_my_clockout_reminder(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_employee_id uuid;
  v_account_id uuid;
begin
  select * into v_employee_id, v_account_id from public.current_employee_and_account();

  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  update public.employees
  set forgot_clockout_reminder = p_enabled
  where id = v_employee_id;

  return p_enabled;
end;
$function$;

grant execute on function public.set_my_clockout_reminder(boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — la función existe, es SECURITY DEFINER y authenticated puede ejecutarla.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_secdef boolean;
  v_can_exec boolean;
begin
  select prosecdef into v_secdef
  from pg_proc
  where proname = 'set_my_clockout_reminder' and pronamespace = 'public'::regnamespace;

  if v_secdef is null then
    raise exception 'MIGRACIÓN FALLIDA: set_my_clockout_reminder no se creó';
  end if;
  if not v_secdef then
    raise exception 'MIGRACIÓN FALLIDA: set_my_clockout_reminder no es SECURITY DEFINER';
  end if;

  select has_function_privilege('authenticated', 'public.set_my_clockout_reminder(boolean)', 'EXECUTE')
    into v_can_exec;
  if not v_can_exec then
    raise exception 'MIGRACIÓN FALLIDA: authenticated no tiene EXECUTE sobre set_my_clockout_reminder';
  end if;

  raise notice 'set_my_clockout_reminder creada, SECURITY DEFINER, EXECUTE concedido a authenticated.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, aparte, tras aplicar):
--
--   -- Como el propio empleado (o simulando con su employee_id conocido):
--   select public.set_my_clockout_reminder(false);
--   select id, name, forgot_clockout_reminder from employees where id = '<employee_id>';
--   -- debe quedar en false; repetir con true para revertir la prueba.
-- ============================================================================
