-- ============================================================
-- Rescatada del historial vivo de Supabase (aplicada 08/08/2026 17:15,
-- nunca versionada hasta ahora). Migración 8/12 de la secuencia F10
-- T1900→T2010 que rediseñó el reparto de horas de generate_week_schedule
-- en caliente sobre producción en una sola tarde.
-- ESTADO: corrige la llamada a assign_extra_block introducida en T1960 —
-- recogía solo el primer valor OUT (io_plan, jsonb) en una variable
-- boolean y descartaba el resto de la salida; ahora recoge los 5 valores
-- devueltos (plan, horas, turnos, fin, ok) en sus variables correctas.
-- La pasada 3 (3a pico, 3b apertura 17-19) sigue vigente en esta versión;
-- fue retirada por completo en T2010.
-- Versión buena de la secuencia: T2010 (quitar_pasada3_relleno).
-- Resumen completo: memoria project_f10_solver_legal.
-- ============================================================

-- Fix: la llamada a assign_extra_block asignaba el primer OUT (jsonb) a un boolean.
-- Hay que recoger los 5 valores devueltos en sus variables.
CREATE OR REPLACE FUNCTION public.generate_week_schedule(
  p_account uuid, p_location uuid, p_week_start date, p_role text DEFAULT 'cocina',
  p_min_pct_dias numeric DEFAULT 15.0)
RETURNS TABLE(
  o_fecha date, o_dow integer, o_ini integer, o_fin integer, o_horas numeric,
  o_capa integer, o_employee_id uuid, o_employee text, o_hueco boolean, o_motivo text)
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $function$
declare
  r_b record; r_c record; r_p record;
  v_max_h numeric; v_min_h numeric; v_rest_min int; v_rest_12h int; v_split_gap int;
  v_horas jsonb := '{}'::jsonb; v_turnos jsonb := '{}'::jsonb; v_fin jsonb := '{}'::jsonb;
  v_plan jsonb := '[]'::jsonb; v_gaps jsonb := '[]'::jsonb; v_dem jsonb := '{}'::jsonb;
  v_ini_ts timestamp; v_fin_ts timestamp; v_dur numeric; v_found boolean; v_ok boolean;
