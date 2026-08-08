-- ============================================================
-- Rescatada del historial vivo de Supabase (aplicada 08/08/2026 17:26,
-- nunca versionada hasta ahora). Migración 10/12 de la secuencia F10
-- T1900→T2010 que rediseñó el reparto de horas de generate_week_schedule
-- en caliente sobre producción en una sola tarde.
-- ESTADO: dos fixes verificados con datos reales, no supuestos — (1) la
-- comprobación de descanso de 12h solo se hacía contra el último turno
-- asignado en orden de ASIGNACIÓN (no cronológico), lo que rechazaba en
-- falso bloques de días anteriores en la semana al último asignado por la
-- pasada 3 (caso detectado con Natacha); ahora la comprobación es
-- BIDIRECCIONAL contra los turnos de otros días. (2) la ventana de
-- refuerzo de pico exigía que las 3 horas de mayor demanda fueran
-- contiguas y descartaba el día entero si no lo eran (solo colocaba 1
-- refuerzo en toda la semana); ahora busca la mejor ventana CONTIGUA de 3h
-- por suma de demanda. La pasada 3 sigue vigente en esta versión; fue
-- retirada por completo en T2010.
-- Versión buena de la secuencia: T2010 (quitar_pasada3_relleno).
-- Resumen completo: memoria project_f10_solver_legal.
-- ============================================================

-- DOS FIXES verificados con datos (no supuestos):
-- 1) La comprobacion de 12 h usaba io_fin = fin del ULTIMO turno ASIGNADO (orden de
--    asignacion). La pasada 3 asigna en orden no cronologico, asi que cualquier bloque
--    anterior en la semana al ultimo asignado se rechazaba siempre (Natacha: ultimo
--    bloque domingo 16:00 -> todo lo del lunes-sabado fallaba el check).
--    Ahora: comprobacion BIDIRECCIONAL contra los turnos cronologicamente vecinos de
--    OTROS dias en io_turnos (el mismo dia lo gobierna split_gap).
-- 2) El bloque de pico usaba las "3 horas de mas demanda" y si no eran contiguas el
--    HAVING descartaba el dia entero (solo colocaba 1 refuerzo en toda la semana).
--    Ahora: mejor ventana CONTIGUA de 3 h por suma de demanda.

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
             -- 12 h bidireccional contra turnos de OTROS dias
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
      and (c.n_dia = 0 or c.gap_min >= p_split_gap)
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

