-- ============================================================================
-- Formación C4 — Pieza A (cierre móvil): my_pending_courses() y
-- start_course_attempt() deben reflejar requires_practical/practical_ok.
--
-- Sin este parche, un trabajador que supera el test y firma en un curso con
-- requires_practical=true vería "Superado" en su lista y la pantalla de
-- diploma en el móvil, exactamente el "vender un tie como victoria" que
-- training_compliance_matrix/training_gaps (20260809T1000) ya prohíben en el
-- informe de oficina. Este parche cierra el mismo hueco en el lado del
-- empleado.
--
-- start_course_attempt() devuelve jsonb (sin RETURNS TABLE): añadir
-- requiresPractical al objeto course es una modificación sin riesgo de la
-- ambigüedad de columnas de C2 (esa clase de bug es específica de RETURNS
-- TABLE con variables OUT implícitas).
--
-- my_pending_courses() SÍ es RETURNS TABLE, pero esta migración NO añade
-- ninguna columna nueva a su firma de salida (assignment_id, course_id,
-- course_code, course_title, delivery_mode, estimated_minutes, reeval_months,
-- due_at, status, attempt_id, score_pct, passed, signed_at se mantienen
-- exactamente igual) — solo cambia la expresión CASE interna que calcula
-- `status`, y la nueva subconsulta lateral (`prac`) referencia todo
-- cualificado (pi.*, pc.*, pc2.*), sin ningún bare reference a los 13
-- nombres de columna de salida. No se reintroduce la clase de bug de C2.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) start_course_attempt — añade requiresPractical al course jsonb.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.start_course_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_employee_id uuid;
  v_account_id uuid;
  v_assignment public.course_assignment%rowtype;
  v_emp_position text;
  v_emp_location_id uuid;
  v_course public.course%rowtype;
  v_attempt_id uuid;
  v_sections jsonb;
  v_questions jsonb;
begin
  select * into v_employee_id, v_account_id from public.current_employee_and_account();
  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  select e.position, e.location_id into v_emp_position, v_emp_location_id
  from public.employees e where e.id = v_employee_id;

  select ca.* into v_assignment
  from public.course_assignment ca
  where ca.id = p_assignment_id
    and ca.account_id = v_account_id
    and (
      ca.employee_id = v_employee_id
      or (ca.role is not null and ca.role = v_emp_position)
      or (ca.location_id is not null and ca.location_id = v_emp_location_id)
    );
  if not found then
    raise exception 'Asignación no encontrada o no pertenece a este empleado';
  end if;

  select c.* into v_course from public.course c where c.id = v_assignment.course_id;
  if not found then
    raise exception 'Curso no encontrado';
  end if;

  -- Reutiliza un intento en curso (no finalizado) en vez de duplicar por cada
  -- refresco de pantalla.
  select a.id into v_attempt_id
  from public.course_attempt a
  where a.assignment_id = p_assignment_id and a.employee_id = v_employee_id and a.finished_at is null
  order by a.started_at desc
  limit 1;

  if v_attempt_id is null then
    insert into public.course_attempt (assignment_id, employee_id, answers)
    values (p_assignment_id, v_employee_id, '{}'::jsonb)
    returning id into v_attempt_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'ord', s.ord, 'title', s.title, 'body', s.body, 'mediaUrl', s.media_url
  ) order by s.ord), '[]'::jsonb) into v_sections
  from public.course_section s where s.course_id = v_course.id;

  -- ⚠️ Deliberadamente SIN is_correct ni explanation: la solución no sale del
  -- servidor hasta submit_course_attempt.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'ord', q.ord, 'text', q.text,
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text) order by o.id), '[]'::jsonb)
      from public.course_option o where o.question_id = q.id
    )
  ) order by q.ord), '[]'::jsonb) into v_questions
  from public.course_question q where q.course_id = v_course.id;

  return jsonb_build_object(
    'attemptId', v_attempt_id,
    'course', jsonb_build_object(
      'id', v_course.id, 'code', v_course.code, 'title', v_course.title,
      'summary', v_course.summary, 'legalBasis', v_course.legal_basis,
      'deliveryMode', v_course.delivery_mode, 'estimatedMinutes', v_course.estimated_minutes,
      'passThresholdPct', v_course.pass_threshold_pct, 'version', v_course.version,
      'requiresPractical', v_course.requires_practical
    ),
    'sections', v_sections,
    'questions', v_questions
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) my_pending_courses — el estado 'firmado' ya no basta con sig.id is not
--    null: si el curso exige práctica, hace falta además practical_ok. Nuevo
--    estado intermedio: 'pendiente_practica'.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.my_pending_courses()
returns table (
  assignment_id uuid,
  course_id uuid,
  course_code text,
  course_title text,
  delivery_mode text,
  estimated_minutes int,
  reeval_months int,
  due_at timestamptz,
  status text,
  attempt_id uuid,
  score_pct numeric,
  passed boolean,
  signed_at timestamptz
)
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_employee_id uuid;
  v_account_id uuid;
