-- ============================================================================
-- Formación — Itinerario por fases, BACKFILL para empleados que ya existen.
-- Aplicar DESPUÉS de 20260812T1000_formacion_fases_nucleo.sql, como ejecución
-- APARTE en el SQL Editor (lección de C6: [[feedback_sql_editor_transaccion_unica]]
-- -- un fallo de datos aquí no debe llevarse por delante la DDL de la otra
-- migración). Sin COMMIT/ROLLBACK dentro del DO. Aislamiento por empleado con
-- BEGIN...EXCEPTION WHEN OTHERS anidado (SAVEPOINT implícito).
--
-- QUÉ HACE, para cada empleado activo y cada itinerario que le aplique:
--   1) Asegura las 3 filas de progreso (ensure_training_path_progress):
--      fase 1 'liberada' con released_at = AHORA (el momento en que se
--      aplica esta migración -- es la "puesta en marcha" del modelo nuevo
--      para la plantilla actual, igual criterio que un alta nueva: el reloj
--      empieza cuando la formación está disponible). Fases 2/3 'pendiente'.
--   2) Recalcula el due_at de las asignaciones de fase 1 YA EXISTENTES
--      (creadas por el backfill viejo, 20260811T1100, con
--      due_at = start_date + días -- el error de origen) usando el
--      released_at nuevo. Elimina de raíz las fechas de 2025.
--   3) Fases 2/3: el backfill viejo las creó de golpe (el propio bug que
--      corrige este encargo). Bajo el modelo nuevo esas fases NO están
--      liberadas todavía, así que esas asignaciones no deberían existir
--      como tales. Regla explícita del encargo:
--        - Si NO tiene course_attempt -> se retira (se recreará sola, con
--          fecha correcta, cuando su fase se libere de verdad).
--        - Si SÍ tiene course_attempt (alguien ya empezó, aunque su fase no
--          estuviera formalmente liberada bajo el modelo viejo) -> se
--          CONSERVA (no se pierde trabajo), se etiqueta con su
--          path_item_id, y su due_at se limpia a NULL (una fase que sigue
--          pendiente no tiene plazo hasta que se libere -- sync_phase_assignments
--          se lo pondrá en cuanto se libere de verdad).
--   4) Nunca toca asignaciones con origin distinto de 'onboarding' (manuales,
--      mandatorias de cuenta).
-- ============================================================================

do $backfill$
declare
  r_emp record;
  r_path record;
  r_item record;
  v_progress_id uuid;
  v_released_at timestamptz;
  v_employees integer := 0;
  v_failed integer := 0;
  v_kept integer := 0;
  v_deleted integer := 0;