-- Ventana de pico contigua en el generador
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
  v_iter int; v_alguno boolean;
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

  -- PASADA 1 (cronologica dentro de capa; el 12h bidireccional tambien aqui)
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
                        where (t->>0)::timestamp < v_fin_ts and (t->>1)::timestamp > v_ini_ts) solapa,
               exists (select 1 from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                        where (t->>0)::timestamp::date <> r_b.f
                          and ( ((t->>1)::timestamp <= v_ini_ts
                                 and v_ini_ts < (t->>1)::timestamp + make_interval(mins=>v_rest_12h))
                             or (v_fin_ts <= (t->>0)::timestamp
                                 and (t->>0)::timestamp < v_fin_ts + make_interval(mins=>v_rest_12h)) )
               ) viola_12h
        from public.employees e
        where e.account_id=p_account and e.active
          and (e.location_id=p_location
               or (e.assigned_locations is not null
                   and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
          and not exists (select 1 from public.vacations v
                          where v.employee_id=e.id and v.status='aprobada'
                            and r_b.f between v.start_date and v.end_date))
      select c.id, c.name, c.ctr, c.ya, c.n_dia from cand c
      where not c.solapa and not c.viola_12h
        and c.ya + v_dur <= c.ctr and c.h_dia + v_dur <= v_max_h
        and (c.n_dia = 0 or c.gap_min >= v_split_gap)
        and public.has_weekly_rest(coalesce(v_turnos->c.id::text,'[]'::jsonb),
              v_ini_ts, v_fin_ts, p_week_start, v_rest_min)
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
      v_found := true;
    end loop;
    if not v_found then
      v_gaps := v_gaps || jsonb_build_object('f',r_b.f,'ini',r_b.hi3,'fin',r_b.hf3,'capa',r_b.nivel);
    end if;
  end loop;

  -- 3a: DOBLAR EN EL PICO — mejor ventana CONTIGUA de 3 h, dias fuertes primero
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_alguno := false;
    exit when v_iter > 30;
    for r_p in
      with dem as (select split_part(k,'|',1)::date f, split_part(k,'|',2)::int h, v::numeric q
                   from jsonb_each_text(v_dem) t(k,v)),
      v3 as (select d.f, d.h hi, sum(d2.q) s
             from dem d join dem d2 on d2.f=d.f and d2.h between d.h and d.h+2
             group by d.f, d.h having count(*) = 3),
      mejor as (select distinct on (f) f, hi, s from v3 order by f, s desc, hi),
      carga as (select f, sum(q) tot from dem group by f)
      select m.f, m.hi, m.hi+3 hf
      from mejor m join carga c on c.f=m.f
      order by c.tot desc
    loop
      select a.io_plan, a.io_horas, a.io_turnos, a.io_fin, a.o_ok
        into v_plan, v_horas, v_turnos, v_fin, v_ok
      from public.assign_extra_block(p_account,p_location,p_week_start,
             r_p.f, r_p.hi, r_p.hf, 'refuerzo_pico',
             v_plan, v_horas, v_turnos, v_fin,
             v_max_h, v_rest_min, v_rest_12h, v_split_gap) a;
      if v_ok then v_alguno := true; end if;
    end loop;
    exit when not v_alguno;
  end loop;

  -- 3b: ABRIR 17-20 ENTRE SEMANA
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_alguno := false;
    exit when v_iter > 30;
    for r_p in select (p_week_start + d)::date f from generate_series(0,3) d
    loop
      select a.io_plan, a.io_horas, a.io_turnos, a.io_fin, a.o_ok
        into v_plan, v_horas, v_turnos, v_fin, v_ok
      from public.assign_extra_block(p_account,p_location,p_week_start,
             r_p.f, 17, 20, 'apertura_tarde',
             v_plan, v_horas, v_turnos, v_fin,
             v_max_h, v_rest_min, v_rest_12h, v_split_gap) a;
      if v_ok then v_alguno := true; end if;
    end loop;
    exit when not v_alguno;
  end loop;

  -- 3c: PREP/LIMPIEZA 10-13
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_alguno := false;
    exit when v_iter > 30;
    for r_p in select (p_week_start + d)::date f from generate_series(0,6) d
    loop
      select a.io_plan, a.io_horas, a.io_turnos, a.io_fin, a.o_ok
        into v_plan, v_horas, v_turnos, v_fin, v_ok
      from public.assign_extra_block(p_account,p_location,p_week_start,
             r_p.f, 10, 13, 'prep_limpieza',
             v_plan, v_horas, v_turnos, v_fin,
             v_max_h, v_rest_min, v_rest_12h, v_split_gap) a;
      if v_ok then v_alguno := true; end if;
    end loop;
    exit when not v_alguno;
  end loop;

  return query
  select (x->>'f')::date, extract(isodow from (x->>'f')::date)::int-1,
         (x->>'ini')::int, (x->>'fin')::int,
         ((x->>'fin')::int-(x->>'ini')::int)::numeric,
         (x->>'capa')::int, (x->>'emp')::uuid, x->>'nom', false,
         concat_ws(' · ',
           case when (x->>'part')::int = 1 then 'Turno partido' end,
           case x->>'tipo' when 'refuerzo_pico'  then 'Refuerzo de pico (horas contratadas)'
                           when 'apertura_tarde' then 'Apertura 17-20 (horas contratadas)'
                           when 'prep_limpieza'  then 'Prep/limpieza (horas contratadas)'
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
