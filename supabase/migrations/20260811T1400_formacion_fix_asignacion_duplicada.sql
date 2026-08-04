-- ============================================================================
-- Formación — Anti-duplicado en la asignación manual de cursos.
-- Bug real visto en producción: la asignación manual (AsignarTab) no
-- comprobaba si la persona/puesto/local ya tenía el curso asignado. El
-- empleado veía el mismo curso repetido en el móvil, con intentos a medias
-- repartidos entre varias asignaciones.
--
-- adopt_mandatory_courses y assign_onboarding_training YA deduplican bien
-- (NOT EXISTS por course_id antes de insertar, C6/onboarding) -- verificado
-- por Julio, no se tocan aquí. El hueco estaba solo en la asignación manual:
--   1) Oficina: sin guardarraíl al crear (arreglo en TypeScript, no en SQL --
--      no hay forma limpia de expresar "no superada ni caducada" como
--      constraint estática; depende de firmas/intentos, es estado, no dato).
--   2) Móvil: my_pending_courses() devolvía una fila POR ASIGNACIÓN, no por
--      curso -- si ya había duplicados (los de antes de este fix, o los que
--      se colaran por una carrera), el empleado los veía todos. Esta
--      migración es la mitad SQL: colapsar a una fila por curso, quedándose
--      con la más avanzada (o la de fecha más próxima si empatan).
--
-- Solo esta función cambia. Sin tablas ni columnas nuevas -- no hace falta
-- tocar database.ts (misma firma RETURNS TABLE que ya estaba registrada).
-- ============================================================================

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
  -- Una fila por ASIGNACIÓN que alcanza a este empleado (directa, por puesto
  -- o por local) -- exactamente como antes, sin cambios aquí.
  with per_assignment as (
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
  ),
  -- 🔴 EL ARREGLO: si dos o más asignaciones caen sobre el mismo curso (el
  -- bug que reporta Julio: asignación manual repetida, o solape entre
  -- directa/por puesto/por local), nos quedamos con UNA por curso -- la más
  -- avanzada (firmado > pendiente_practica > en_curso > suspendido >
  -- pendiente) y, si empatan en avance, la de fecha límite más próxima.
  -- DISTINCT ON, no una ventana: expresa directo "una fila por course_id,
  -- la que gane el ORDER BY" sin necesitar una columna de ranking aparte.
  best_per_course as (
    select distinct on (per_assignment.course_id)
      per_assignment.assignment_id,
      per_assignment.course_id,
      per_assignment.course_code,
      per_assignment.course_title,
      per_assignment.delivery_mode,
      per_assignment.estimated_minutes,
      per_assignment.reeval_months,
      per_assignment.due_at,
      per_assignment.status,
      per_assignment.attempt_id,
      per_assignment.score_pct,
      per_assignment.passed,
      per_assignment.signed_at
    from per_assignment
    order by
      per_assignment.course_id,
      case per_assignment.status
        when 'firmado' then 0
        when 'pendiente_practica' then 1
        when 'en_curso' then 2
        when 'suspendido' then 3
        else 4
      end,
      per_assignment.due_at nulls last
  )
  select
    best_per_course.assignment_id,
    best_per_course.course_id,
    best_per_course.course_code,
    best_per_course.course_title,
    best_per_course.delivery_mode,
    best_per_course.estimated_minutes,
    best_per_course.reeval_months,
    best_per_course.due_at,
    best_per_course.status,
    best_per_course.attempt_id,
    best_per_course.score_pct,
    best_per_course.passed,
    best_per_course.signed_at
  from best_per_course
  order by best_per_course.due_at nulls last, best_per_course.course_title;
end;
$$;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. Misma firma RETURNS TABLE de siempre (13 columnas, sin
-- cambios), así que el riesgo de ambigüedad de C2 no crece: no se añade
-- ningún OUT param nuevo, y cada referencia nueva (per_assignment.*,
-- best_per_course.*) va cualificada -- auditado a mano contra los 13
-- nombres antes de entregar esto.
--
-- La ejecución real (que de verdad colapse duplicados) NO la pude probar --
-- sin acceso a la BBDD viva. Verificación manual para Julio:
--
--   1) Antes de aplicar: identifica un empleado con el mismo curso asignado
--      dos veces (o provócalo probando el fix de oficina de este mismo
--      cambio antes de que estuviera). Cuenta cuántas veces aparece en su
--      móvil (Mi Formación).
--   2) Aplica esta migración.
--   3) Recarga Mi Formación: debe aparecer UNA sola vez, con el estado más
--      avanzado de las asignaciones que tuviera.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regprocedure('public.my_pending_courses()') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la función my_pending_courses';
  end if;
  raise notice 'my_pending_courses (con colapso por curso) OK.';
end
$guard$;
-- ============================================================================
