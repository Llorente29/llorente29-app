-- ============================================================================
-- Formación — 🔴 FUGA MULTI-TENANT (bloqueante, verificada en producción).
--
-- CAUSA: el baseline hace ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS
-- TO anon, authenticated. Ninguna de las migraciones de formación revocaba
-- nunca ese grant por defecto -- cada función nueva salía ejecutable por
-- anon desde el momento en que se creaba, aunque después se le añadiera un
-- GRANT EXECUTE ... TO authenticated explícito (GRANT es aditivo, nunca
-- resta el grant a anon que ya existía). El patrón correcto ya vivía en el
-- repo: 20260602T2200_connector_secret_functions.sql (REVOKE ALL FROM
-- public, anon, authenticated + GRANT selectivo). Nunca se replicó aquí.
--
-- Confirmado con has_function_privilege: 6 funciones ejecutables por anon
-- (adopt_mandatory_courses, assign_onboarding_training,
-- course_state_for_employee, my_pending_courses, release_specific_phase,
-- sync_phase_assignments), 3 de ellas sin NINGÚN guard de cuenta y
-- aceptando p_account_id/p_employee_id directos del cliente
-- (course_state_for_employee, adopt_mandatory_courses, release_specific_phase).
--
-- 🔴 AUDITORÍA PROPIA MÁS ALLÁ DE LAS 6 SEÑALADAS: al revisar el módulo
-- COMPLETO (no solo las 6), sync_phase_assignments y
-- ensure_training_path_progress tampoco comprueban quién llama -- solo
-- comprueban que el employee_id resuelva a una cuenta, no que el llamante
-- tenga derecho sobre ella. Se corrigen aquí también, no declaradas para
-- después: es la misma familia de fallo, y esta migración ya toca estas
-- funciones.
--
-- ARREGLO, dos capas (ninguna basta sola):
--   1) GUARD dentro de las funciones sin ninguno. Patrón "solo exige si hay
--      sesión real" (auth.uid() is not null): así no rompe las dos rutas
--      legítimas sin sesión HTTP -- el trigger de alta de empleado/cuenta
--      (dispara con auth.uid() de quien hace el INSERT/UPDATE, que si es
--      una cuenta nueva por auto-registro puede no tener aún user_profile)
--      y el backfill por SQL Editor (auth.uid() siempre null ahí). Cuando
--      SÍ hay sesión, exige ser admin/manager de la cuenta -- o, para las
--      que se alcanzan también desde que un EMPLEADO firma su propio curso
--      (release_specific_phase, sync_phase_assignments, course_state_for_employee,
--      vía sign_course_attempt -> check_phase_completion_for_assignment),
--      permite además que el llamante sea el propio empleado.
--   2) REVOKE EXECUTE de anon Y authenticated en TODAS las funciones de
--      formación, GRANT selectivo solo a quien de verdad la llama desde el
--      cliente (verificado por grep de supabase.rpc(...) en src/, no
--      supuesto). Las internas (nunca llamadas directo, solo desde otra
--      SECURITY DEFINER o desde un trigger) se quedan SIN grant a nadie --
--      un trigger no necesita EXECUTE concedido para disparar, y una
--      llamada anidada dentro de otra función SECURITY DEFINER corre con
--      los privilegios del owner, no los del rol que hizo la petición HTTP
--      original (mismo criterio que connector_assert_manager).
--
-- Ninguna firma ni tipo de retorno cambia -- CREATE OR REPLACE basta, sin
-- DROP, en las 6 funciones cuyo cuerpo se toca.
--
-- Sin COMMIT/ROLLBACK en el DO. El guard final verifica con
-- has_function_privilege de verdad (no solo existencia -- lección de C2)
-- dentro de un DO, para que la última sentencia del script no sea un SELECT
-- suelto (nota de método: el SQL Editor solo enseña el resultado de la
-- última sentencia que devuelve filas, y eso ha confundido ya una vez hoy).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) adopt_mandatory_courses -- guard añadido, resto del cuerpo IDÉNTICO.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.adopt_mandatory_courses(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_business_type text;
  v_global record;
  v_new_course_id uuid;
  v_question record;
  v_new_question_id uuid;
  v_adopted_count integer := 0;
begin
  if auth.uid() is not null and not (
    public.current_user_is_admin_or_manager_of(p_account_id) or public.current_user_is_admin()
  ) then
    raise exception 'adopt_mandatory_courses: sin acceso a la cuenta %', p_account_id;
  end if;

  select business_type into v_business_type from public.accounts where id = p_account_id;

  for v_global in
    select g.* from public.course g
    where g.account_id is null
      and g.is_mandatory = true
      and g.status = 'published'
      and (
        g.business_types = '{}'::text[]
        or 'todos' = any(g.business_types)
        or (v_business_type is not null and v_business_type = any(g.business_types))
      )
      and not exists (
        select 1 from public.course c2
        where c2.account_id = p_account_id and c2.adopted_from_course_id = g.id
      )
    order by g.recommended_order nulls last, g.title
  loop
    insert into public.course (
      account_id, adopted_from_course_id, code, title, summary, legal_basis,
      delivery_mode, reeval_months, is_mandatory, appcc_prerequisite,
      estimated_minutes, pass_threshold_pct, version, status,
      category, business_types, level, recommended_order, requires_practical, cover_url
    ) values (
      p_account_id, v_global.id, v_global.code, v_global.title, v_global.summary, v_global.legal_basis,
      v_global.delivery_mode, v_global.reeval_months, v_global.is_mandatory, v_global.appcc_prerequisite,
      v_global.estimated_minutes, v_global.pass_threshold_pct, 1, v_global.status,
      v_global.category, v_global.business_types, v_global.level, v_global.recommended_order,
      v_global.requires_practical, v_global.cover_url
    )
    on conflict (account_id, adopted_from_course_id) where (adopted_from_course_id is not null) do nothing
    returning id into v_new_course_id;

    if v_new_course_id is null then
      continue;
    end if;

    insert into public.course_section (course_id, ord, title, body, media_url)
    select v_new_course_id, s.ord, s.title, s.body, s.media_url
    from public.course_section s
    where s.course_id = v_global.id;

    for v_question in
      select * from public.course_question where course_id = v_global.id order by ord
    loop
      insert into public.course_question (course_id, ord, text)
      values (v_new_course_id, v_question.ord, v_question.text)
      returning id into v_new_question_id;

      insert into public.course_option (question_id, text, is_correct, explanation)
      select v_new_question_id, o.text, o.is_correct, o.explanation
      from public.course_option o
      where o.question_id = v_question.id;
    end loop;

    insert into public.course_practical_item (course_id, ord, text, help_text)
    select v_new_course_id, p.ord, p.text, p.help_text
    from public.course_practical_item p
    where p.course_id = v_global.id;

    v_adopted_count := v_adopted_count + 1;
  end loop;

  return v_adopted_count;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) assign_onboarding_training -- guard añadido tras resolver la cuenta,
