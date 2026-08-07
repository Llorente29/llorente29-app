-- Aplicada: 2026-08-07 por MCP. Probada en vivo (rollback): rechaza conflicto (Marlón 21/09 en vacación),
-- deja pasar lo legítimo (Marlón 19/10 sin vacación). 0 conflictos actuales -> no rompe saves existentes.
-- F7.1 · BACKSTOP innegociable. El cuadrante se escribe directo a schedules.cells vía PostgREST (no hay
-- RPC de guardado), así que el único punto server-side a prueba de bordeo es este trigger. Cubre el
-- guardado MANUAL (que no validaba) y el generador (que ya validaba). Raíz del bug de Marlón.
-- cells = {shift_template_id: {day_index(0-7): [employee_id,...]}} ; fecha(dia d) = week_start + (d-1).
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
        v_date := new.week_start + ((v_day)::int - 1);
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

drop trigger if exists trg_schedule_no_vacation_conflict on public.schedules;
create trigger trg_schedule_no_vacation_conflict
  before insert or update on public.schedules
  for each row execute function public.tg_schedule_reject_vacation_conflicts();
