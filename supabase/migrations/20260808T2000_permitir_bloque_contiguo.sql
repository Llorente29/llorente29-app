-- ============================================================
-- Rescatada del historial vivo de Supabase (aplicada 08/08/2026 17:26,
-- nunca versionada hasta ahora). Migración 11/12 de la secuencia F10
-- T1900→T2010 que rediseñó el reparto de horas de generate_week_schedule
-- en caliente sobre producción en una sola tarde.
-- ESTADO: corrige que un bloque CONTIGUO a un turno ya asignado (hueco=0,
-- ej. prep 10-13 pegado a un turno de 13-17) se rechazaba porque la regla
-- de turno partido exigía hueco >= split_min_gap. Un bloque pegado no es
-- un partido: es alargar la jornada continua. Regla nueva en
-- assign_extra_block: hueco = 0 (contiguo, se funde) o hueco >= split_gap
-- (partido legal). Esta pasada 3 (que usa assign_extra_block) fue retirada
-- por completo en la siguiente y última migración (T2010).
-- Versión buena de la secuencia: T2010 (quitar_pasada3_relleno).
-- Resumen completo: memoria project_f10_solver_legal.
-- ============================================================

-- Fix: un bloque CONTIGUO a un turno existente (hueco = 0, p.ej. prep 10-13 pegado al
-- turno de 13-17) se rechazaba porque la regla de turno partido exige hueco >= 90 min.
-- Un bloque pegado no es un partido: es alargar el turno (jornada continua = prioridad 3).
-- Regla nueva: hueco 0 (contiguo, se funde) O hueco >= split_gap (partido legal).
CREATE OR REPLACE FUNCTION public.assign_extra_block(
  p_account uuid, p_location uuid, p_week_start date,
  p_f date, p_ini int, p_fin int, p_tipo text,
  INOUT io_plan jsonb, INOUT io_horas jsonb, INOUT io_turnos jsonb, INOUT io_fin jsonb,
  p_max_h numeric, p_rest_min int, p_rest_12h int, p_split_gap int,
  OUT o_ok boolean)
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $function$
declare r_c record; v_i timestamp; v_e timestamp; v_d numeric;
begin
  o_ok := false;
  v_i := (p_f + make_interval(hours=>p_ini))::timestamp;
  v_e := (p_f + make_interval(hours=>p_fin))::timestamp;
  v_d := p_fin - p_ini;

  for r_c in
    with cand as (
      select e.id, e.name, coalesce(e.contracted_hours_week,40) ctr,
             coalesce((io_horas->>e.id::text)::numeric,0) ya,
             (select coalesce(sum(extract(epoch from ((t->>1)::timestamp-(t->>0)::timestamp))/3600),0)
                from jsonb_array_elements(coalesce(io_turnos->e.id::text,'[]'::jsonb)) t
               where (t->>0)::timestamp::date = p_f) h_dia,
             (select count(*) from jsonb_array_elements(coalesce(io_turnos->e.id::text,'[]'::jsonb)) t
               where (t->>0)::timestamp::date = p_f) n_dia,
             (select min(greatest(
                  extract(epoch from (v_i-(t->>1)::timestamp))/60,
                  extract(epoch from ((t->>0)::timestamp-v_e))/60))
                from jsonb_array_elements(coalesce(io_turnos->e.id::text,'[]'::jsonb)) t
               where (t->>0)::timestamp::date = p_f) gap_min,
             exists (select 1 from jsonb_array_elements(coalesce(io_turnos->e.id::text,'[]'::jsonb)) t
                      where (t->>0)::timestamp < v_e and (t->>1)::timestamp > v_i) solapa,
             exists (select 1 from jsonb_array_elements(coalesce(io_turnos->e.id::text,'[]'::jsonb)) t
                      where (t->>0)::timestamp::date <> p_f
                        and ( ((t->>1)::timestamp <= v_i
                               and v_i < (t->>1)::timestamp + make_interval(mins=>p_rest_12h))
                           or (v_e <= (t->>0)::timestamp
                               and (t->>0)::timestamp < v_e + make_interval(mins=>p_rest_12h)) )
             ) viola_12h
      from public.employees e
      where e.account_id=p_account and e.active
        and (e.location_id=p_location
             or (e.assigned_locations is not null
                 and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
        and not exists (select 1 from public.vacations v
                        where v.employee_id=e.id and v.status='aprobada'
                          and p_f between v.start_date and v.end_date)
    )
    select c.id, c.name, c.ya, c.n_dia from cand c
    where not c.solapa
      and not c.viola_12h
      and c.ya + v_d <= c.ctr
      and c.h_dia + v_d <= p_max_h
      and (c.n_dia = 0 or c.gap_min = 0 or c.gap_min >= p_split_gap)
      and public.has_weekly_rest(coalesce(io_turnos->c.id::text,'[]'::jsonb),
            v_i, v_e, p_week_start, p_rest_min)
    order by (c.ctr - c.ya) desc, c.name
    limit 1
  loop
    io_plan := io_plan || jsonb_build_object('f',p_f,'ini',p_ini,'fin',p_fin,'capa',9,
                 'emp',r_c.id,'nom',r_c.name,
                 'part', case when r_c.n_dia>0 then 1 else 0 end, 'tipo', p_tipo);
    io_horas := jsonb_set(io_horas, array[r_c.id::text], to_jsonb(r_c.ya + v_d));
    io_turnos:= jsonb_set(io_turnos, array[r_c.id::text],
                  coalesce(io_turnos->r_c.id::text,'[]'::jsonb)
                  || jsonb_build_array(jsonb_build_array(
                       to_char(v_i,'YYYY-MM-DD"T"HH24:MI:SS'),
                       to_char(v_e,'YYYY-MM-DD"T"HH24:MI:SS'))));
    o_ok := true;
  end loop;
end $function$;

NOTIFY pgrst, 'reload schema';
