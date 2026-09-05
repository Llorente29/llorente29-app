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
        v_date := new.week_start + (v_day)::int;
      exception when others then
        continue;
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