-- ============================================================================
-- Formación — CIERRE DEL LANZAMIENTO: campaña de grupo, liberación automática
-- al completar fase, cron de desfase, y unificación parcial (Pieza D) de la
-- pregunta "¿este curso está vigente?".
-- Diseño: docs/folvy_formacion_itinerario_fases_rediseno.md §2.3/§4.
-- Encargo: docs/ENCARGO_CODE_formacion_lanzamiento.md.
--
-- Solo DDL + funciones + un cron.schedule (que hace upsert por nombre, mismo
-- patrón que dispatch_watchdog_scan) -- nada de datos masivos, así que va
-- todo en un solo fichero (lección de C6: la separación DDL/datos es para
-- BACKFILLS, no para funciones). Sin COMMIT/ROLLBACK en ningún DO.
--
-- ⚠️ FUNCIONES YA APLICADAS que este fichero toca -- todas con
-- CREATE OR REPLACE de MISMA firma/tipo de retorno, así que NINGUNA necesita
-- DROP: training_compliance_matrix, release_next_phase, sign_course_attempt,
-- verify_practical_items.
--
-- ⚠️ EXCEPCIÓN que SÍ necesita DROP: release_next_phase_for_group(uuid,uuid,text)
-- se sustituye por release_phase_for_group con una firma distinta (gana un
-- parámetro p_phase obligatorio y p_account_id explícito -- el encargo pide
-- "elegir qué fase, no solo la siguiente"). Firma distinta = función
-- distinta para Postgres; se hace DROP explícito para no dejar dos RPC
-- coexistiendo (regla del proyecto, ya nos ha pasado dos veces).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) RECON verificado: la base de la que depende esto (Pieza A/C/D del
--    encargo anterior, ya en main) sigue viva.
-- ────────────────────────────────────────────────────────────────────────────
do $recon$
begin
  if to_regclass('public.training_path_progress') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta training_path_progress -- aplica primero 20260812T1000_formacion_fases_nucleo.sql';
  end if;
  if to_regprocedure('public.sync_phase_assignments(uuid, uuid, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta sync_phase_assignments';
  end if;
  if to_regprocedure('public.release_next_phase(uuid, uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_next_phase';
  end if;
  if to_regprocedure('public.training_compliance_matrix(uuid, uuid, boolean)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta training_compliance_matrix';
  end if;
end
$recon$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) PIEZA D (parcial) — course_state_for_employee: la pregunta "¿este curso
--    está vigente para este empleado?" extraída UNA vez, con la misma regla
--    exacta que ya vivía dentro de training_compliance_matrix.cell_state
--    (pendiente -> en_curso -> pendiente_practica -> vigente/caducado).
--
--    Unificación TOTAL (que training_gaps y my_pending_courses también la
--    llamen) se declara fuera de esta entrega: ambas ya quedaron
--    correctamente alineadas con esta misma regla en el fix anterior
--    (20260812T1200) y tocarlas ahora sin necesidad real es más riesgo que
--    beneficio bajo la prioridad "esto hay que terminarlo ya". Lo que SÍ se
--    unifica aquí: training_compliance_matrix (la pieza más central) y el
--    quinto consumidor nuevo (detectar fase completa, más abajo) -- así el
--    quinto consumidor NO es una quinta implementación, reutiliza esta.
--
--    STABLE (sin efectos secundarios) para que el planner la trate como
--    cacheable dentro de una misma sentencia.
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
begin
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
-- 2) training_compliance_matrix -- MISMA firma/RETURNS TABLE (6 columnas, sin
--    cambios), así que CREATE OR REPLACE basta. Su cell_state ahora llama a
--    course_state_for_employee en vez de reimplementar el CASE inline --
--    sigue calculando completed_at/expires_at/score_pct/signed con su propio
--    "mejor intento" (redundante con el que resuelve course_state_for_employee
--    por dentro, aceptado a propósito: el volumen de esta cuenta es mínimo,
--    y separar "cuál es el estado" de "qué datos acompañan a ese estado"
--    mantiene la función compartida simple y reutilizable desde sitios que
--    NO necesitan esos datos extra, como el detector de fase completa).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.training_compliance_matrix(
  p_account_id uuid,
  p_location_id uuid default null,
  p_only_mandatory boolean default false
) returns table(
  employee_id uuid,
  employee_name text,
  doc_id text,
  role text,
  location_name text,
  courses jsonb
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_compliance_matrix: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with emp as (
    select e.id, e.name, e.dni, e.position, e.location_id, l.name as location_name
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id
      and e.active = true
      and (p_location_id is null or e.location_id = p_location_id)
  ),
  relevant_courses as (
    select distinct c.id as course_id, c.code, c.reeval_months, c.requires_practical
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id
      and c.status = 'published'
      and (not p_only_mandatory or c.is_mandatory)
  ),
  cell as (
    select
      e.id as employee_id,
      rc.course_id,
      rc.code as course_code,
      rc.reeval_months,
      public.course_state_for_employee(e.id, rc.course_id, p_account_id) as state,
      best.finished_at,
      best.passed,
      best.score_pct,
      best.signed_at
    from emp e
    cross join relevant_courses rc
    left join lateral (
      select at.id, at.finished_at, at.passed, at.score_pct,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at
      from public.course_attempt at
      join public.course_assignment ca2 on ca2.id = at.assignment_id
      where at.employee_id = e.id
        and ca2.course_id = rc.course_id
        and ca2.account_id = p_account_id
      order by
        ((select max(s2.signed_at) from public.course_signature s2 where s2.attempt_id = at.id) is not null
         and coalesce(at.passed, false)) desc,
        at.started_at desc
      limit 1
    ) best on true
  ),
  cell_state as (
    select
      cell.employee_id,
      cell.course_code,
      cell.state,
      cell.finished_at as completed_at,
      case
        when cell.signed_at is not null and cell.reeval_months is not null
          then cell.signed_at + (cell.reeval_months || ' months')::interval
        else null
      end as expires_at,
      cell.score_pct,
      (cell.signed_at is not null and coalesce(cell.passed, false)) as signed
    from cell
  )
  select
    e.id,
    e.name,
    e.dni,
    e.position,
    e.location_name,
    coalesce(
      (
        select jsonb_object_agg(
          cs.course_code,
          jsonb_build_object(
            'state', cs.state,
            'completed_at', cs.completed_at,
            'expires_at', cs.expires_at,
            'score_pct', cs.score_pct,
            'signed', cs.signed
          )
        )
        from cell_state cs
        where cs.employee_id = e.id
      ),
      '{}'::jsonb
    ) as courses
  from emp e
  order by e.name;
end;
$function$;

grant execute on function public.training_compliance_matrix(uuid, uuid, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) release_specific_phase -- núcleo interno SIN comprobación de permisos
--    (la hacen las funciones públicas que lo llaman, cada una con su propio
--    criterio: individual/campaña exigen admin/manager; automático/cron no
--    llevan sesión de oficina y no la necesitan -- release_by NULL = mismo
--    significado documentado desde el diseño: "NULL = automático").
--
--    Idempotente por diseño: si la fase ya no está 'pendiente' (ya liberada
--    o completada), no toca released_at/due_at de quien ya la tenía --
--    lanzar la misma campaña dos veces es un no-op para esos empleados
--    (requisito explícito del encargo).
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
begin
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

-- ────────────────────────────────────────────────────────────────────────────
-- 4) release_next_phase -- MISMA firma/tipo de retorno (jsonb) que la
--    entrega anterior, así que CREATE OR REPLACE basta. Ahora es un wrapper
--    fino sobre release_specific_phase: resuelve "la siguiente pendiente" y
--    delega. Comportamiento público sin cambios (sigue exigiendo admin/
--    manager, sigue fallando si no hay ninguna fase pendiente) -- el botón
--    ya construido en StaffPage.tsx sigue funcionando igual.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.release_next_phase(p_employee_id uuid, p_path_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_uid uuid := auth.uid();
  v_next_phase text;
begin
  select l.account_id into v_account_id
  from public.employees e
  join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;
  if v_account_id is null then
    raise exception 'release_next_phase: no se pudo resolver la cuenta del empleado';
  end if;
  if not (public.current_user_is_admin_or_manager_of(v_account_id) or public.current_user_is_admin()) then
    raise exception 'release_next_phase: sin acceso a la cuenta %', v_account_id;
  end if;

  select pp.phase into v_next_phase
  from public.training_path_progress pp
  where pp.employee_id = p_employee_id and pp.path_id = p_path_id and pp.state = 'pendiente'
  order by case pp.phase when 'dia_1' then 0 when 'dias_30' then 1 when 'dias_90' then 2 else 3 end
  limit 1;

  if v_next_phase is null then
    raise exception 'release_next_phase: no hay ninguna fase pendiente que liberar para este itinerario';
  end if;

  return public.release_specific_phase(p_employee_id, p_path_id, v_next_phase, v_uid);
end;
$function$;

grant execute on function public.release_next_phase(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) DROP de release_next_phase_for_group -- se sustituye por
--    release_phase_for_group (firma distinta: gana p_account_id explícito y
--    p_phase obligatorio). Firma distinta = función distinta para Postgres
--    (CREATE OR REPLACE con otra lista de parámetros crearía un SEGUNDO
--    overload en vez de sustituir -- dejaría dos RPC vivas, una muerta y
--    confusa). DROP explícito primero.
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.release_next_phase_for_group(uuid, uuid, text);

-- ────────────────────────────────────────────────────────────────────────────
-- 6) PIEZA A — release_phase_for_group: la campaña. p_account_id explícito
--    (nada de inferir la cuenta del path, que puede ser global) -- un único
--    chequeo de acceso al principio, más simple y más correcto que repetirlo
--    por empleado. Exige local y/o puesto (nunca "todo el mundo" sin acotar,
--    mismo criterio que antes). p_phase la elige quien llama -- puede
--    "adelantar" una fase aunque la anterior siga pendiente (caso real del
--    encargo: RRHH adelanta la fase 3 a un grupo).
--
--    Solo actúa sobre empleados que YA tienen ese (path, phase) en su
--    progreso -- si el itinerario no les aplica, ni se cuentan ni se tocan.
--    Aislamiento por empleado (un fallo puntual no aborta la campaña entera).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.release_phase_for_group(
  p_account_id uuid,
  p_path_id uuid,
  p_phase text,
  p_location_id uuid default null,
  p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_emp record;
  v_result jsonb;
  v_released integer := 0;
  v_already integer := 0;
begin
  if not (public.current_user_is_admin_or_manager_of(p_account_id) or public.current_user_is_admin()) then
    raise exception 'release_phase_for_group: sin acceso a la cuenta %', p_account_id;
  end if;
  if p_location_id is null and p_role is null then
    raise exception 'release_phase_for_group: indica al menos local o puesto';
  end if;

  for v_emp in
    select e.id
    from public.employees e
    join public.locations l on l.id = e.location_id
    where e.active = true
      and l.account_id = p_account_id
      and (p_location_id is null or e.location_id = p_location_id)
      and (p_role is null or e.position = p_role)
      and exists (
        select 1 from public.training_path_progress pp
        where pp.employee_id = e.id and pp.path_id = p_path_id and pp.phase = p_phase
      )
  loop
    begin
      v_result := public.release_specific_phase(v_emp.id, p_path_id, p_phase, v_uid);
      if coalesce((v_result ->> 'alreadyReleased')::boolean, false) then
        v_already := v_already + 1;
      else
        v_released := v_released + 1;
      end if;
    exception when others then
      raise warning 'release_phase_for_group: fallo con empleado %: %', v_emp.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('released', v_released, 'alreadyReleased', v_already, 'totalMatching', v_released + v_already);
end;
$function$;

grant execute on function public.release_phase_for_group(uuid, uuid, text, uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7) PIEZA B1 — check_phase_completion_for_assignment: "fase completa" =
--    TODOS los training_path_item de esa (path, phase) están 'vigente' para
--    ese empleado, vía course_state_for_employee (misma regla que
--    training_compliance_matrix, cero criterio nuevo). Si se cumple: marca
--    la fase 'completada' y, si auto_release=true, libera la siguiente
--    pendiente (released_by NULL = automático).
--
--    SIN chequeo de permisos propio -- se llama desde dentro de
--    sign_course_attempt/verify_practical_items, que ya resolvieron quién es
--    el empleado del intento antes de invocarla. No se expone sola al cliente.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.check_phase_completion_for_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_employee_id uuid;
  v_account_id uuid;
  v_path_item_id uuid;
  v_path_id uuid;
  v_phase text;
  v_auto_release boolean;
  v_all_vigente boolean;
  v_next_phase text;
begin
  select ca.employee_id, ca.account_id, ca.path_item_id
    into v_employee_id, v_account_id, v_path_item_id
  from public.course_assignment ca
  where ca.id = p_assignment_id;

  if v_path_item_id is null then
    return; -- no viene de un itinerario -- no hay fase que completar
  end if;

  select pit.path_id, pit.phase into v_path_id, v_phase
  from public.training_path_item pit where pit.id = v_path_item_id;

  select not exists (
    select 1 from public.training_path_item pi2
    where pi2.path_id = v_path_id and pi2.phase = v_phase
      and public.course_state_for_employee(v_employee_id, pi2.course_id, v_account_id) <> 'vigente'
  ) into v_all_vigente;

  if not v_all_vigente then
    return;
  end if;

  update public.training_path_progress
  set state = 'completada', updated_at = now()
  where employee_id = v_employee_id and path_id = v_path_id and phase = v_phase and state = 'liberada';

  if not found then
    return; -- ya estaba completada, o (no debería pasar) no estaba liberada
  end if;

  select tp.auto_release into v_auto_release from public.training_path tp where tp.id = v_path_id;
  if not coalesce(v_auto_release, false) then
    return;
  end if;

  select pp.phase into v_next_phase
  from public.training_path_progress pp
  where pp.employee_id = v_employee_id and pp.path_id = v_path_id and pp.state = 'pendiente'
  order by case pp.phase when 'dia_1' then 0 when 'dias_30' then 1 when 'dias_90' then 2 else 3 end
  limit 1;

  if v_next_phase is not null then
    perform public.release_specific_phase(v_employee_id, v_path_id, v_next_phase, null);
  end if;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8) sign_course_attempt -- MISMA firma/tipo de retorno, CREATE OR REPLACE.
--    Único cambio: al final, antes de devolver, comprueba si esta firma
--    completó la fase. Envuelto en BEGIN/EXCEPTION propio: un fallo aquí
--    JAMÁS debe impedir que la firma (acto legalmente relevante) quede
--    registrada -- si algo va mal, se avisa por warning y se sigue.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.sign_course_attempt(
  p_attempt_id uuid,
  p_signature_path text,
  p_signer_name text,
  p_signer_doc_id text
)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_employee_id uuid;
  v_account_id uuid;
  v_attempt public.course_attempt%rowtype;
  v_course_id uuid;
  v_course_version int;
  v_signature_id uuid;
  v_signed_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Sin sesión de empleado válida: no se puede firmar sin auth.uid()';
  end if;

  select * into v_employee_id, v_account_id from public.current_employee_and_account();
  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  select * into v_attempt from public.course_attempt where id = p_attempt_id;
  if not found then
    raise exception 'Intento no encontrado';
  end if;
  if v_attempt.employee_id <> v_employee_id then
    raise exception 'Este intento no pertenece al empleado autenticado';
  end if;
  if coalesce(v_attempt.passed, false) is not true then
    raise exception 'Solo se puede firmar un intento superado';
  end if;

  select ca.course_id into v_course_id from public.course_assignment ca where ca.id = v_attempt.assignment_id;
  select version into v_course_version from public.course where id = v_course_id;

  insert into public.course_signature (
    attempt_id, employee_id, signature_png, signer_name, signer_doc_id,
    auth_method, auth_uid, course_version
  ) values (
    p_attempt_id, v_employee_id, p_signature_path, p_signer_name, p_signer_doc_id,
    'employee_session', v_uid, v_course_version
  )
  returning id, signed_at into v_signature_id, v_signed_at;

  begin
    perform public.check_phase_completion_for_assignment(v_attempt.assignment_id);
  exception when others then
    raise warning 'sign_course_attempt: check_phase_completion_for_assignment falló para asignación %: %', v_attempt.assignment_id, sqlerrm;
  end;

  return jsonb_build_object('signatureId', v_signature_id, 'signedAt', v_signed_at);
end;
$$;

grant execute on function public.sign_course_attempt(uuid, text, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9) verify_practical_items -- mismo gancho, mismo criterio defensivo. Un
--    curso con requires_practical=true solo llega a 'vigente' aquí (la firma
--    sola no basta) -- por eso hace falta el mismo gancho en las dos RPC.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.verify_practical_items(
  p_attempt_id uuid,
  p_checks jsonb,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_attempt public.course_attempt%rowtype;
  v_account_id uuid;
  v_course_id uuid;
  v_signer_auth_uid uuid;
  v_check jsonb;
  v_item_id uuid;
  v_checked boolean;
  v_item_notes text;
  v_inserted_count int := 0;
begin
  if v_uid is null then
    raise exception 'Sin sesión válida: no se puede verificar sin auth.uid()';
  end if;

  select * into v_attempt from public.course_attempt where id = p_attempt_id;
  if not found then
    raise exception 'Intento no encontrado';
  end if;

  select ca.account_id, ca.course_id into v_account_id, v_course_id
  from public.course_assignment ca where ca.id = v_attempt.assignment_id;

  if not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'verify_practical_items: sin acceso a la cuenta %', v_account_id;
  end if;

  if coalesce(v_attempt.passed, false) is not true then
    raise exception 'Solo se puede verificar la práctica de un intento superado';
  end if;

  select s.auth_uid into v_signer_auth_uid
  from public.course_signature s
  where s.attempt_id = p_attempt_id
  order by s.signed_at desc
  limit 1;
  if v_signer_auth_uid is not null and v_signer_auth_uid = v_uid then
    raise exception 'El verificador no puede ser el propio trabajador que firmó el intento';
  end if;

  for v_check in select * from jsonb_array_elements(p_checks)
  loop
    v_item_id := nullif(v_check ->> 'itemId', '')::uuid;
    v_checked := coalesce((v_check ->> 'checked')::boolean, false);
    v_item_notes := coalesce(v_check ->> 'notes', p_notes);

    if v_item_id is null or not exists (
      select 1 from public.course_practical_item pi where pi.id = v_item_id and pi.course_id = v_course_id
    ) then
      raise exception 'El gesto % no pertenece al curso de este intento', v_item_id;
    end if;

    insert into public.course_practical_check (attempt_id, item_id, checked, verified_by, notes)
    values (p_attempt_id, v_item_id, v_checked, v_uid, v_item_notes);
    v_inserted_count := v_inserted_count + 1;
  end loop;

  begin
    perform public.check_phase_completion_for_assignment(v_attempt.assignment_id);
  exception when others then
    raise warning 'verify_practical_items: check_phase_completion_for_assignment falló para asignación %: %', v_attempt.assignment_id, sqlerrm;
  end;

  return jsonb_build_object('insertedCount', v_inserted_count, 'verifiedAt', now());
end;
$function$;

grant execute on function public.verify_practical_items(uuid, jsonb, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10) PIEZA B2 — release_overdue_phases: el cron de desfase. Una fase
--     'liberada' cuyo due_at (resumen de fase, ya calculado por
--     sync_phase_assignments) ya pasó, con auto_release=true y con una fase
--     siguiente todavía 'pendiente' -> se libera igual, sin esperar a que se
--     complete. Aislamiento por fila (un fallo puntual no aborta el barrido).
--     Filas con due_at NULL nunca se liberan por aquí (sin plazo, sin
--     desfase que detectar) -- solo por completar la fase.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.release_overdue_phases()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_next_phase text;
  v_count integer := 0;
begin
  for r in
    select pp.employee_id, pp.path_id
    from public.training_path_progress pp
    join public.training_path tp on tp.id = pp.path_id
    where pp.state = 'liberada'
      and tp.auto_release = true
      and pp.due_at is not null
      and pp.due_at < now()
      and exists (
        select 1 from public.training_path_progress pp2
        where pp2.employee_id = pp.employee_id and pp2.path_id = pp.path_id and pp2.state = 'pendiente'
      )
  loop
    begin
      select pp3.phase into v_next_phase
      from public.training_path_progress pp3
      where pp3.employee_id = r.employee_id and pp3.path_id = r.path_id and pp3.state = 'pendiente'
      order by case pp3.phase when 'dia_1' then 0 when 'dias_30' then 1 when 'dias_90' then 2 else 3 end
      limit 1;

      if v_next_phase is not null then
        perform public.release_specific_phase(r.employee_id, r.path_id, v_next_phase, null);
        v_count := v_count + 1;
      end if;
    exception when others then
      raise warning 'release_overdue_phases: fallo con empleado % itinerario %: %', r.employee_id, r.path_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

-- Cron diario, mismo patrón que dispatch_watchdog_scan (cron.schedule llama
-- DIRECTO a la función SQL, sin Edge Function -- no hace falta: no hay que
-- llamar a ningún servicio externo, solo mutar estado propio). cron.schedule
-- hace upsert por nombre de job -> reaplicar esto es idempotente.
select cron.schedule('formacion-fase-desfase', '0 6 * * *', $$ select public.release_overdue_phases(); $$);

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. La ejecución real (que una campaña libere de verdad,
-- que firmar el último curso de una fase la complete y libere la siguiente,
-- que el cron corra) se verifica en pantalla -- ver criterio de aceptación
-- del encargo.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regprocedure('public.course_state_for_employee(uuid, uuid, uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta course_state_for_employee';
  end if;
  if to_regprocedure('public.release_specific_phase(uuid, uuid, text, uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_specific_phase';
  end if;
  if to_regprocedure('public.release_phase_for_group(uuid, uuid, text, uuid, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_phase_for_group';
  end if;
  if to_regprocedure('public.release_next_phase_for_group(uuid, uuid, text)') is not null then
    raise exception 'MIGRACIÓN FALLIDA: release_next_phase_for_group debería haberse eliminado (DROP)';
  end if;
  if to_regprocedure('public.check_phase_completion_for_assignment(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta check_phase_completion_for_assignment';
  end if;
  if to_regprocedure('public.release_overdue_phases()') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_overdue_phases';
  end if;
  if not exists (select 1 from cron.job where jobname = 'formacion-fase-desfase') then
    raise exception 'MIGRACIÓN FALLIDA: falta el cron formacion-fase-desfase';
  end if;
  raise notice 'Lanzamiento de formación OK: campaña de grupo + auto-liberación al completar + cron de desfase + course_state_for_employee compartida.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, tras aplicar):
--
-- 1) Campaña: en pantalla (Team → Formación → botón de campaña), lanza una
--    fase a un grupo pequeño de prueba. Confirma que los empleados de ese
--    grupo reciben sus course_assignment nuevas.
--
-- 2) Auto-liberación: haz que un empleado de prueba firme (y, si aplica,
--    verifica la práctica de) TODOS los cursos de su fase 1. Comprueba que
--    training_path_progress pasa esa fase a 'completada' y la fase 2 a
--    'liberada' SOLA:
--
--   select phase, state, released_at, released_by
--     from training_path_progress
--    where employee_id = 'EMPLEADO_UUID'::uuid
--    order by phase;
--
--   released_by debe salir NULL en la fila liberada automáticamente (frente
--   a un uuid real si la liberó una persona).
--
-- 3) Cron: comprueba que el job existe y su próxima ejecución:
--
--   select jobname, schedule, active from cron.job where jobname = 'formacion-fase-desfase';
-- ============================================================================
