-- ============================================================================
-- Formación — Itinerario por fases (liberación escalonada / drip content).
-- Diseño: docs/folvy_formacion_itinerario_fases_rediseno.md.
-- Encargo: docs/ENCARGO_CODE_formacion_fases.md.
--
-- SUSTITUYE el modelo de asignación de 20260811T1000_formacion_onboarding_nucleo.sql:
-- antes assign_onboarding_training() creaba las 3 fases de golpe (dia_1 +
-- dias_30 + dias_90). Un empleado nuevo veía 13 cursos el primer día. Ahora
-- solo se materializan course_assignment de la fase LIBERADA -- el resto del
-- itinerario existe en training_path_progress pero no se asigna todavía.
--
-- 🔴 due_at = released_at + días, NUNCA desde employees.start_date (el error
-- de origen: fechas vencidas de 2025, antes de que Folvy existiera).
--
-- Solo DDL + funciones (CREATE OR REPLACE, mismas firmas que ya estaban
-- registradas donde aplica -- no hace falta tocar los triggers de employees,
-- siguen apuntando a assign_onboarding_training). Sin datos: el backfill de
-- los 9 empleados existentes va en fichero aparte
-- (20260812T1100_formacion_fases_backfill.sql), lección de C6
-- ([[feedback_sql_editor_transaccion_unica]]): un fallo en datos no debe
-- llevarse por delante esta DDL. Sin COMMIT/ROLLBACK en ningún DO.
--
-- days_from_hire: se REINTERPRETA como "días desde que se liberó la fase"
-- (no desde el alta). NO se renombra la columna -- 20260811T1000 (ya
-- aplicada) siembra filas nombrando esa columna explícitamente, y esa
-- migración no se edita (regla fija). Renombrarla ahora dejaría
-- irreproducible el seed de 20260811T1000 si algún día hay que volver a
-- correr solo esa sección (p.ej. para escandallo_fichas_tecnicas cuando
-- exista el curso). Documentado con COMMENT ON COLUMN; en el SQL nuevo se
-- lee siempre con alias `as days_from_release` para que el código sea claro
-- aunque el nombre de columna no cambie.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) RECON verificado: el núcleo de onboarding (C-anterior) sigue vivo.
-- ────────────────────────────────────────────────────────────────────────────
do $recon$
begin
  if to_regclass('public.training_path') is null or to_regclass('public.training_path_item') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta training_path/training_path_item -- aplica primero 20260811T1000_formacion_onboarding_nucleo.sql';
  end if;
  if to_regprocedure('public.assign_onboarding_training(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta assign_onboarding_training -- aplica primero 20260811T1000_formacion_onboarding_nucleo.sql';
  end if;
end
$recon$;

comment on column public.training_path_item.days_from_hire is
  'REINTERPRETADO (itinerario por fases): días desde que se LIBERÓ la fase del itinerario (training_path_progress.released_at), no desde employees.start_date. '
  'El nombre de columna no cambió a propósito -- 20260811T1000_formacion_onboarding_nucleo.sql (ya aplicada) siembra esta columna por nombre y esa migración no se edita. '
  'Léase siempre como "days_from_release" en el código nuevo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 1) training_path.auto_release -- por defecto true (liberación automática al
--    completar la fase; ver sync_phase_assignments/release_next_phase). El
--    cron de desfase temporal y el disparador de completar-fase quedan
--    declarados fuera de esta entrega (ver nota de cierre en el commit).
-- ────────────────────────────────────────────────────────────────────────────
alter table public.training_path
  add column if not exists auto_release boolean not null default true;

comment on column public.training_path.auto_release is
  'true = la fase siguiente se libera sola al completarse la actual (+ cron de desfase, declarado/pendiente). false = solo liberación manual (release_next_phase).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) course_assignment.path_item_id -- de qué training_path_item viene esta
--    asignación (si viene de un itinerario). Resuelve la fase sin adivinar
--    por course_id, y es lo que Mi Formación usa para agrupar/mostrar
--    progreso por fase.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.course_assignment
  add column if not exists path_item_id uuid references public.training_path_item(id);

comment on column public.course_assignment.path_item_id is
  'training_path_item de origen si esta asignación viene de un itinerario de incorporación. NULL = asignación manual, mandatoria por cuenta, u otro origen.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) training_path_progress -- estado por fase de cada empleado. Fuente de
