-- ============================================================================
-- Formación — FIX: un intento a medias desaparecía de training_gaps().
--
-- 🔴 BUG reportado por Julio, verificado en producción (empleada
-- 147289a6-...): 2 asignaciones de onboarding sin superar (alérgenos con
-- course_attempt.started_at pero finished_at/passed NULL y 0 firmas; higiene
-- ni empezado). El calendario ("Qué vence") mostraba 1 pendiente en vez de 2.
--
-- CAUSA: el CASE de gap_kind en training_gaps() (20260809T1000, ya aplicada
-- -- se corrige aquí, NO se edita aquel fichero) solo tenía ramas para
-- "nunca_hecho" (sin intento) y "sin_firmar" (passed=true, sin firmar). Un
-- intento EMPEZADO pero ni terminado ni aprobado ni firmado no encajaba en
-- NINGÚN when -> caía al "else null" -> el WHERE final
-- (classified.gap_kind is not null) lo descartaba del informe. Desaparecía
-- sin dejar rastro.
--
-- training_compliance_matrix (misma migración, C4) YA tenía la regla
-- correcta en su cell_state: "not (signed_at is not null and passed)" ->
-- 'en_curso', ANTES de mirar reevaluación/práctica. training_gaps nunca se
-- alineó con ese fix cuando se escribió -- dos implementaciones
-- independientes del mismo hecho, una se corrigió y la otra no (exactamente
-- el riesgo que trainingPathService.ts advierte evitar).
--
-- AUDITORÍA de los otros 3 sitios que pidió Julio, hecha por lectura directa
-- del código (sin subagentes):
--   - Semáforo de la ficha (getEmployeeTrainingStatus) y semáforo del
--     cuadrante (CalendarioPage.tsx) usan training_compliance_matrix y la
--     regla "cell.state !== 'vigente' && !== 'no_aplica'" -- YA CORRECTOS,
--     no se tocan.
--   - Progreso del móvil ("X de Y") usa my_pending_courses(), que YA
--     distingue 'en_curso'/'suspendido' de 'firmado' en su propio CASE de
--     status -- YA CORRECTO, no se toca.
--   El único punto roto era training_gaps() y su consumidor "Qué vence".
--
-- ARREGLO: nueva rama 'en_curso' justo antes de 'falta_practica' -- "no
-- (firmado Y aprobado)" cubre tanto el intento a medias como uno finalizado
-- pero suspendido, sin exigir que existiera antes. 'sin_firmar' (aprobado,
-- sin firmar todavía) SE MANTIENE tal cual: es una distinción real que usa
-- el KPI "Sin firmar" de TrainingCompliancePage.tsx (pantalla de cara a
-- inspección) y no hay motivo para perderla.
--
-- Solo cambia el CUERPO de la función -- misma firma, mismo RETURNS TABLE
-- (7 columnas sin cambios), así que CREATE OR REPLACE basta, sin DROP.
-- ============================================================================

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
      rc.requires_practical,
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
      best.signed_at,
      best.practical_ok
    from emp e
    cross join relevant_courses rc
    left join lateral (
      select at.id, at.passed,
        (select max(s.signed_at) from public.course_signature s where s.attempt_id = at.id) as signed_at,
        (
          not exists (
            select 1 from public.course_practical_item pi
            where pi.course_id = rc.course_id
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
      cell.employee_id,
      cell.employee_name,
      cell.course_id,
      cell.course_title,
      cell.due_at,
      case
        when not cell.applies then null
        when cell.attempt_id is null then 'nunca_hecho'
        when coalesce(cell.passed, false) and cell.signed_at is null then 'sin_firmar'
        -- 🔴 EL ARREGLO: intento empezado y ni aprobado ni firmado (o
        -- terminado y suspendido) ya no cae al else null -- antes
        -- desaparecía del informe entero. Mismo criterio que
        -- training_compliance_matrix.cell_state: "not (firmado y aprobado)".
        when not coalesce(cell.passed, false) then 'en_curso'
        when cell.signed_at is not null and coalesce(cell.passed, false)
             and cell.requires_practical and not coalesce(cell.practical_ok, false)
          then 'falta_practica'
        when cell.signed_at is not null and coalesce(cell.passed, false) and cell.reeval_months is not null
             and cell.signed_at + (cell.reeval_months || ' months')::interval <= now()
          then 'caducado'
        when cell.signed_at is not null and coalesce(cell.passed, false) and cell.reeval_months is not null
             and cell.signed_at + (cell.reeval_months || ' months')::interval <= now() + (p_days_ahead || ' days')::interval
          then 'caduca_pronto'
        else null
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

notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — existencia. La ejecución real (que la empleada del bug salga con
-- 2 pendientes) se verifica con la query de más abajo -- un guard que solo
-- comprueba existencia no prueba que funcione (lección C2).
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regprocedure('public.training_gaps(uuid, int)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta training_gaps';
  end if;
  raise notice 'training_gaps corregido: un intento sin superar ya cuenta como en_curso, no desaparece del informe.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, tras aplicar) — la empleada del bug reportado debe
-- salir con 2 filas, no 1. EMPLEADO_UUID es solo un marcador -- sustitúyelo
-- por el uuid completo real de la empleada (en el reporte solo llegó
-- truncado, "147289a6-..."):
--
--   select tg.*
--   from training_gaps(
--     (select l.account_id from employees e join locations l on l.id = e.location_id
--       where e.id = 'EMPLEADO_UUID'::uuid),
--     30
--   ) tg
--   where tg.employee_id = 'EMPLEADO_UUID'::uuid;
--
-- Debe devolver higiene (nunca_hecho) Y alérgenos (en_curso).
-- ============================================================================