--    resto IDÉNTICO. Nunca se alcanza desde la firma de un empleado (solo
--    trigger de alta/cambio de puesto + backfill), así que basta con
--    admin/manager -- sin el "o es el propio empleado" que sí necesitan
--    sync_phase_assignments/release_specific_phase/course_state_for_employee.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_onboarding_training(p_employee_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_position text;
  v_path record;
  v_count integer := 0;
begin
  select l.account_id, e.position into v_account_id, v_position
  from public.employees e
  join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;

  if v_account_id is null then
    return 0;
  end if;

  if auth.uid() is not null and not (
    public.current_user_is_admin_or_manager_of(v_account_id) or public.current_user_is_admin()
  ) then
    raise exception 'assign_onboarding_training: sin acceso a la cuenta %', v_account_id;
  end if;

  for v_path in
    select p.id
    from public.training_path p
    where p.active = true
      and (p.account_id = v_account_id or p.account_id is null)
      and (p.roles = '{}' or (v_position is not null and v_position <> '' and v_position = any(p.roles)))
      and (
        p.business_types = '{}'
        or exists (select 1 from public.accounts a where a.id = v_account_id and a.business_type = any(p.business_types))
      )
  loop
    perform public.ensure_training_path_progress(p_employee_id, v_path.id);
    v_count := v_count + public.sync_phase_assignments(p_employee_id, v_path.id, 'dia_1');
  end loop;

  return v_count;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) ensure_training_path_progress -- guard añadido, resto IDÉNTICO. Solo