begin
  if to_regprocedure('public.ensure_training_path_progress(uuid, uuid)') is null
     or to_regprocedure('public.sync_phase_assignments(uuid, uuid, text)') is null then
    raise exception 'MIGRACIÓN FALLIDA: aplica primero 20260812T1000_formacion_fases_nucleo.sql';
  end if;

  for r_emp in select id, name, position from public.employees where active = true order by created_at loop
    begin
      for r_path in
        select p.id
        from public.training_path p
        join public.employees e on e.id = r_emp.id
        join public.locations l on l.id = e.location_id
        where p.active = true
          and (p.account_id = l.account_id or p.account_id is null)
          and (p.roles = '{}' or (r_emp.position is not null and r_emp.position <> '' and r_emp.position = any(p.roles)))
          and (
            p.business_types = '{}'
            or exists (select 1 from public.accounts a where a.id = l.account_id and a.business_type = any(p.business_types))
          )
      loop
        -- 1) Progreso de las 3 fases (idempotente).
        perform public.ensure_training_path_progress(r_emp.id, r_path.id);

        select id, released_at into v_progress_id, v_released_at
        from public.training_path_progress
        where employee_id = r_emp.id and path_id = r_path.id and phase = 'dia_1';

        -- 2) Fase 1: recalcula due_at de lo ya asignado y etiqueta path_item_id.
        for r_item in
          select pi.id as item_id, pi.course_id, pi.days_from_hire as days_from_release
          from public.training_path_item pi
          where pi.path_id = r_path.id and pi.phase = 'dia_1'
        loop
          update public.course_assignment
          set due_at = case when v_released_at is null then null else v_released_at + (r_item.days_from_release || ' days')::interval end,
              path_item_id = r_item.item_id
          where employee_id = r_emp.id and course_id = r_item.course_id and origin = 'onboarding';
        end loop;

        -- Crea lo que falte de fase 1 (empleados sin backfill previo, o
        -- itinerarios nuevos que no existían cuando corrió el backfill viejo).
        perform public.sync_phase_assignments(r_emp.id, r_path.id, 'dia_1');

        -- 3) Fases 2/3: retira lo intacto, conserva (sin fecha) lo que tiene intento.
        for r_item in
          select pi.id as item_id, pi.course_id
          from public.training_path_item pi
          where pi.path_id = r_path.id and pi.phase in ('dias_30', 'dias_90')
        loop
          if exists (
            select 1 from public.course_assignment ca
            where ca.employee_id = r_emp.id and ca.course_id = r_item.course_id and ca.origin = 'onboarding'
          ) then
            if exists (
              select 1
              from public.course_attempt att
              join public.course_assignment ca on ca.id = att.assignment_id
              where ca.employee_id = r_emp.id and ca.course_id = r_item.course_id and ca.origin = 'onboarding'
            ) then
              update public.course_assignment
              set path_item_id = r_item.item_id, due_at = null
              where employee_id = r_emp.id and course_id = r_item.course_id and origin = 'onboarding';
              v_kept := v_kept + 1;
            else
              delete from public.course_assignment
              where employee_id = r_emp.id and course_id = r_item.course_id and origin = 'onboarding';
              v_deleted := v_deleted + 1;
            end if;
          end if;
        end loop;
      end loop;

      v_employees := v_employees + 1;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'Migración de fases falló para % (%): %', r_emp.name, r_emp.id, sqlerrm;
    end;
  end loop;

  raise notice 'Backfill de fases: % empleado(s) procesado(s), % con error. Fase 2/3: % asignación(es) retirada(s) (sin intento, se recrean al liberar), % conservada(s) (con intento, sin fecha hasta liberar).',
    v_employees, v_failed, v_deleted, v_kept;
end
$backfill$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, tras aplicar) — relee el estado real:
--
-- 1) Nadie debería tener ya más de 2-3 asignaciones de onboarding activas
--    (solo las de la fase 1 de cada itinerario que le aplique -- normalmente
--    uno, a veces dos si cae en "general" + "cocina"/"delivery"):
--
--   select e.name, e.position, count(*) filter (where ca.origin = 'onboarding') as asignaciones_onboarding
--     from employees e
--     left join course_assignment ca on ca.employee_id = e.id
--    where e.active = true
--    group by e.id, e.name, e.position
--    order by asignaciones_onboarding desc;
--
-- 2) Ninguna asignación de onboarding con due_at anterior a hoy (fecha de
--    aplicación de esta migración):
--
--   select e.name, ca.due_at, c.title
--     from course_assignment ca
--     join employees e on e.id = ca.employee_id
--     join course c on c.id = ca.course_id
--    where ca.origin = 'onboarding' and ca.due_at < now();
--
--   (debería devolver 0 filas -- si devuelve alguna, revisar antes de dar
--   esto por cerrado)
--
-- 3) Progreso creado:
--
--   select e.name, tp.name as itinerario, tpp.phase, tpp.state, tpp.released_at, tpp.due_at
--     from training_path_progress tpp
--     join employees e on e.id = tpp.employee_id
--     join training_path tp on tp.id = tpp.path_id
--    order by e.name, tpp.phase;
-- ============================================================================