--    verdad de qué está liberado; course_assignment solo materializa lo que
--    esta tabla dice que ya toca.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.training_path_progress (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  path_id uuid not null references public.training_path(id),
  phase text not null check (phase in ('dia_1', 'dias_30', 'dias_90')),
  state text not null default 'pendiente' check (state in ('pendiente', 'liberada', 'completada')),
  released_at timestamptz,
  released_by uuid,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists training_path_progress_unique
  on public.training_path_progress (employee_id, path_id, phase);

comment on table public.training_path_progress is
  'Progreso de un empleado en un itinerario, por fase. state=liberada es lo único que autoriza a sync_phase_assignments a crear course_assignment de esa fase. '
  'due_at aquí es un resumen (MAX de due_at de las asignaciones de la fase) -- el due_at que manda es el de cada course_assignment.';

alter table public.training_path_progress enable row level security;

create policy "training_path_progress_select" on public.training_path_progress
  for select to authenticated
  using (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = training_path_progress.employee_id
        and (public.current_user_is_admin_or_manager_of(l.account_id) or public.current_user_is_admin())
    )
  );

create policy "training_path_progress_write" on public.training_path_progress
  for all to authenticated
  using (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = training_path_progress.employee_id
        and (public.current_user_is_admin_or_manager_of(l.account_id) or public.current_user_is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = training_path_progress.employee_id
        and (public.current_user_is_admin_or_manager_of(l.account_id) or public.current_user_is_admin())
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4) ensure_training_path_progress(employee, path) -- crea las 3 filas de
--    progreso si faltan (fase 1 liberada ya, 2/3 pendientes). Idempotente.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.ensure_training_path_progress(p_employee_id uuid, p_path_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record;
begin
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
-- 5) sync_phase_assignments(employee, path, phase) -- crea los
--    course_assignment que falten de una fase YA liberada (no hace nada si
--    la fase sigue pendiente). Nunca borra. También rellena due_at de
--    asignaciones de esa fase que se hubieran quedado sin fecha (caso: una
--    asignación conservada por la migración de datos porque tenía un
--    intento, de una fase que en ese momento no estaba liberada -- al
--    liberarse de verdad, aquí se le pone fecha). Idempotente.
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
begin
  select l.account_id into v_account_id
  from public.employees e
  join public.locations l on l.id = e.location_id
  where e.id = p_employee_id;
  if v_account_id is null then
    return 0;
  end if;

  select * into v_progress
  from public.training_path_progress pp
  where pp.employee_id = p_employee_id and pp.path_id = p_path_id and pp.phase = p_phase;
  if v_progress.id is null or v_progress.state = 'pendiente' then
    return 0; -- fase todavía no liberada: nada que materializar
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
-- 6) assign_onboarding_training(employee) -- MISMA FIRMA que
--    20260811T1000 (los triggers de employees no se tocan). Resuelve los
--    itinerarios aplicables (position + business_type, igual que antes) y
--    para cada uno: asegura el progreso de las 3 fases y materializa SOLO la
--    fase 1. Las fases 2/3 se materializan cuando se liberen (automático o
--    manual), no aquí.
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

grant execute on function public.assign_onboarding_training(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7) release_next_phase(employee, path) -- liberación MANUAL individual.
--    Avanza la fase 'pendiente' de menor orden a 'liberada' y materializa
--    sus asignaciones. Registra released_by = auth.uid(). Falla si no hay
--    ninguna fase pendiente (ya está todo liberado).
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
  v_next record;
  v_count integer;
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

  select * into v_next
  from public.training_path_progress pp
  where pp.employee_id = p_employee_id and pp.path_id = p_path_id and pp.state = 'pendiente'
  order by case pp.phase when 'dia_1' then 0 when 'dias_30' then 1 when 'dias_90' then 2 else 3 end
  limit 1;

  if v_next.id is null then
    raise exception 'release_next_phase: no hay ninguna fase pendiente que liberar para este itinerario';
  end if;

  update public.training_path_progress
  set state = 'liberada', released_at = now(), released_by = v_uid, updated_at = now()
  where id = v_next.id;

  v_count := public.sync_phase_assignments(p_employee_id, p_path_id, v_next.phase);

  return jsonb_build_object('phase', v_next.phase, 'assignmentsCreated', v_count);
