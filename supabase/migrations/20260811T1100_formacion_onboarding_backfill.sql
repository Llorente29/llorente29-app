-- ============================================================================
-- Formación — Onboarding formativo, BACKFILL para empleados que ya existen.
-- Aplicar DESPUÉS de 20260811T1000_formacion_onboarding_nucleo.sql, como
-- ejecución APARTE en el SQL Editor (lección de C6:
-- [[feedback_sql_editor_transaccion_unica]] — un fallo de datos aquí no debe
-- llevarse por delante la DDL de la otra migración).
--
-- Decisión de Julio (3): due_at = start_date + days_from_hire, fechas
-- HONESTAMENTE VENCIDAS para la plantilla actual (si alguien lleva dos años,
-- su "día 1" ya pasó hace mucho — eso es correcto, no un bug). El semáforo
-- marca y hace seguimiento de todos, pero NO condiciona nada retroactivo: un
-- rojo masivo el primer día haría que la señal se ignorara para siempre.
-- Esta migración solo CREA las asignaciones (vía assign_onboarding_training,
-- ya idempotente) — no toca en ningún sitio si el cuadrante bloquea o no,
-- porque el cuadrante ni se toca en esta entrega (declarado fuera).
--
-- Sin COMMIT/ROLLBACK dentro del DO. Aislamiento por empleado con
-- BEGIN...EXCEPTION WHEN OTHERS anidado (SAVEPOINT implícito).
-- ============================================================================

do $backfill$
declare
  r record;
  v_n integer;
  v_total integer := 0;
  v_employees integer := 0;
  v_failed integer := 0;
begin
  if to_regprocedure('public.assign_onboarding_training(uuid)') is null then
    raise exception 'MIGRACIÓN FALLIDA: falta assign_onboarding_training -- aplica primero 20260811T1000_formacion_onboarding_nucleo.sql';
  end if;

  for r in select id, name from public.employees where active = true order by created_at loop
    begin
      v_n := public.assign_onboarding_training(r.id);
      v_total := v_total + v_n;
      v_employees := v_employees + 1;
      if v_n > 0 then
        raise notice 'Empleado % (%): % curso(s) de itinerario asignado(s).', r.name, r.id, v_n;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'assign_onboarding_training falló para % (%): %', r.name, r.id, sqlerrm;
    end;
  end loop;

  raise notice 'Backfill de onboarding: % asignaciones creadas sobre % empleado(s) activo(s), % con error.', v_total, v_employees, v_failed;
end
$backfill$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, tras aplicar) — relee el estado real:
--
-- select e.name, e.position, e.start_date, count(ca.id) as asignaciones_onboarding
--   from employees e
--   left join course_assignment ca on ca.employee_id = e.id and ca.origin = 'onboarding'
--  where e.active = true
--  group by e.id, e.name, e.position, e.start_date
--  order by asignaciones_onboarding asc
--  limit 20;
--
-- Un empleado sin local asignado sale con 0 asignaciones (esperado, ver nota
-- en assign_onboarding_training). Cualquier otro con 0 merece revisión.
-- ============================================================================
