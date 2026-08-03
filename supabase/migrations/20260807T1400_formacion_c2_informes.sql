-- ============================================================================
-- Folvy · Módulo de FORMACIÓN — CAPA 2 (informes de lectura)
-- ----------------------------------------------------------------------------
-- Diseño: docs/folvy_formacion_diseno.md §5 y §4-Pieza 1. Encargo: docs/
-- ENCARGO_CODE_formacion_c2.md. Depende de C1 (supabase/migrations/
-- 20260806T1500_formacion_c1.sql + 20260806T1600_seed_curso_alergenos.sql),
-- ya en main.
--
-- 4 RPCs de SOLO LECTURA, mismo patrón/guard que
-- 20260805T1400_alergenos_matriz_cumplimiento_rpcs.sql (Julio: "misma regla
-- que en el informe de alérgenos"):
--   guard = current_user_is_admin() OR current_user_is_admin_or_manager_of(p_account_id)
-- (más estricto que belongs_to_account: esto es dato de cumplimiento de
-- oficina, no algo que un worker cualquiera deba poder leer en bruto).
--
-- INVARIANTE que gobierna "vigente" (regla dura de Julio): sign_course_attempt
-- (C1) YA exige passed=true antes de dejar firmar — así que
-- course_signature.attempt_id apuntando a una fila implica passed=true por
-- construcción. Aun así comprobamos passed=true explícitamente en el intento
-- (defensa en profundidad, coincide con la redacción literal del encargo).
--
-- Aplicar por SQL Editor a mano. Verificar cada función con una query aparte
-- (el SQL Editor solo devuelve la salida de la ÚLTIMA consulta).
--
-- Aplicada:
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) training_compliance_matrix — una fila por empleado ACTIVO de la cuenta
-- (o de un local, si p_location_id), con un jsonb {course_code: {state,
-- completed_at, expires_at, score_pct, signed}} para cada curso PUBLICADO
-- que tenga al menos una asignación en esta cuenta.
--
-- "Aplica a este empleado" = igual criterio de expansión que
-- my_pending_courses/start_course_attempt (C1): employee_id directo, o
-- role = employee.position, o location_id = employee.location_id.
--
-- Estados (precedencia, de más a menos fuerte):
--   no_aplica  → el curso no alcanza a este empleado (ninguna asignación
--                de las que targetean el curso lo incluye)
--   pendiente  → alcanza, pero nunca se empezó un intento
--   en_curso   → hay intento, pero no está (firmado Y passed=true)
--   caducado   → firmado+aprobado, pero expiró (course.reeval_months)
--   vigente    → firmado+aprobado y no expirado (o reeval_months NULL = no caduca)
-- ─────────────────────────────────────────────────────────────────────
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
    select distinct c.id as course_id, c.code, c.reeval_months
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
      (exists (
        select 1 from public.course_assignment ca
        where ca.course_id = rc.course_id
          and ca.account_id = p_account_id
          and (
            ca.employee_id = e.id
            or (ca.role is not null and ca.role = e.position)
            or (ca.location_id is not null and ca.location_id = e.location_id)
          )
      )) as applies,
      best.id as attempt_id,
      best.finished_at,
      best.passed,
      best.score_pct,
      best.signed_at
    from emp e
    cross join relevant_courses rc
    -- "Mejor" evidencia entre TODOS los intentos del empleado para este curso,
    -- no solo el último: si ya existe un intento firmado+aprobado en el
    -- historial, ESE manda (así reactiva/reevaluaciones con un intento nuevo
    -- sin firmar todavía no le hacen perder su vigencia ya acreditada). Si
    -- ninguno está firmado+aprobado, cae al intento más reciente (para poder
    -- distinguir pendiente/en_curso).
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
      employee_id,
      course_code,
      case
        when not applies then 'no_aplica'
        when attempt_id is null then 'pendiente'
        when not (signed_at is not null and coalesce(passed, false)) then 'en_curso'
        when reeval_months is null then 'vigente'
        when signed_at + (reeval_months || ' months')::interval > now() then 'vigente'
        else 'caducado'
      end as state,
      finished_at as completed_at,
      case
        when signed_at is not null and reeval_months is not null
          then signed_at + (reeval_months || ' months')::interval
        else null
      end as expires_at,
      score_pct,
      (signed_at is not null and coalesce(passed, false)) as signed
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