end;
$function$;

grant execute on function public.release_next_phase(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8) release_next_phase_for_group(path, local?, puesto?) -- la "campaña":
--    libera la siguiente fase pendiente a todos los empleados activos de un
--    local y/o puesto que tengan ese itinerario con una fase pendiente.
--    Exige al menos un filtro (local o puesto) -- no se puede liberar "a
--    todo el mundo" de un golpe sin acotar. Aísla por empleado (si uno falla
--    -- p.ej. sin fase pendiente -- sigue con el resto).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.release_next_phase_for_group(
  p_path_id uuid,
  p_location_id uuid default null,
  p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_path_account_id uuid;
  v_emp record;
  v_released integer := 0;
  v_skipped integer := 0;
begin
  if p_location_id is null and p_role is null then
    raise exception 'release_next_phase_for_group: indica al menos local o puesto';
  end if;

  select account_id into v_path_account_id from public.training_path where id = p_path_id;

  for v_emp in
    select e.id
    from public.employees e
    join public.locations l on l.id = e.location_id
    where e.active = true
      and (p_location_id is null or e.location_id = p_location_id)
      and (p_role is null or e.position = p_role)
      and (v_path_account_id is null or l.account_id = v_path_account_id)
      and exists (
        select 1 from public.training_path_progress pp
        where pp.employee_id = e.id and pp.path_id = p_path_id and pp.state = 'pendiente'
      )
  loop
    begin
      perform public.release_next_phase(v_emp.id, p_path_id);
      v_released := v_released + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('released', v_released, 'skipped', v_skipped);
end;
$function$;

grant execute on function public.release_next_phase_for_group(uuid, uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9) my_pending_courses() -- añade `phase` (para que Mi Formación agrupe y
--    calcule progreso sin una RPC nueva) y EXCLUYE delivery_mode='solo_archivo'
--    (PRL: no se hace en el móvil, no debe aparecer -- diseño §3). Sobre la
--    base ya arreglada del anti-duplicado (rebase de
--    fix/formacion-anti-duplicado-asignacion-manual): se mantiene el
--    colapso DISTINCT ON (course_id) tal cual.
--
--    14 columnas de salida ahora (antes 13): auditado a mano -- toda
--    referencia nueva (pit.phase, per_assignment.phase, best_per_course.phase)
--    va cualificada, mismo criterio que el resto de la función (lección C2:
--    [[feedback... ambigüedad RETURNS TABLE]]).
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
        when sig.id is not null and (not c.requires_practical or coalesce(prac.practical_ok, false)) then 'firmado'
        when sig.id is not null then 'pendiente_practica'
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
    best_per_course.signed_at,
    best_per_course.phase
  from best_per_course
  order by
    case best_per_course.phase when 'dia_1' then 0 when 'dias_30' then 1 when 'dias_90' then 2 else 3 end,
    best_per_course.due_at nulls last,
    best_per_course.course_title;
end;
$$;

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. La ejecución real (que un empleado nuevo vea solo la
-- fase 1, que los due_at de la plantilla actual queden recalculados) se
-- verifica en el backfill (fichero aparte) y en pantalla -- ver criterio de
-- aceptación del encargo.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regclass('public.training_path_progress') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta la tabla training_path_progress';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course_assignment' and column_name = 'path_item_id'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta course_assignment.path_item_id';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'training_path' and column_name = 'auto_release'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta training_path.auto_release';
  end if;
  if to_regprocedure('public.ensure_training_path_progress(uuid, uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta ensure_training_path_progress';
  end if;
  if to_regprocedure('public.sync_phase_assignments(uuid, uuid, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta sync_phase_assignments';
  end if;
  if to_regprocedure('public.release_next_phase(uuid, uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_next_phase';
  end if;
  if to_regprocedure('public.release_next_phase_for_group(uuid, uuid, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta release_next_phase_for_group';
  end if;
  if to_regprocedure('public.my_pending_courses()') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta my_pending_courses';
  end if;
  raise notice 'Itinerario por fases (núcleo) OK: training_path_progress + RLS + funciones + my_pending_courses con fase y sin solo_archivo.';
end
$guard$;
-- ============================================================================