begin
  select * into v_employee_id, v_account_id from public.current_employee_and_account();
  if v_employee_id is null then
    raise exception 'Sin sesión de empleado válida';
  end if;

  return query
  select
    ca.id as assignment_id,
    c.id as course_id,
    c.code as course_code,
    c.title as course_title,
    c.delivery_mode,
    c.estimated_minutes,
    c.reeval_months,
    ca.due_at,
    case
      when sig.id is not null and (not c.requires_practical or coalesce(prac.practical_ok, false)) then 'firmado'
      when sig.id is not null then 'pendiente_practica'
      when att.finished_at is not null and coalesce(att.passed, false) = false then 'suspendido'
      when att.started_at is not null and att.finished_at is null then 'en_curso'
      else 'pendiente'
    end as status,
    att.id as attempt_id,
    att.score_pct,
    att.passed,
    sig.signed_at
  from public.course_assignment ca
  join public.course c on c.id = ca.course_id
  join public.employees e on e.id = v_employee_id
  left join lateral (
    select a.* from public.course_attempt a
    where a.assignment_id = ca.id and a.employee_id = v_employee_id
    order by a.started_at desc
    limit 1
  ) att on true
  left join lateral (
    -- Vacuamente true si el curso no tiene gestos definidos: requires_practical
    -- sin course_practical_item es un curso mal configurado en oficina, no
    -- motivo para bloquear al trabajador (mismo criterio que
    -- training_compliance_matrix/training_gaps, 20260809T1000).
    select (
      not exists (
        select 1 from public.course_practical_item pi
        where pi.course_id = c.id
          and not exists (
            select 1 from public.course_practical_check pc
            where pc.item_id = pi.id and pc.attempt_id = att.id and pc.checked = true
              and pc.verified_at = (
                select max(pc2.verified_at) from public.course_practical_check pc2
                where pc2.item_id = pi.id and pc2.attempt_id = att.id
              )
          )
      )
    ) as practical_ok
  ) prac on true
  left join lateral (
    select s.* from public.course_signature s
    where s.attempt_id = att.id
    order by s.signed_at desc
    limit 1
  ) sig on true
  where ca.account_id = v_account_id
    and (
      ca.employee_id = v_employee_id
      or (ca.role is not null and ca.role = e.position)
      or (ca.location_id is not null and ca.location_id = e.location_id)
    )
  order by ca.due_at nulls last, c.title;
end;
$$;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) GUARD — existencia y firma de ambas funciones.
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.my_pending_courses()') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la función my_pending_courses()';
  end if;
  if to_regprocedure('public.start_course_attempt(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la función start_course_attempt(uuid)';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Verificación recomendada tras aplicar (Julio, en Supabase, con un curso de
-- prueba que tenga requires_practical=true y al menos un course_practical_item):
--
--   1) Asigna el curso a un empleado de prueba, complétalo desde el móvil
--      (teoría + test + firma).
--   2) select status from public.my_pending_courses(); -- ejecutado como ese
--      empleado (o revisa en el móvil): debe salir 'pendiente_practica', NO
--      'firmado'.
--   3) Verifica la práctica desde Formación → curso → Seguimiento → "Verificar
--      ahora".
--   4) Repite la consulta: debe pasar a 'firmado'.
--
-- Si el curso NO exige práctica, el comportamiento debe ser idéntico al de
-- antes de esta migración (sig.id is not null ⇒ 'firmado' directo).
-- ============================================================================