--    alcanzada desde assign_onboarding_training (ya admin/manager) y desde
--    el backfill (auth.uid() null) -- nunca desde la firma de un empleado.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.ensure_training_path_progress(p_employee_id uuid, p_path_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record;
  v_account_id uuid;
begin
  select l.account_id into v_account_id
  from public.employees e join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;

  if auth.uid() is not null and v_account_id is not null and not (
    public.current_user_is_admin_or_manager_of(v_account_id) or public.current_user_is_admin()
  ) then
    raise exception 'ensure_training_path_progress: sin acceso';
  end if;

  for v_row in
    select * from (values ('dia_1', true), ('dias_30', false), ('dias_90', false)) as t(phase, is_first)
  loop
    insert into public.training_path_progress (employee_id, path_id, phase, state, released_at, due_at)
    values (
      p_employee_id, p_path_id, v_row.phase,
      case when v_row.is_first then 'liberada' else 'pendiente' end,
      case when v_row.is_first then now() else null end,
      null
    )
    on conflict (employee_id, path_id, phase) do nothing;
  end loop;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) course_state_for_employee -- guard añadido (nueva variable
--    v_caller_employee_id en el DECLARE), resto IDÉNTICO. Alcanzada tanto
--    desde training_compliance_matrix (admin/manager) como desde
--    check_phase_completion_for_assignment <- sign_course_attempt (el
--    propio empleado firmando su curso) -- necesita el "o es el propio
--    empleado". coalesce(..., false) para que la comparación NULL (llamante
--    sin ficha de empleado, p.ej. un admin puro) no cuele por NULL-propagation.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.course_state_for_employee(
  p_employee_id uuid,
  p_course_id uuid,
  p_account_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_position text;
  v_location_id uuid;
  v_requires_practical boolean;
  v_reeval_months int;
  v_applies boolean;
  v_attempt_id uuid;
  v_passed boolean;
  v_signed_at timestamptz;
  v_practical_ok boolean;
  v_caller_employee_id uuid;
begin
  if auth.uid() is not null then
    select employee_id into v_caller_employee_id from public.current_employee_and_account();
    if not (
      coalesce(v_caller_employee_id = p_employee_id, false)
      or public.current_user_is_admin_or_manager_of(p_account_id)
      or public.current_user_is_admin()
    ) then
      raise exception 'course_state_for_employee: sin acceso';
    end if;
  end if;

  select e.position, e.location_id into v_position, v_location_id
  from public.employees e where e.id = p_employee_id;

  select c.requires_practical, c.reeval_months into v_requires_practical, v_reeval_months
  from public.course c where c.id = p_course_id;

  select exists (
    select 1 from public.course_assignment ca
    where ca.course_id = p_course_id and ca.account_id = p_account_id
      and (
        ca.employee_id = p_employee_id
        or (ca.role is not null and ca.role = v_position)
        or (ca.location_id is not null and ca.location_id = v_location_id)
      )
  ) into v_applies;

  if not v_applies then
    return 'no_aplica';
  end if;

  select best.id, best.passed, best.signed_at, best.practical_ok
    into v_attempt_id, v_passed, v_signed_at, v_practical_ok
  from (
    select at.id, at.passed,
      (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at,
      (
        not exists (
          select 1 from public.course_practical_item pi
          where pi.course_id = p_course_id
            and not exists (
              select 1 from public.course_practical_check pc
              where pc.item_id = pi.id and pc.attempt_id = at.id and pc.checked = true
                and pc.verified_at = (
                  select max(pc2.verified_at) from public.course_practical_check pc2
                  where pc2.item_id = pi.id and pc2.attempt_id = at.id
                )
            )
        )
      ) as practical_ok
    from public.course_attempt at
    join public.course_assignment ca2 on ca2.id = at.assignment_id
    where at.employee_id = p_employee_id and ca2.course_id = p_course_id and ca2.account_id = p_account_id
    order by
      ((select max(s2.signed_at) from public.course_signature s2 where s2.attempt_id = at.id) is not null
       and coalesce(at.passed, false)) desc,
      at.started_at desc
    limit 1
  ) best;

  if v_attempt_id is null then
    return 'pendiente';
  end if;
  if not (v_signed_at is not null and coalesce(v_passed, false)) then
    return 'en_curso';
  end if;
  if v_requires_practical and not coalesce(v_practical_ok, false) then
    return 'pendiente_practica';
  end if;
  if v_reeval_months is null then
    return 'vigente';
  end if;
  if v_signed_at + (v_reeval_months || ' months')::interval > now() then
    return 'vigente';
  end if;
  return 'caducado';
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) sync_phase_assignments -- guard añadido (nueva variable
--    v_caller_employee_id), resto IDÉNTICO. Misma razón que
--    course_state_for_employee: se alcanza también desde
--    release_specific_phase <- check_phase_completion_for_assignment <-
--    sign_course_attempt (el propio empleado).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_phase_assignments(p_employee_id uuid, p_path_id uuid, p_phase text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_progress record;
  v_item record;
  v_count integer := 0;
  v_max_due timestamptz;
  v_caller_employee_id uuid;
begin
  select l.account_id into v_account_id
  from public.employees e
  join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;
  if v_account_id is null then
    return 0;
  end if;

  if auth.uid() is not null then
    select employee_id into v_caller_employee_id from public.current_employee_and_account();
    if not (
      coalesce(v_caller_employee_id = p_employee_id, false)
      or public.current_user_is_admin_or_manager_of(v_account_id)
      or public.current_user_is_admin()
    ) then
      raise exception 'sync_phase_assignments: sin acceso';
    end if;
  end if;

  select * into v_progress
  from public.training_path_progress pp
  where pp.employee_id = p_employee_id and pp.path_id = p_path_id and pp.phase = p_phase;
  if v_progress.id is null or v_progress.state = 'pendiente' then
    return 0;
  end if;

  for v_item in
    select pi.id as item_id, pi.course_id, pi.days_from_hire as days_from_release
    from public.training_path_item pi
    where pi.path_id = p_path_id and pi.phase = p_phase
      and not exists (
        select 1 from public.course_assignment ca2
        where ca2.employee_id = p_employee_id and ca2.course_id = pi.course_id
      )
  loop
    insert into public.course_assignment (account_id, course_id, employee_id, origin, due_at, path_item_id)
    values (
      v_account_id, v_item.course_id, p_employee_id, 'onboarding',
      case when v_progress.released_at is null then null else v_progress.released_at + (v_item.days_from_release || ' days')::interval end,
      v_item.item_id
    );
    v_count := v_count + 1;
  end loop;

  update public.course_assignment ca
  set due_at = v_progress.released_at + (pi2.days_from_hire || ' days')::interval
  from public.training_path_item pi2
  where ca.employee_id = p_employee_id
    and ca.path_item_id = pi2.id
    and pi2.path_id = p_path_id
    and pi2.phase = p_phase
    and ca.due_at is null
    and v_progress.released_at is not null;

  select max(ca3.due_at) into v_max_due
  from public.course_assignment ca3
  where ca3.employee_id = p_employee_id
    and ca3.path_item_id in (select pi4.id from public.training_path_item pi4 where pi4.path_id = p_path_id and pi4.phase = p_phase);

  update public.training_path_progress
  set due_at = v_max_due, updated_at = now()
  where id = v_progress.id;

  return v_count;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6) release_specific_phase -- guard añadido (nueva variable
--    v_caller_employee_id), resto IDÉNTICO. Misma razón: alcanzada también
--    desde check_phase_completion_for_assignment <- sign_course_attempt.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.release_specific_phase(
  p_employee_id uuid,
  p_path_id uuid,
  p_phase text,
  p_released_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_progress record;
  v_count integer := 0;
  v_account_id uuid;
  v_caller_employee_id uuid;
begin
  select l.account_id into v_account_id
  from public.employees e join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;

  if auth.uid() is not null then
    select employee_id into v_caller_employee_id from public.current_employee_and_account();
    if not (
      coalesce(v_caller_employee_id = p_employee_id, false)
      or public.current_user_is_admin_or_manager_of(v_account_id)
      or public.current_user_is_admin()
    ) then
      raise exception 'release_specific_phase: sin acceso';
    end if;
  end if;

  select * into v_progress
  from public.training_path_progress pp
  where pp.employee_id = p_employee_id and pp.path_id = p_path_id and pp.phase = p_phase;

  if v_progress.id is null then
    raise exception 'release_specific_phase: no existe progreso para empleado %, itinerario %, fase %', p_employee_id, p_path_id, p_phase;
  end if;

  if v_progress.state <> 'pendiente' then
    return jsonb_build_object('phase', p_phase, 'state', v_progress.state, 'alreadyReleased', true, 'assignmentsCreated', 0);
  end if;

  update public.training_path_progress
  set state = 'liberada', released_at = now(), released_by = p_released_by, updated_at = now()
  where id = v_progress.id;

  v_count := public.sync_phase_assignments(p_employee_id, p_path_id, p_phase);

  return jsonb_build_object('phase', p_phase, 'state', 'liberada', 'alreadyReleased', false, 'assignmentsCreated', v_count);
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) PERMISOS — revoca TODO de public/anon/authenticated en cada función de
--    formación, luego concede EXECUTE solo a quien de verdad la llama.
--    Verificado por grep de supabase.rpc(...) en src/, no supuesto.
-- ════════════════════════════════════════════════════════════════════════════

-- Revoca TODO primero (limpia cualquier grant heredado del default privilege
-- o de un GRANT explícito anterior) -- lista completa del módulo, no solo
-- las 6 señaladas.
REVOKE ALL ON FUNCTION public.sign_course_attempt(uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_course_attempt(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_course_attempt(uuid, jsonb, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_pending_courses() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_practical_items(uuid, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.training_compliance_matrix(uuid, uuid, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.training_gaps(uuid, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.training_data_health(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.training_course_summary(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_next_phase(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_phase_for_group(uuid, uuid, text, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_course_from_recipe(uuid, text, text, int, jsonb, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_is_office() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_employee_and_account() FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.adopt_mandatory_courses(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_onboarding_training(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.course_state_for_employee(uuid, uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_specific_phase(uuid, uuid, text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_phase_assignments(uuid, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_training_path_progress(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_phase_completion_for_assignment(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_overdue_phases() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_adopt_mandatory_courses_on_account_insert() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_assign_onboarding_training_on_employee_insert() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_assign_onboarding_training_on_employee_update() FROM public, anon, authenticated;

-- Concede EXECUTE solo a `authenticated`, nunca a `anon`. Los 12 RPC que el
-- cliente llama de verdad (confirmado por grep de supabase.rpc en src/) +
-- los 2 helpers que evalúan políticas RLS de formación para `authenticated`
-- (current_user_is_office, current_employee_and_account).
GRANT EXECUTE ON FUNCTION public.sign_course_attempt(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_course_attempt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_course_attempt(uuid, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pending_courses() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_practical_items(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_compliance_matrix(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_gaps(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_data_health(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_course_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_next_phase(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_phase_for_group(uuid, uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_course_from_recipe(uuid, text, text, int, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_office() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_employee_and_account() TO authenticated;

-- El resto (adopt_mandatory_courses, assign_onboarding_training,
-- course_state_for_employee, release_specific_phase, sync_phase_assignments,
-- ensure_training_path_progress, check_phase_completion_for_assignment,
-- release_overdue_phases, los 3 trg_*) se quedan SIN GRANT a nadie a
-- propósito: solo se llaman desde dentro de otra función SECURITY DEFINER
-- (corre con los privilegios del owner, no necesita EXECUTE propio) o desde
-- un trigger (dispara sin pasar por el chequeo de EXECUTE) o desde
-- cron.schedule (corre como el owner del job, no como anon/authenticated).
-- Ninguna se llama nunca directo desde el cliente -- verificado por grep,
-- no supuesto.

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- GUARD — verificación EJECUTABLE de que la fuga está cerrada, no solo de
-- que las funciones existan (lección de C2). Todo dentro de un DO: la
-- última sentencia del script nunca es un SELECT suelto (nota de método de
-- hoy: eso confunde al SQL Editor y parece un fallo cuando no lo es).
-- ════════════════════════════════════════════════════════════════════════════
do $guard$
declare
  v_internal text[] := array[
    'public.adopt_mandatory_courses(uuid)',
    'public.assign_onboarding_training(uuid)',
    'public.course_state_for_employee(uuid,uuid,uuid)',
    'public.release_specific_phase(uuid,uuid,text,uuid)',
    'public.sync_phase_assignments(uuid,uuid,text)',
    'public.ensure_training_path_progress(uuid,uuid)',
    'public.check_phase_completion_for_assignment(uuid)',
    'public.release_overdue_phases()',
    'public.trg_adopt_mandatory_courses_on_account_insert()',
    'public.trg_assign_onboarding_training_on_employee_insert()',
    'public.trg_assign_onboarding_training_on_employee_update()'
  ];
  v_public text[] := array[
    'public.sign_course_attempt(uuid,text,text,text)',
    'public.start_course_attempt(uuid)',
    'public.submit_course_attempt(uuid,jsonb,int)',
    'public.my_pending_courses()',
    'public.verify_practical_items(uuid,jsonb,text)',
    'public.training_compliance_matrix(uuid,uuid,boolean)',
    'public.training_gaps(uuid,int)',
    'public.training_data_health(uuid)',
    'public.training_course_summary(uuid)',
    'public.release_next_phase(uuid,uuid)',
    'public.release_phase_for_group(uuid,uuid,text,uuid,text)',
    'public.generate_course_from_recipe(uuid,text,text,int,jsonb,jsonb,text)',
    'public.current_user_is_office()',
    'public.current_employee_and_account()'
  ];
  v_sig text;
  v_bad text[] := '{}';
begin
  -- 1) NADIE de anon en NINGUNA de las 25.
  foreach v_sig in array (v_internal || v_public) loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      v_bad := array_append(v_bad, 'anon puede ejecutar ' || v_sig);
    end if;
  end loop;

  -- 2) Las internas: TAMPOCO authenticated.
  foreach v_sig in array v_internal loop
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      v_bad := array_append(v_bad, 'authenticated puede ejecutar (debería ser interna) ' || v_sig);
    end if;
  end loop;

  -- 3) Las públicas: authenticated SÍ debe poder (que la app siga
  --    funcionando -- criterio de aceptación explícito).
  foreach v_sig in array v_public loop
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      v_bad := array_append(v_bad, 'authenticated NO puede ejecutar (debería poder) ' || v_sig);
    end if;
  end loop;

  if array_length(v_bad, 1) > 0 then
    raise exception 'MIGRACIÓN FALLIDA -- fuga no cerrada del todo: %', array_to_string(v_bad, ' | ');
  end if;

  raise notice 'Fuga cerrada: anon sin acceso a ninguna de las % funciones de formación, authenticated con acceso exacto a las % públicas y ninguna de las % internas.',
    array_length(v_internal, 1) + array_length(v_public, 1), array_length(v_public, 1), array_length(v_internal, 1);
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN MANUAL (Julio, aparte, tras aplicar) — repetir tu propio
-- has_function_privilege si quieres verlo tabla a tabla en vez de confiar en
-- el guard de arriba:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--     has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
--     has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_puede
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in (
--       'sign_course_attempt','start_course_attempt','submit_course_attempt','my_pending_courses',
--       'verify_practical_items','training_compliance_matrix','training_gaps','training_data_health',
--       'training_course_summary','release_next_phase','release_phase_for_group','generate_course_from_recipe',
--       'current_user_is_office','current_employee_and_account',
--       'adopt_mandatory_courses','assign_onboarding_training','course_state_for_employee',
--       'release_specific_phase','sync_phase_assignments','ensure_training_path_progress',
--       'check_phase_completion_for_assignment','release_overdue_phases',
--       'trg_adopt_mandatory_courses_on_account_insert','trg_assign_onboarding_training_on_employee_insert',
--       'trg_assign_onboarding_training_on_employee_update'
--     )
--   order by anon_puede desc, authenticated_puede desc, p.proname;
--
-- Y comprobar que la app sigue funcionando: móvil del empleado (Mi
-- Formación, empezar/firmar un curso), catálogo (asignar, ver progreso de
-- cumplimiento) y campaña de grupo (Team → Formación → Liberar fase a un
-- grupo).
-- ============================================================================
