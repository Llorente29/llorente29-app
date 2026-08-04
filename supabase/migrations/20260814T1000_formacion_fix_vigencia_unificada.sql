-- ============================================================================
-- Formación — Correcciones de la auditoría externa, Piezas A + C.
-- Verificado contra producción (docs/AUDITORIA_EXTERNA_formacion.md):
--
-- A.1) my_pending_courses() no filtraba status='published' -- 12
--      asignaciones a cursos NO publicados eran visibles/hacibles en el
--      móvil pero invisibles en el informe de inspección (que sí filtra
--      published). No se borra nada: con el filtro puesto, esas 12
--      asignaciones simplemente dejan de aparecer hasta que su curso se
--      publique -- exactamente lo que pedía el encargo.
--
-- A.2) my_pending_courses() trataba 'firmado' como estado terminal -- no
--      miraba reeval_months. Un manipulador caducado salía verde en el
--      móvil del empleado para siempre, aunque el informe de oficina ya lo
--      marcara 'caducado'. Mismo mecanismo del bug que ya reventó una vez
--      (dos implementaciones del mismo hecho, una se corrige y la otra no).
--
-- A.3) Unificación de verdad: my_pending_courses, training_gaps y
--      training_course_summary ahora LLAMAN a course_state_for_employee
--      (fuente canónica desde el encargo de lanzamiento) en vez de
--      reimplementar el CASE de vigencia cada una por su cuenta.
--      training_gaps y my_pending_courses conservan su granularidad propia
--      (sin_firmar/nunca_hecho, suspendido/en_curso) SOBRE esa base
--      compartida -- course_state_for_employee no distingue "nunca
--      intentado" de "intentado y no superado" ni "aprobado sin firmar" de
--      "en curso", y esa distinción sí importa para RRHH/inspección.
--      training_course_summary también empieza a filtrar published (no lo
--      hacía) y su compliance_pct pasa a exigir vigente REAL (no "alguna
--      vez aprobado y firmado, sin mirar caducidad ni práctica" -- por eso
--      podía dar 100% con todo caducado).
--
-- C) release_overdue_phases(): los ítems de fase dia_1 tienen
--    days_from_hire=0 a propósito (formación exigible ANTES de exponerse
--    al riesgo -- eso no cambia aquí). Pero eso hacía que due_at de la fase
--    1 venciera en el instante de liberarse, y el cron (6:00 diario)
--    encadenara la fase dias_30 (3 cursos más) a la mañana siguiente,
--    hiciera el empleado algo o no -- justo el "montón de cursos de golpe"
--    que el rediseño por fases venía a evitar.
--    DECISIÓN (documentada, no solo aplicada): el cron de DESFASE usa un
--    umbral propio, independiente de due_at -- un mínimo de 7 días desde
--    released_at antes de forzar el avance, PASE LO QUE PASE con el
--    due_at de la fase. Para dia_1 (due_at=released_at+0) el suelo de 7
--    días es quien manda. Para dias_30/dias_90 (due_at ya a 30/90 días) el
--    suelo de 7 no cambia nada -- GREATEST(due_at, released_at+7d) sigue
--    siendo due_at. No se toca days_from_hire de dia_1: seguiría
--    comunicando al empleado (en su tarjeta, due_at real de la asignación)
--    que ese curso es exigible desde ya, que es la verdad legal -- el
--    problema estaba solo en el AVANCE AUTOMÁTICO de fase, no en el plazo
--    del curso.
--
-- Ninguna firma ni tipo de retorno cambia en ninguna de las 4 funciones --
-- CREATE OR REPLACE basta, sin DROP.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) my_pending_courses() -- filtra published, delega en
--    course_state_for_employee para el estado terminal (vigente/caducado/
--    pendiente_practica), conserva la distinción suspendido/en_curso propia
--    para lo que todavía no llegó a terminal. Nuevo estado de salida:
--    'caducado' (antes no existía -- se quedaba en 'firmado' para siempre).
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
  signed_at timestamptz,
  phase text
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
        when cs.value = 'vigente' then 'firmado'
        when cs.value = 'caducado' then 'caducado'
        when cs.value = 'pendiente_practica' then 'pendiente_practica'
        when att.finished_at is not null and coalesce(att.passed, false) = false then 'suspendido'
        when att.started_at is not null and att.finished_at is null then 'en_curso'
        else 'pendiente'
      end as status,
      att.id as attempt_id,
      att.score_pct,
      att.passed,
      sig.signed_at,
      pit.phase
    from public.course_assignment ca
    join public.course c on c.id = ca.course_id
    join public.employees e on e.id = v_employee_id
    left join public.training_path_item pit on pit.id = ca.path_item_id
    left join lateral (
      select public.course_state_for_employee(v_employee_id, c.id, v_account_id) as value
    ) cs on true
    left join lateral (
      select a.* from public.course_attempt a
      where a.assignment_id = ca.id and a.employee_id = v_employee_id
      order by a.started_at desc
      limit 1
    ) att on true
    left join lateral (
      select s.* from public.course_signature s
      where s.attempt_id = att.id
      order by s.signed_at desc
      limit 1
    ) sig on true
    where ca.account_id = v_account_id
      and c.status = 'published'
      and c.delivery_mode <> 'solo_archivo'
      and (
        ca.employee_id = v_employee_id
        or (ca.role is not null and ca.role = e.position)
        or (ca.location_id is not null and ca.location_id = e.location_id)
      )
  ),
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
      per_assignment.signed_at,
      per_assignment.phase
    from per_assignment
    order by
      per_assignment.course_id,
      case per_assignment.status
        when 'pendiente_practica' then 0
        when 'caducado' then 1
        when 'en_curso' then 2
        when 'suspendido' then 3
        when 'firmado' then 5
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
    best_per_course.signed_at,
    best_per_course.phase
  from best_per_course
  order by
    case best_per_course.phase when 'dia_1' then 0 when 'dias_30' then 1 when 'dias_90' then 2 else 3 end,
    best_per_course.due_at nulls last,
    best_per_course.course_title;
