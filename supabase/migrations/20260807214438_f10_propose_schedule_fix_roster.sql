-- F10 (corrección) · BUG: propose_schedule elegía entre TODOS los empleados de la cuenta, así que proponía
-- gente de Carabanchel para turnos de Alcalá (Keilymar, Marlón, Mirlenys). Cazado por Code al ver chips
-- rotos en la pantalla. El arreglo va en el MOTOR, no en la pantalla: cualquier otro consumidor del RPC
-- heredaría el fallo.
--
-- Roster del local = empleados cuyo location_id es ese local, MÁS los que lo tengan en assigned_locations
-- (hoy ese array está vacío en todos, pero existe para gente que cubre en varios locales: no se puede
-- ignorar o los excluiríamos indebidamente cuando se use).
create or replace function public.propose_schedule(
  p_account uuid, p_location uuid, p_week_start date
) returns table(
  dia date, day_of_week int, shift_template_id uuid, shift_label text,
  employee_id uuid, employee_name text,
  motivo text, rompe_preferencia boolean
)
language plpgsql stable
as $function$
declare r_turno record; r_cand record; v_asignadas jsonb := '{}'::jsonb; v_horas jsonb := '{}'::jsonb;
        v_dur numeric;
begin
  for r_turno in
    select st.id as tpl, st.label, st.start_time, st.end_time,
           d.dow, (p_week_start + d.dow)::date as fecha,
           case when st.start_time < time '17:00' then 'morning' else 'evening' end as periodo,
           coalesce(case d.dow
             when 0 then st.coverage_mon when 1 then st.coverage_tue when 2 then st.coverage_wed
             when 3 then st.coverage_thu when 4 then st.coverage_fri when 5 then st.coverage_sat
             else st.coverage_sun end, 0) as necesita
    from public.shift_templates st
    cross join generate_series(0,6) d(dow)
    where st.location_id = p_location and st.active
      and coalesce(case d.dow
             when 0 then st.coverage_mon when 1 then st.coverage_tue when 2 then st.coverage_wed
             when 3 then st.coverage_thu when 4 then st.coverage_fri when 5 then st.coverage_sat
             else st.coverage_sun end, 0) > 0
    order by 8 desc, d.dow
  loop
    v_dur := extract(epoch from (
               (r_turno.end_time - r_turno.start_time)
               + case when r_turno.end_time <= r_turno.start_time
                      then interval '24 hours' else interval '0' end)) / 3600.0;

    for r_cand in
      select e.id, e.name,
             coalesce((v_horas ->> e.id::text)::numeric, 0) as horas_ya,
             coalesce(av.available, true) as disponible,
             av.note as motivo_disp
      from public.employees e
      left join public.employee_availability av
        on av.employee_id = e.id and av.day_of_week = r_turno.dow and av.shift_period = r_turno.periodo
      where e.account_id = p_account and e.active
        -- DURA (nueva): pertenece al ROSTER de este local
        and (e.location_id = p_location
             or (e.assigned_locations is not null
                 and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
        and not exists (
          select 1 from public.vacations v
          where v.employee_id = e.id and v.status = 'aprobada'
            and r_turno.fecha between v.start_date and v.end_date)
        and not (coalesce(v_asignadas -> (r_turno.fecha::text), '[]'::jsonb) @> to_jsonb(e.id::text))
      order by coalesce(av.available, true) desc,
               coalesce((v_horas ->> e.id::text)::numeric, 0) asc,
               e.name
      limit r_turno.necesita
    loop
      dia := r_turno.fecha; day_of_week := r_turno.dow;
      shift_template_id := r_turno.tpl; shift_label := r_turno.label;
      employee_id := r_cand.id; employee_name := r_cand.name;
      rompe_preferencia := not r_cand.disponible;
      motivo := case
        when not r_cand.disponible
          then 'AVISO: normalmente no trabaja esta franja ('||coalesce(r_cand.motivo_disp,'sin dato')||') pero hace falta para cubrir el servicio'
        else 'Disponible · '||round(r_cand.horas_ya,1)||' h ya asignadas esta semana' end;

      v_asignadas := jsonb_set(v_asignadas, array[r_turno.fecha::text],
        coalesce(v_asignadas -> (r_turno.fecha::text), '[]'::jsonb) || to_jsonb(r_cand.id::text));
      v_horas := jsonb_set(v_horas, array[r_cand.id::text],
        to_jsonb(coalesce((v_horas ->> r_cand.id::text)::numeric,0) + v_dur));
      return next;
    end loop;
  end loop;
end $function$;
grant execute on function public.propose_schedule(uuid,uuid,date) to authenticated, service_role;