begin
  select coalesce(bp.max_daily_minutes,540)/60.0, coalesce(bp.min_shift_minutes,180)/60.0,
         coalesce(bp.weekly_rest_minutes,2160), coalesce(bp.min_rest_between_shifts_minutes,720),
         coalesce(bp.split_min_gap_minutes,90)
    into v_max_h, v_min_h, v_rest_min, v_rest_12h, v_split_gap
  from public.break_policy bp
  where bp.account_id=p_account and (bp.location_id=p_location or bp.location_id is null)
  order by bp.location_id nulls last limit 1;
  v_max_h:=coalesce(v_max_h,9); v_min_h:=coalesce(v_min_h,3);
  v_rest_min:=coalesce(v_rest_min,2160); v_rest_12h:=coalesce(v_rest_12h,720);
  v_split_gap:=coalesce(v_split_gap,90);

  select coalesce(jsonb_object_agg(r.fecha::text||'|'||r.hora::text, r.required_exact),'{}'::jsonb)
    into v_dem
  from public.team_labor_requirement(p_account,p_location,p_week_start) r
  where r.role_kind=p_role and r.required_exact > 0
    and r.hora in (
      select s.hour from public.sales_hourly_agg s
      where s.location_id=p_location and s.day > now() - interval '90 days'
      group by s.hour
      having 100.0*count(distinct s.day)
             / nullif((select count(distinct s2.day) from public.sales_hourly_agg s2
                        where s2.location_id=p_location
                          and s2.day > now() - interval '90 days'),0) >= p_min_pct_dias);

  for r_b in
    with dem as (select split_part(k,'|',1)::date f, split_part(k,'|',2)::int h, v::numeric q
                 from jsonb_each_text(v_dem) t(k,v)),
    niv as (select d.f,d.h,n.nivel from dem d cross join generate_series(1,6) n(nivel)
            where d.q >= n.nivel - 0.5),
    grp as (select f,nivel,h, h-row_number() over (partition by f,nivel order by h) g from niv),
    blq as (select f,nivel,min(h) hi,max(h)+1 hf from grp group by f,nivel,g),
    part as (select b.f,b.nivel,b.hi,b.hf, ceil((b.hf-b.hi)::numeric/v_max_h)::int n_p from blq b),
    fin as (select p.f,p.nivel,
                   p.hi + round((p.hf-p.hi)::numeric*(k.i-1)/p.n_p)::int hi3,
                   p.hi + round((p.hf-p.hi)::numeric*k.i/p.n_p)::int hf3
            from part p cross join lateral generate_series(1,p.n_p) k(i))
    select fin.f, fin.nivel, fin.hi3, fin.hf3, (fin.hf3-fin.hi3)::numeric horas
    from fin where (fin.hf3-fin.hi3) >= 1
    order by fin.nivel, fin.f, fin.hi3
  loop
    v_ini_ts := (r_b.f + make_interval(hours=>r_b.hi3))::timestamp;
    v_fin_ts := (r_b.f + make_interval(hours=>r_b.hf3))::timestamp;
    v_dur := r_b.horas; v_found := false;
    for r_c in
      with cand as (
        select e.id, e.name, coalesce(e.contracted_hours_week,40) ctr,
               coalesce((v_horas->>e.id::text)::numeric,0) ya,
               (select coalesce(sum(extract(epoch from ((t->>1)::timestamp-(t->>0)::timestamp))/3600),0)
                  from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                 where (t->>0)::timestamp::date = r_b.f) h_dia,
               (select count(*) from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                 where (t->>0)::timestamp::date = r_b.f) n_dia,
               (select min(greatest(extract(epoch from (v_ini_ts-(t->>1)::timestamp))/60,
                                    extract(epoch from ((t->>0)::timestamp-v_fin_ts))/60))
                  from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                 where (t->>0)::timestamp::date = r_b.f) gap_min,
               exists (select 1 from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                        where (t->>0)::timestamp < v_fin_ts and (t->>1)::timestamp > v_ini_ts) solapa
        from public.employees e
        where e.account_id=p_account and e.active
          and (e.location_id=p_location
               or (e.assigned_locations is not null
                   and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
          and not exists (select 1 from public.vacations v
                          where v.employee_id=e.id and v.status='aprobada'
                            and r_b.f between v.start_date and v.end_date))
      select c.id, c.name, c.ctr, c.ya, c.n_dia from cand c
      where not c.solapa and c.ya + v_dur <= c.ctr and c.h_dia + v_dur <= v_max_h
        and (c.n_dia = 0 or c.gap_min >= v_split_gap)
        and public.has_weekly_rest(coalesce(v_turnos->c.id::text,'[]'::jsonb),
              v_ini_ts, v_fin_ts, p_week_start, v_rest_min)
        and ((v_fin->>c.id::text) is null
             or (v_fin->>c.id::text)::timestamp::date = r_b.f
             or v_ini_ts >= ((v_fin->>c.id::text)::timestamp + make_interval(mins=>v_rest_12h)))
      order by (c.n_dia > 0) desc, (c.ctr - c.ya) desc, c.name limit 1
    loop
      v_plan := v_plan || jsonb_build_object('f',r_b.f,'ini',r_b.hi3,'fin',r_b.hf3,
                  'capa',r_b.nivel,'emp',r_c.id,'nom',r_c.name,
                  'part', case when r_c.n_dia>0 then 1 else 0 end, 'tipo','demanda');
      v_horas := jsonb_set(v_horas, array[r_c.id::text], to_jsonb(r_c.ya+v_dur));
      v_turnos:= jsonb_set(v_turnos, array[r_c.id::text],
                   coalesce(v_turnos->r_c.id::text,'[]'::jsonb)
                   ||jsonb_build_array(jsonb_build_array(
                       to_char(v_ini_ts,'YYYY-MM-DD"T"HH24:MI:SS'),
                       to_char(v_fin_ts,'YYYY-MM-DD"T"HH24:MI:SS'))));
      v_fin := jsonb_set(v_fin, array[r_c.id::text],
                 to_jsonb(to_char(v_fin_ts,'YYYY-MM-DD"T"HH24:MI:SS')));
      v_found := true;
    end loop;
    if not v_found then
      v_gaps := v_gaps || jsonb_build_object('f',r_b.f,'ini',r_b.hi3,'fin',r_b.hf3,'capa',r_b.nivel);
    end if;
  end loop;

  -- 3a DOBLAR EN EL PICO
  for r_p in
    with dem as (select split_part(k,'|',1)::date f, split_part(k,'|',2)::int h, v::numeric q
                 from jsonb_each_text(v_dem) t(k,v)),
    pico as (select f,h,q, row_number() over (partition by f order by q desc, h) rn from dem)
    select f, min(h) hi, max(h)+1 hf from pico where rn <= 3 group by f
    having max(h)+1 - min(h) <= 4 order by f
  loop
    select a.io_plan, a.io_horas, a.io_turnos, a.io_fin, a.o_ok
      into v_plan, v_horas, v_turnos, v_fin, v_ok
    from public.assign_extra_block(p_account,p_location,p_week_start,
           r_p.f, r_p.hi, r_p.hf, 'refuerzo_pico',
           v_plan, v_horas, v_turnos, v_fin,
           v_max_h, v_rest_min, v_rest_12h, v_split_gap) a;
  end loop;

  -- 3b ABRIR 17-19 ENTRE SEMANA
  for r_p in select (p_week_start + d)::date f from generate_series(0,3) d
  loop
    select a.io_plan, a.io_horas, a.io_turnos, a.io_fin, a.o_ok
      into v_plan, v_horas, v_turnos, v_fin, v_ok
    from public.assign_extra_block(p_account,p_location,p_week_start,
           r_p.f, 17, 20, 'apertura_tarde',
           v_plan, v_horas, v_turnos, v_fin,
           v_max_h, v_rest_min, v_rest_12h, v_split_gap) a;
  end loop;

  return query
  select (x->>'f')::date, extract(isodow from (x->>'f')::date)::int-1,
         (x->>'ini')::int, (x->>'fin')::int,
         ((x->>'fin')::int-(x->>'ini')::int)::numeric,
         (x->>'capa')::int, (x->>'emp')::uuid, x->>'nom', false,
         concat_ws(' · ',
           case when (x->>'part')::int = 1 then 'Turno partido' end,
           case x->>'tipo' when 'refuerzo_pico'  then 'Refuerzo de pico (horas contratadas)'
                           when 'apertura_tarde' then 'Apertura 17-19 (horas contratadas)'
                           else 'Turno de demanda' end)
  from jsonb_array_elements(v_plan) x
  union all
  select (x->>'f')::date, extract(isodow from (x->>'f')::date)::int-1,
         (x->>'ini')::int, (x->>'fin')::int,
         ((x->>'fin')::int-(x->>'ini')::int)::numeric,
         (x->>'capa')::int, null, null, true,
         'SIN CUBRIR — nadie de la plantilla puede sin incumplir'
  from jsonb_array_elements(v_gaps) x
  order by 1, 3;
end $function$;

NOTIFY pgrst, 'reload schema';