end;
$$;

grant execute on function public.my_pending_courses() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) training_gaps() -- delega en course_state_for_employee para
--    pendiente/pendiente_practica/caducado/vigente; conserva la distinción
--    sin_firmar (aprobado, sin firmar) vs en_curso (a medias o suspendido)
--    cuando el estado subyacente es 'en_curso' -- es la granularidad que
--    usa el KPI "Sin firmar" de TrainingCompliancePage.tsx.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.training_gaps(
  p_account_id uuid,
  p_days_ahead int default 30
) returns table(
  employee_id uuid,
  employee_name text,
  course_id uuid,
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
    select distinct c.id as course_id, c.title, c.reeval_months, c.requires_practical
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
      public.course_state_for_employee(e.id, rc.course_id, p_account_id) as state,
      best.passed,
      best.signed_at
    from emp e
    cross join relevant_courses rc
    left join lateral (
      select at.id, at.passed,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at
      from public.course_attempt at
      where at.employee_id = e.id
        and at.assignment_id in (
          select ca3.id from public.course_assignment ca3
          where ca3.course_id = rc.course_id and ca3.account_id = p_account_id
        )
      order by
        ((select max(s2.signed_at) from public.course_signature s2 where s2.attempt_id = at.id) is not null
         and coalesce(at.passed, false)) desc,
        at.started_at desc
      limit 1
    ) best on true
  ),
  classified as (
    select
      cell.employee_id,
      cell.employee_name,
      cell.course_id,
      cell.course_title,
      cell.due_at,
      case
        when not cell.applies then null
        when cell.state = 'pendiente' then 'nunca_hecho'
        when cell.state = 'pendiente_practica' then 'falta_practica'
        when cell.state = 'caducado' then 'caducado'
        when cell.state = 'vigente' and cell.reeval_months is not null
             and cell.signed_at + (cell.reeval_months || ' months')::interval <= now() + (p_days_ahead || ' days')::interval
          then 'caduca_pronto'
        when cell.state = 'vigente' then null
        when coalesce(cell.passed, false) and cell.signed_at is null then 'sin_firmar'
        else 'en_curso'
      end as gap_kind
    from cell
  )
  select
    classified.employee_id,
    classified.employee_name,
    classified.course_id,
    classified.course_title,
    classified.gap_kind,
    classified.due_at,
    case when classified.due_at is not null then (extract(day from classified.due_at - now()))::int else null end as days_left
  from classified
  where classified.gap_kind is not null
  order by
    case classified.gap_kind
      when 'caducado' then 0
      when 'caduca_pronto' then 1
      when 'sin_firmar' then 2
      when 'falta_practica' then 3
      when 'en_curso' then 4
      when 'nunca_hecho' then 5
      else 6
    end,
    classified.due_at nulls last;