-- ─────────────────────────────────────────────────────────────────────
-- 2) training_gaps — panel accionable "quién va tarde", ordenado por
-- urgencia. 4 tipos de hueco (los que pide el encargo, literal):
--   nunca_hecho  → alcanzado por el curso, cero intentos
--   sin_firmar   → aprobó el test pero no ha firmado
--   caducado     → estuvo vigente, ya expiró
--   caduca_pronto→ vigente pero expira dentro de p_days_ahead días
--
-- DEUDA DECLARADA (no se esconde): un intento SUSPENDIDO (finished_at no
-- nulo, passed=false) que no tiene ningún intento posterior no genera fila
-- aquí — el encargo solo pidió estos 4 tipos y "reprobado, pendiente de
-- repetir" no es ninguno de ellos. Lo más cercano ya existe en el
-- seguimiento de C1 (CoursesPage → resolveTrackingRows, estado
-- 'suspendido'). Señalar a Julio si se quiere un 5º gap_kind en C3.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.training_gaps(
  p_account_id uuid,
  p_days_ahead int default 30
) returns table(
  employee_name text,
  course_title text,
  gap_kind text,
  due_at timestamptz,
  days_left int
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_gaps: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with emp as (
    select e.id, e.name, e.position, e.location_id
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id and e.active = true
  ),
  relevant_courses as (
    select distinct c.id as course_id, c.title, c.reeval_months
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id and c.status = 'published'
  ),
  cell as (
    select
      e.id as employee_id,
      e.name as employee_name,
      rc.course_id,
      rc.title as course_title,
      rc.reeval_months,
      (
        select min(ca.due_at) from public.course_assignment ca
        where ca.course_id = rc.course_id and ca.account_id = p_account_id
          and (
            ca.employee_id = e.id
            or (ca.role is not null and ca.role = e.position)
            or (ca.location_id is not null and ca.location_id = e.location_id)
          )
      ) as due_at,
      (exists (
        select 1 from public.course_assignment ca
        where ca.course_id = rc.course_id and ca.account_id = p_account_id
          and (
            ca.employee_id = e.id
            or (ca.role is not null and ca.role = e.position)
            or (ca.location_id is not null and ca.location_id = e.location_id)
          )
      )) as applies,
      best.id as attempt_id,
      best.passed,
      best.signed_at
    from emp e
    cross join relevant_courses rc
    -- Misma regla que en training_compliance_matrix: el intento firmado+
    -- aprobado manda si existe en el historial, aunque haya un intento más
    -- reciente sin firmar (reevaluación en curso no debe generar "nunca_hecho"
    -- ni "sin_firmar" falsos sobre una acreditación ya vigente).
    left join lateral (
      select at.id, at.passed,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at
      from public.course_attempt at
      join public.course_assignment ca2 on ca2.id = at.assignment_id
      where at.employee_id = e.id and ca2.course_id = rc.course_id and ca2.account_id = p_account_id
      order by
        ((select max(s2.signed_at) from public.course_signature s2 where s2.attempt_id = at.id) is not null
         and coalesce(at.passed, false)) desc,
        at.started_at desc
      limit 1
    ) best on true
  ),
  classified as (
    select
      employee_name,
      course_title,
      due_at,
      case
        when not applies then null
        when attempt_id is null then 'nunca_hecho'
        when coalesce(passed, false) and signed_at is null then 'sin_firmar'
        when signed_at is not null and coalesce(passed, false) and reeval_months is not null
             and signed_at + (reeval_months || ' months')::interval <= now()
          then 'caducado'
        when signed_at is not null and coalesce(passed, false) and reeval_months is not null
             and signed_at + (reeval_months || ' months')::interval <= now() + (p_days_ahead || ' days')::interval
          then 'caduca_pronto'
        else null
      end as gap_kind
    from cell
  )
  select
    employee_name,
    course_title,
    gap_kind,
    due_at,
    case when due_at is not null then (extract(day from due_at - now()))::int else null end as days_left
  from classified
  where gap_kind is not null
  order by
    case gap_kind
      when 'caducado' then 0
      when 'caduca_pronto' then 1
      when 'sin_firmar' then 2
      when 'nunca_hecho' then 3
      else 4
    end,
    due_at nulls last;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) training_data_health — honestidad del dato: 4 categorías, cada una con
