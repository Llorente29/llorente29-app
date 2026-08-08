-- ============================================================
-- Rescatada del historial vivo de Supabase (aplicada 08/08/2026 17:13,
-- nunca versionada hasta ahora). Migración 6/12 de la secuencia F10
-- T1900→T2010 que rediseñó el reparto de horas de generate_week_schedule
-- en caliente sobre producción en una sola tarde.
-- ESTADO: no toca generate_week_schedule todavía — crea la función auxiliar
-- assign_extra_block, pieza base de la PASADA 3 (reparto de las horas
-- contratadas que sobran tras cubrir la demanda) en el orden fijado por
-- Julio: 3a doblar en el pico, 3b abrir franja 17-19 entre semana, 3c
-- prep/limpieza. Se integra en generate_week_schedule en la siguiente
-- migración (T1960). Esta pasada 3 fue retirada por completo en T2010.
-- Versión buena de la secuencia: T2010 (quitar_pasada3_relleno).
-- Resumen completo: memoria project_f10_solver_legal.
-- ============================================================

-- PASADA 3: reparto de las horas contratadas que sobran tras cubrir la demanda.
-- Orden fijado por Julio (08/08):
--   3a. DOBLAR EN EL PICO      (segunda persona en las horas de mas demanda)
--   3b. ABRIR FRANJA 17-19     (entre semana; hoy cerrada, estimada rentable)
--   3c. PREP Y LIMPIEZA        (bloque declarado, no productivo)
-- Cada bloque nuevo respeta las mismas restricciones duras que las pasadas 1 y 2.

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
                      where (t->>0)::timestamp < v_e and (t->>1)::timestamp > v_i) solapa
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
      and c.ya + v_d <= c.ctr
      and c.h_dia + v_d <= p_max_h
      and (c.n_dia = 0 or c.gap_min >= p_split_gap)
      and public.has_weekly_rest(coalesce(io_turnos->c.id::text,'[]'::jsonb),
            v_i, v_e, p_week_start, p_rest_min)
      and ((io_fin->>c.id::text) is null
           or (io_fin->>c.id::text)::timestamp::date = p_f
           or v_i >= ((io_fin->>c.id::text)::timestamp + make_interval(mins=>p_rest_12h)))
    order by (c.ctr - c.ya) desc, c.name
    limit 1
  loop
    io_plan := io_plan || jsonb_build_object('f',p_f,'ini',p_ini,'fin',p_fin,'capa',9,
                 'emp',r_c.id,'nom',r_c.name,'ext',0,
                 'part', case when r_c.n_dia>0 then 1 else 0 end, 'tipo', p_tipo);
    io_horas := jsonb_set(io_horas, array[r_c.id::text], to_jsonb(r_c.ya + v_d));
    io_turnos:= jsonb_set(io_turnos, array[r_c.id::text],
                  coalesce(io_turnos->r_c.id::text,'[]'::jsonb)
                  || jsonb_build_array(jsonb_build_array(
                       to_char(v_i,'YYYY-MM-DD"T"HH24:MI:SS'),
                       to_char(v_e,'YYYY-MM-DD"T"HH24:MI:SS'))));
    io_fin := jsonb_set(io_fin, array[r_c.id::text], to_jsonb(to_char(v_e,'YYYY-MM-DD"T"HH24:MI:SS')));
    o_ok := true;
  end loop;
end $function$;

DO $g$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='assign_extra_block') THEN
    RAISE EXCEPTION 'assign_extra_block no quedo'; END IF;
END $g$;

NOTIFY pgrst, 'reload schema';