end;
$function$;

grant execute on function public.training_gaps(uuid, int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) training_course_summary() -- filtra published (no lo hacía). signed_count
--    (y por tanto compliance_pct, el número que alimenta la ficha por curso
--    del PDF de inspección) ahora exige state='vigente' de verdad -- ya no
--    basta "alguna vez hubo un intento aprobado" (eso es lo que podía dar
--    100% con todo caducado). trained_count se conserva como métrica más
--    blanda ("alguna vez completó la teoría", vigente o caducado).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.training_course_summary(
  p_account_id uuid
) returns table(
  course_id uuid,
  course_code text,
  course_title text,
  legal_basis text,
  estimated_minutes int,
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
    select distinct c.id, c.code, c.title, c.legal_basis, c.estimated_minutes
    from public.course c
    join public.course_assignment ca on ca.course_id = c.id
    where ca.account_id = p_account_id and c.status = 'published'
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
  attempt_status as (
    select
      t.course_id,
      t.employee_id,
      public.course_state_for_employee(t.employee_id, t.course_id, p_account_id) as state
    from targeted t
  ),
  sections as (
    select cs.course_id, array_agg(cs.title order by cs.ord) as titles
    from public.course_section cs
    group by cs.course_id
  ),
  counts as (
    select
      rc.id as course_id,
      (select count(*) from targeted t where t.course_id = rc.id)::int as assigned_count,
      (select count(*) from attempt_status a where a.course_id = rc.id and a.state in ('vigente', 'caducado'))::int as trained_count,
      (select count(*) from attempt_status a where a.course_id = rc.id and a.state = 'vigente')::int as signed_count
    from relevant_courses rc
  )
  select
    rc.id,
    rc.code,
    rc.title,
    rc.legal_basis,
    rc.estimated_minutes,
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

grant execute on function public.training_course_summary(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) release_overdue_phases() -- umbral propio de desfase (7 días desde
--    released_at como suelo), independiente del due_at real de la fase.
--    Mismo cuerpo salvo la condición del WHERE.
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
      and pp.released_at is not null
      and greatest(pp.due_at, pp.released_at + interval '7 days') < now()
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

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia de las 4 funciones. La ejecución real (que un curso
-- caducado salga caducado en el móvil, que la fase 1 no encadene la
-- siguiente al día siguiente) se comprueba en pantalla -- criterio de
-- aceptación del encargo.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regprocedure('public.my_pending_courses()') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta my_pending_courses';
  end if;
  if to_regprocedure('public.training_gaps(uuid, int)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta training_gaps';
  end if;
  if to_regprocedure('public.training_course_summary(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta training_course_summary';
  end if;
  if to_regprocedure('public.release_overdue_phases()') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_overdue_phases';
  end if;
  raise notice 'Vigencia unificada OK: my_pending_courses/training_gaps/training_course_summary delegan en course_state_for_employee; release_overdue_phases da 7 días de suelo a la fase 1.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, aparte, tras aplicar):
--
-- 1) Las 12 asignaciones a cursos no publicados dejan de verse en el móvil
--    del empleado afectado (my_pending_courses), sin borrar nada:
--
--   select ca.id, ca.employee_id, c.title, c.status
--     from course_assignment ca join course c on c.id = ca.course_id
--    where c.status <> 'published' and ca.account_id = 'CUENTA_UUID'::uuid;
--
-- 2) Un empleado con un manipulador caducado (firmado hace más de
--    reeval_months) sale 'caducado' en my_pending_courses, no 'firmado':
--
--   select tg.* from training_gaps('CUENTA_UUID'::uuid, 30) tg
--    where tg.gap_kind = 'caducado';
--
-- 3) Las cuatro coinciden para el mismo empleado+curso (criterio de
--    aceptación del encargo): compara el estado de course_state_for_employee,
--    my_pending_courses, training_gaps y training_compliance_matrix para un
--    par (empleado, curso) con formación caducada real.
--
-- 4) Cron: tras liberar fase 1 a un empleado de prueba, confirma que
--    release_overdue_phases() NO libera la fase 2 antes de 7 días:
--
--   select employee_id, path_id, phase, state, released_at, due_at
--     from training_path_progress
--    where phase = 'dia_1' and state = 'liberada'
--    order by released_at desc limit 5;
-- ============================================================================