-- su recuento y hasta 5 nombres de muestra (para no devolver listas enormes
-- a un panel plegable).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.training_data_health(
  p_account_id uuid
) returns table(
  check_kind text,
  item_count int,
  sample_names text[]
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_data_health: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with emp as (
    select e.id, e.name, e.dni
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id and e.active = true
  ),
  sin_dni as (
    select name from emp where dni is null or dni = ''
  ),
  sin_acceso as (
    select e.name from emp e
    where not exists (
      select 1 from public.user_profiles up
      where up.employee_id = e.id and up.account_id = p_account_id and up.active = true
    )
  ),
  curso_sin_asignar as (
    select c.title as name
    from public.course c
    where c.status = 'published'
      and (c.account_id = p_account_id or c.account_id is null)
      and not exists (
        select 1 from public.course_assignment ca
        where ca.course_id = c.id and ca.account_id = p_account_id
      )
  ),
  asignacion_sin_fecha as (
    select coalesce(c.title, ca.id::text) as name
    from public.course_assignment ca
    join public.course c on c.id = ca.course_id
    where ca.account_id = p_account_id and ca.due_at is null
  )
  select 'sin_dni'::text, count(*)::int, (array_agg(name order by name))[1:5] from sin_dni
  union all
  select 'sin_acceso'::text, count(*)::int, (array_agg(name order by name))[1:5] from sin_acceso
  union all
  select 'curso_sin_asignar'::text, count(*)::int, (array_agg(name order by name))[1:5] from curso_sin_asignar
  union all
  select 'asignacion_sin_fecha'::text, count(*)::int, (array_agg(name order by name))[1:5] from asignacion_sin_fecha;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) training_course_summary — ficha por curso: base legal, contenidos
