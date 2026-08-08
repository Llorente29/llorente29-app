-- Aplicada: 2026-08-08 por MCP.
-- Dos correcciones al generador nuevo:
-- 1) FILTRO DE RUIDO: una hora solo entra en la ventana de apertura si aparece en al menos
--    p_min_pct_dias de los dias con venta (default 15%). Alcala: 8/9/10/12h aparecen en 1 dia
--    de 58 (1,7%) y metian turnos absurdos; 17/18/19h aparecen en 36-43% y son negocio real.
-- 2) JORNADA MAXIMA: un bloque mas largo que max_daily_minutes se PARTE en tramos iguales
--    (2 personas), en vez de proponer un turno ilegal de 12 h.

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
  r_b record; r_c record;
  v_max_h numeric; v_min_h numeric; v_rest_min int; v_rest_12h int;
  v_horas jsonb := '{}'::jsonb; v_dias jsonb := '{}'::jsonb;
  v_turnos jsonb := '{}'::jsonb; v_fin jsonb := '{}'::jsonb;
  v_ini_ts timestamp; v_fin_ts timestamp; v_dur numeric;
  v_found boolean; v_target numeric;
begin
  select coalesce(bp.max_daily_minutes,540)/60.0, coalesce(bp.min_shift_minutes,180)/60.0,
         coalesce(bp.weekly_rest_minutes,2160), coalesce(bp.min_rest_between_shifts_minutes,720)
    into v_max_h, v_min_h, v_rest_min, v_rest_12h
  from public.break_policy bp
  where bp.account_id=p_account and (bp.location_id=p_location or bp.location_id is null)
  order by bp.location_id nulls last limit 1;
  v_max_h:=coalesce(v_max_h,9); v_min_h:=coalesce(v_min_h,3);
  v_rest_min:=coalesce(v_rest_min,2160); v_rest_12h:=coalesce(v_rest_12h,720);

  select least(v_max_h, greatest(v_min_h, avg(coalesce(e.contracted_hours_week,40))/5.0))
    into v_target
  from public.employees e
  where e.account_id=p_account and e.active and e.location_id=p_location;
  v_target := coalesce(v_target, 8);

  for r_b in
    with horas_validas as (
      select s.hour
      from public.sales_hourly_agg s
      where s.location_id = p_location and s.day > now() - interval '90 days'
      group by s.hour
      having 100.0*count(distinct s.day)
             / nullif((select count(distinct s2.day) from public.sales_hourly_agg s2
                        where s2.location_id = p_location
                          and s2.day > now() - interval '90 days'),0) >= p_min_pct_dias
    ),
    req as (
      select r.fecha f, r.dow d, r.hora h, r.required q
      from public.team_labor_requirement(p_account,p_location,p_week_start) r
      where r.role_kind=p_role and r.required>0
        and r.hora in (select hour from horas_validas)
    ),
    win as (select f, min(h) w_ini, max(h)+1 w_fin from req group by f),
    niv as (select req.f,req.d,req.h,n.nivel from req cross join generate_series(1,6) n(nivel)
            where req.q>=n.nivel),
    grp as (select f,d,nivel,h, h-row_number() over (partition by f,d,nivel order by h) g from niv),
    blq as (select f,d,nivel,min(h) hi,max(h)+1 hf from grp group by f,d,nivel,g),
    ext as (
      select b.f,b.d,b.nivel,
             greatest(w.w_ini, least(b.hi, b.hf - ceil(v_target)::int)) hi2,
             least(w.w_fin, greatest(b.hf, b.hi + ceil(v_target)::int)) hf2
      from blq b join win w on w.f=b.f
    ),
    -- PARTIR los bloques que superan la jornada maxima en tramos iguales
    part as (
      select e.f, e.d, e.nivel, e.hi2, e.hf2,
             ceil((e.hf2-e.hi2)::numeric / v_max_h)::int AS n_partes
      from ext e where (e.hf2-e.hi2) >= 1
    ),
    final as (
      select p.f, p.d, p.nivel,
             p.hi2 + round((p.hf2-p.hi2)::numeric * (k.i-1) / p.n_partes)::int AS hi3,
             p.hi2 + round((p.hf2-p.hi2)::numeric * k.i     / p.n_partes)::int AS hf3
      from part p cross join lateral generate_series(1, p.n_partes) k(i)
    )
    select f,d,nivel,hi3,hf3,(hf3-hi3)::numeric horas
    from final where (hf3-hi3) >= 1
    order by f, nivel, hi3
  loop
    v_ini_ts := (r_b.f + make_interval(hours => r_b.hi3))::timestamp;
    v_fin_ts := (r_b.f + make_interval(hours => r_b.hf3))::timestamp;
    v_dur    := r_b.horas;
    v_found  := false;

    for r_c in
      select e.id, e.name, coalesce(e.contracted_hours_week,40) ctr,
             coalesce((v_horas->>e.id::text)::numeric,0) ya
      from public.employees e
      where e.account_id=p_account and e.active
        and (e.location_id=p_location
             or (e.assigned_locations is not null
                 and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
        and not exists (select 1 from public.vacations v
                        where v.employee_id=e.id and v.status='aprobada'
                          and r_b.f between v.start_date and v.end_date)
        and not (coalesce(v_dias->(r_b.f::text),'[]'::jsonb) @> to_jsonb(e.id::text))
        and coalesce((v_horas->>e.id::text)::numeric,0) + v_dur
            <= coalesce(e.contracted_hours_week,40)
        and public.has_weekly_rest(coalesce(v_turnos->e.id::text,'[]'::jsonb),
              v_ini_ts, v_fin_ts, p_week_start, v_rest_min)
        and ((v_fin->>e.id::text) is null
             or v_ini_ts >= ((v_fin->>e.id::text)::timestamp + make_interval(mins=>v_rest_12h)))
      order by (coalesce(e.contracted_hours_week,40)
                - coalesce((v_horas->>e.id::text)::numeric,0)) desc, e.name
      limit 1
    loop
      o_fecha:=r_b.f; o_dow:=r_b.d; o_ini:=r_b.hi3; o_fin:=r_b.hf3; o_horas:=v_dur;
      o_capa:=r_b.nivel; o_employee_id:=r_c.id; o_employee:=r_c.name; o_hueco:=false;
      o_motivo:='Acumula '||round(r_c.ya+v_dur,1)||' de '||round(r_c.ctr,0)||' h contratadas';

      v_horas := jsonb_set(v_horas, array[r_c.id::text], to_jsonb(r_c.ya+v_dur));
      v_dias  := jsonb_set(v_dias, array[r_b.f::text],
                   coalesce(v_dias->(r_b.f::text),'[]'::jsonb)||to_jsonb(r_c.id::text));
      v_turnos:= jsonb_set(v_turnos, array[r_c.id::text],
                   coalesce(v_turnos->r_c.id::text,'[]'::jsonb)
                   ||jsonb_build_array(jsonb_build_array(
                       to_char(v_ini_ts,'YYYY-MM-DD"T"HH24:MI:SS'),
                       to_char(v_fin_ts,'YYYY-MM-DD"T"HH24:MI:SS'))));
      v_fin   := jsonb_set(v_fin, array[r_c.id::text],
                   to_jsonb(to_char(v_fin_ts,'YYYY-MM-DD"T"HH24:MI:SS')));
      v_found:=true;
      return next;
    end loop;

    if not v_found then
      o_fecha:=r_b.f; o_dow:=r_b.d; o_ini:=r_b.hi3; o_fin:=r_b.hf3; o_horas:=v_dur;
      o_capa:=r_b.nivel; o_employee_id:=null; o_employee:=null; o_hueco:=true;
      o_motivo:='SIN CUBRIR — nadie de la plantilla puede sin incumplir';
      return next;
    end if;
  end loop;
end $function$;

NOTIFY pgrst, 'reload schema';
