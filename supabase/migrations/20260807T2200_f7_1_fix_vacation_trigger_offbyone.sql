-- Corrige un bug off-by-one en el trigger de F7.1 (20260807T2100), detectado durante
-- el RECON del encargo "cierre de cimientos de validacion".
--
-- BUG: la version anterior calculaba fecha(dia d) = week_start + (d-1). Pero el
-- cliente (scheduleGenerator.ts:isoForDay, CalendarioPage.tsx, MiHorario.tsx) usa
-- SIEMPRE fecha(dia d) = week_start + d (dia '0' = lunes = week_start, sin -1).
-- ScheduleCells guarda las claves de dia como '0'..'6' (types/scheduler.ts:
-- DayOfWeek = 0|...|6, 0=lun). El trigger comprobaba la vacacion de UN DIA ANTES
-- del dia realmente asignado -> false negatives (no bloqueaba conflictos reales)
-- y false positives (podia rechazar guardados legitimos) en toda la semana.
--
-- Reproducido en vivo (transaccion con ROLLBACK, sin dejar rastro):
--   insert cells = {tpl: {'0': [Marlon]}}, week_start='2026-09-21' (lunes),
--   vacacion aprobada de Marlon 21-27/09 -> el trigger viejo NO lanzaba excepcion.
--   Con la formula corregida SI la lanza: "CUADRANTE_CON_VACACIONES: Marlon
--   Mafla Rivera el 21/09/2026; ".
--
-- Fix: quitar el "- 1". Migracion nueva (no se edita la migracion ya aplicada,
-- ver CONTEXTO_CLAUDE.md 6.1 / feedback_migracion_aplicada_no_se_edita).
create or replace function public.tg_schedule_reject_vacation_conflicts()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tpl text; v_day text; v_emp text; v_date date;
  v_conflicts text := '';
begin
  if new.cells is null or new.cells = '{}'::jsonb then
    return new;
  end if;
  for v_tpl in select jsonb_object_keys(new.cells) loop
    for v_day in select jsonb_object_keys(new.cells -> v_tpl) loop
      begin
        v_date := new.week_start + (v_day)::int;  -- dia '0' = week_start (lunes)
      exception when others then
        continue;  -- clave de día no numérica: ignorar
      end;
      for v_emp in select jsonb_array_elements_text(new.cells -> v_tpl -> v_day) loop
        if exists (
          select 1 from vacations v
          where v.employee_id = v_emp::uuid
            and v.status = 'aprobada'
            and v_date between v.start_date and v.end_date
        ) then
          v_conflicts := v_conflicts
            || coalesce((select e.name from employees e where e.id = v_emp::uuid), v_emp)
            || ' el ' || to_char(v_date, 'DD/MM/YYYY') || '; ';
        end if;
      end loop;
    end loop;
  end loop;
  if v_conflicts <> '' then
    raise exception 'CUADRANTE_CON_VACACIONES: %', v_conflicts
      using hint = 'Hay empleados asignados en dias de vacaciones aprobadas. Quitalos de esos dias antes de guardar.';
  end if;
  return new;
end $$;
