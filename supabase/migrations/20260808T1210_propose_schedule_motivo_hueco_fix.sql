-- Aplicada: 2026-08-08 por MCP.
-- NOTA: el tope "max 5 dias/semana" de esta version quedo sustituido horas
-- despues, el mismo dia, por el descanso real de 36h continuas (art. 37.1) —
-- ver 20260808T1220_has_weekly_rest_36h.sql y 20260808T1230_propose_schedule_descanso_36h_real.sql.
-- Se versiona igualmente porque es lo que corrio en produccion en ese momento.
--
-- Fix: el contador de bloqueos debe usar EXACTAMENTE el mismo conjunto elegible
-- que la seleccion de candidatos (faltaba el filtro de local) -> motivo_hueco salia vacio.

CREATE OR REPLACE FUNCTION public.propose_schedule(p_account uuid, p_location uuid, p_week_start date)
RETURNS TABLE(
  dia date, day_of_week integer, shift_template_id uuid, shift_label text,
  employee_id uuid, employee_name text, motivo text, rompe_preferencia boolean,
  es_hueco boolean, motivo_hueco text
)
LANGUAGE plpgsql STABLE
AS $function$
declare
  r_turno record; r_cand record;
  v_asignadas jsonb := '{}'::jsonb;
  v_horas     jsonb := '{}'::jsonb;
  v_dias      jsonb := '{}'::jsonb;
  v_fin       jsonb := '{}'::jsonb;
  v_dur numeric; v_ini timestamp; v_fin_t timestamp;
  v_i integer; v_encontrado boolean;
  v_bloq_desc int; v_bloq_12h int; v_bloq_horas int;
  v_bloq_vac int; v_ocupados int; v_plantilla int;
  c_max_dias constant int := 5;
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
    where st.location_id = p_location and st.account_id = p_account and st.active
      and coalesce(case d.dow
             when 0 then st.coverage_mon when 1 then st.coverage_tue when 2 then st.coverage_wed
             when 3 then st.coverage_thu when 4 then st.coverage_fri when 5 then st.coverage_sat
             else st.coverage_sun end, 0) > 0
    order by d.dow, st.start_time
  loop
    v_dur := extract(epoch from (
               (r_turno.end_time - r_turno.start_time)
               + case when r_turno.end_time <= r_turno.start_time
                      then interval '24 hours' else interval '0' end)) / 3600.0;
    v_ini   := (r_turno.fecha + r_turno.start_time)::timestamp;
    v_fin_t := v_ini + make_interval(secs => v_dur * 3600);

    for v_i in 1 .. r_turno.necesita loop
      v_encontrado := false;

      -- Conjunto elegible IDENTICO al de candidatos (incluye filtro de local)
      select count(*),
             count(*) filter (where en_vac),
             count(*) filter (where ya_hoy),
             count(*) filter (where not en_vac and not ya_hoy and dias_ya >= c_max_dias),
             count(*) filter (where not en_vac and not ya_hoy and fin_ant is not null
                                and v_ini < (fin_ant + interval '12 hours')),
             count(*) filter (where not en_vac and not ya_hoy
                                and horas_ya + v_dur > horas_contrato)
        into v_plantilla, v_bloq_vac, v_ocupados, v_bloq_desc, v_bloq_12h, v_bloq_horas
      from (
        select
          exists (select 1 from public.vacations v
                  where v.employee_id = e.id and v.status='aprobada'
                    and r_turno.fecha between v.start_date and v.end_date) as en_vac,
          (coalesce(v_asignadas -> (r_turno.fecha::text), '[]'::jsonb)
             @> to_jsonb(e.id::text)) as ya_hoy,
          coalesce((v_dias  ->> e.id::text)::int, 0)     as dias_ya,
          coalesce((v_horas ->> e.id::text)::numeric, 0) as horas_ya,
          coalesce(e.contracted_hours_week, 40)          as horas_contrato,
          (v_fin ->> e.id::text)::timestamp              as fin_ant
        from public.employees e
        where e.account_id = p_account and e.active
          and (
            e.location_id = p_location
            or (e.assigned_locations is not null
                and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text))
            or (select count(*) from public.clock_entries ce
                where ce.employee_id = e.id and ce.location_id_at_clock = p_location
                  and not coalesce(ce.voided,false)
                  and ce.real_datetime > now() - interval '90 days') >= 5
          )
      ) q;

      for r_cand in
        select e.id, e.name,
               coalesce((v_horas ->> e.id::text)::numeric, 0) as horas_ya,
               coalesce((v_dias  ->> e.id::text)::int, 0)     as dias_ya,
               coalesce(av.available, true) as disponible,
               av.note as motivo_disp,
               (e.location_id = p_location) as es_su_local
        from public.employees e
        left join public.employee_availability av
          on av.employee_id = e.id and av.day_of_week = r_turno.dow
         and av.shift_period = r_turno.periodo
        where e.account_id = p_account and e.active
          and (
            e.location_id = p_location
            or (e.assigned_locations is not null
                and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text))
            or (select count(*) from public.clock_entries ce
                where ce.employee_id = e.id and ce.location_id_at_clock = p_location
                  and not coalesce(ce.voided,false)
                  and ce.real_datetime > now() - interval '90 days') >= 5
          )
          and not exists (select 1 from public.vacations v
                          where v.employee_id = e.id and v.status='aprobada'
                            and r_turno.fecha between v.start_date and v.end_date)
          and not (coalesce(v_asignadas -> (r_turno.fecha::text), '[]'::jsonb)
                   @> to_jsonb(e.id::text))
          and coalesce((v_dias ->> e.id::text)::int, 0) < c_max_dias
          and (
            (v_fin ->> e.id::text) is null
            or v_ini >= ((v_fin ->> e.id::text)::timestamp + interval '12 hours')
          )
          and coalesce((v_horas ->> e.id::text)::numeric, 0) + v_dur
              <= coalesce(e.contracted_hours_week, 40)
        order by coalesce(av.available, true) desc,
                 (e.location_id = p_location) desc,
                 coalesce((v_horas ->> e.id::text)::numeric, 0) asc,
                 e.name
        limit 1
      loop
        dia := r_turno.fecha; day_of_week := r_turno.dow;
        shift_template_id := r_turno.tpl; shift_label := r_turno.label;
        employee_id := r_cand.id; employee_name := r_cand.name;
        rompe_preferencia := not r_cand.disponible;
        es_hueco := false; motivo_hueco := null;
        motivo := case
          when not r_cand.disponible
            then 'AVISO: normalmente no trabaja esta franja ('
                 ||coalesce(r_cand.motivo_disp,'sin dato')||') pero hace falta para cubrir'
          when not r_cand.es_su_local
            then 'Cubre desde otro local · '||round(r_cand.horas_ya + v_dur,1)||' h esta semana'
          else 'Disponible · '||round(r_cand.horas_ya + v_dur,1)||' h esta semana' end;

        v_asignadas := jsonb_set(v_asignadas, array[r_turno.fecha::text],
          coalesce(v_asignadas -> (r_turno.fecha::text), '[]'::jsonb) || to_jsonb(r_cand.id::text));
        v_horas := jsonb_set(v_horas, array[r_cand.id::text], to_jsonb(r_cand.horas_ya + v_dur));
        v_dias  := jsonb_set(v_dias,  array[r_cand.id::text], to_jsonb(r_cand.dias_ya + 1));
        v_fin   := jsonb_set(v_fin,   array[r_cand.id::text],
                     to_jsonb(to_char(v_fin_t, 'YYYY-MM-DD"T"HH24:MI:SS')));
        v_encontrado := true;
        return next;
      end loop;

      if not v_encontrado then
        dia := r_turno.fecha; day_of_week := r_turno.dow;
        shift_template_id := r_turno.tpl; shift_label := r_turno.label;
        employee_id := null; employee_name := null;
        rompe_preferencia := false; es_hueco := true;
        motivo := 'SIN CUBRIR — nadie puede sin incumplir';
        motivo_hueco := nullif(concat_ws(' · ',
          case when v_ocupados   > 0 then 'ya tienen turno ese dia: '||v_ocupados end,
          case when v_bloq_desc  > 0 then 'descanso semanal art. 37.1: '||v_bloq_desc end,
          case when v_bloq_12h   > 0 then 'descanso de 12 h art. 34.3: '||v_bloq_12h end,
          case when v_bloq_horas > 0 then 'superarian su jornada contratada: '||v_bloq_horas end,
          case when v_bloq_vac   > 0 then 'vacaciones aprobadas: '||v_bloq_vac end,
          case when v_plantilla  = 0 then 'no hay personal asignado a este local' end
        ), '');
        motivo_hueco := coalesce(motivo_hueco,
          'plantilla insuficiente para la cobertura pedida ('||v_plantilla||' personas)');
        return next;
      end if;
    end loop;
  end loop;
end $function$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='propose_schedule') THEN
    RAISE EXCEPTION 'propose_schedule no quedo';
  END IF;
END $guard$;

NOTIFY pgrst, 'reload schema';