-- impartidos (títulos de secciones, en orden), y el embudo asignados →
-- formados (aprobado el test) → firmados, con % de cumplimiento sobre
-- firmados/asignados (firmar es lo que acredita, no solo aprobar).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.training_course_summary(
  p_account_id uuid
) returns table(
  course_id uuid,
  course_code text,
  course_title text,
  legal_basis text,
  section_titles text[],
  assigned_count int,
  trained_count int,
  signed_count int,
  compliance_pct numeric
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'training_course_summary: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with relevant_courses as (
    select distinct c.id, c.code, c.title, c.legal_basis
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id
  ),
  emp as (
    select e.id, e.position, e.location_id
    from public.employees e
    join public.locations l on l.id = e.location_id
    where l.account_id = p_account_id and e.active = true
  ),
  targeted as (
    select rc.id as course_id, e.id as employee_id
    from relevant_courses rc
    cross join emp e
    where exists (
      select 1 from public.course_assignment ca
      where ca.course_id = rc.id and ca.account_id = p_account_id
        and (
          ca.employee_id = e.id
          or (ca.role is not null and ca.role = e.position)
          or (ca.location_id is not null and ca.location_id = e.location_id)
        )
    )
  ),
  -- "passed"/"has_signature" son EXISTENCIA sobre TODO el historial de
  -- intentos, no solo el último — igual regla que en training_compliance_matrix
  -- y training_gaps: un intento nuevo sin firmar (reevaluación en curso) no
  -- debe hacer perder el "formado"/"firmado" ya acreditado por un intento
  -- anterior.
  attempt_status as (
    select
      t.course_id,
      t.employee_id,
      (exists (
        select 1 from public.course_attempt at
        join public.course_assignment ca2 on ca2.id = at.assignment_id
        where at.employee_id = t.employee_id and ca2.course_id = t.course_id and ca2.account_id = p_account_id
          and at.passed = true
      )) as passed,
      (exists (
        select 1 from public.course_attempt at
        join public.course_assignment ca2 on ca2.id = at.assignment_id
        join public.course_signature s on s.attempt_id = at.id
        where at.employee_id = t.employee_id and ca2.course_id = t.course_id and ca2.account_id = p_account_id
      )) as has_signature
    from targeted t
  ),
  sections as (
    select course_id, array_agg(title order by ord) as titles
    from public.course_section
    group by course_id
  ),
  counts as (
    select
      rc.id as course_id,
      (select count(*) from targeted t where t.course_id = rc.id)::int as assigned_count,
      (select count(*) from attempt_status a where a.course_id = rc.id and coalesce(a.passed, false))::int as trained_count,
      (select count(*) from attempt_status a where a.course_id = rc.id and a.has_signature)::int as signed_count
    from relevant_courses rc
  )
  select
    rc.id,
    rc.code,
    rc.title,
    rc.legal_basis,
    coalesce(s.titles, array[]::text[]),
    co.assigned_count,
    co.trained_count,
    co.signed_count,
    case when co.assigned_count > 0
      then round(co.signed_count::numeric / co.assigned_count * 100, 1)
      else 0
    end as compliance_pct
  from relevant_courses rc
  left join sections s on s.course_id = rc.id
  join counts co on co.course_id = rc.id
  order by rc.title;
end;
$function$;

grant execute on function public.training_compliance_matrix(uuid, uuid, boolean) to authenticated;
grant execute on function public.training_gaps(uuid, int) to authenticated;
grant execute on function public.training_data_health(uuid) to authenticated;
grant execute on function public.training_course_summary(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Guard: aborta si alguna de las 4 no quedó creada.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'training_compliance_matrix') then
    raise exception 'MIGRACIÓN FALLIDA: falta training_compliance_matrix';
  end if;
  if not exists (select 1 from pg_proc where proname = 'training_gaps') then
    raise exception 'MIGRACIÓN FALLIDA: falta training_gaps';
  end if;
  if not exists (select 1 from pg_proc where proname = 'training_data_health') then
    raise exception 'MIGRACIÓN FALLIDA: falta training_data_health';
  end if;
  if not exists (select 1 from pg_proc where proname = 'training_course_summary') then
    raise exception 'MIGRACIÓN FALLIDA: falta training_course_summary';
  end if;
end $$;

-- ── VERIFICACIÓN (ejecutar POR SEPARADO, en otra pestaña/Run — regla §3) ────
-- select proname, pg_get_function_arguments(oid) from pg_proc
--  where proname in ('training_compliance_matrix','training_gaps',
--                     'training_data_health','training_course_summary')
--  order by 1;
-- Esperado: las 4 filas, con los argumentos declarados arriba.
--
-- select * from public.training_compliance_matrix('<account_id real>'::uuid, null, false);
-- select * from public.training_gaps('<account_id real>'::uuid, 30);
-- select * from public.training_data_health('<account_id real>'::uuid);
-- select * from public.training_course_summary('<account_id real>'::uuid);
-- (ejecutar logueado como admin/manager de esa cuenta; auth.uid() en el SQL
-- Editor es NULL → estas 4 fallarán con "sin acceso" si se corren ahí
-- directamente sin sesión. Probar desde la app o con service_role.)
