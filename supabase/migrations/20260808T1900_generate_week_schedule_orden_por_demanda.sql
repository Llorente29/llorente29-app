-- ============================================================
-- Rescatada del historial vivo de Supabase (aplicada 08/08/2026 16:58,
-- nunca versionada hasta ahora). Migración 1/12 de la secuencia F10
-- T1900→T2010 que rediseñó el reparto de horas de generate_week_schedule
-- en caliente sobre producción en una sola tarde.
-- ESTADO: INTENTO REVERTIDO por la siguiente migración (T1910) — el orden
-- por demanda descendente vaciaba lunes-jueves. Se deja íntegra, tal cual
-- se aplicó, como registro histórico.
-- Versión buena de la secuencia: T2010 (quitar_pasada3_relleno).
-- Resumen completo: memoria project_f10_solver_legal.
-- ============================================================

-- FALLO GRAVE CORREGIDO: el bucle asignaba los bloques en orden CRONOLOGICO (lunes ->
-- domingo). Como cada persona tiene un tope de horas contratadas, al llegar al fin de
-- semana ya no quedaban horas y los dias FUERTES se quedaban con una sola persona.
-- Observado en Alcala 10-16/08: domingo 142 platos (pico) con 1 persona por franja
-- (relevo, sin solape), mientras el jueves con 81 platos tenia 3 personas y solape.
--
-- Un encargado empieza por el domingo. El motor tiene que hacer lo mismo:
-- asignar primero los bloques de los dias de MAS demanda, y repartir el resto despues.
--
-- Cambio: ORDER BY (demanda del dia) DESC, nivel, hora  en el bucle principal.
-- La pasada 2 (acoplar horas sobrantes) ya prioriza por deficit, no se toca.

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
  r_b record; r_c record; r_x record;
  v_max_h numeric; v_min_h numeric; v_rest_min int; v_rest_12h int;
  v_horas jsonb := '{}'::jsonb; v_dias jsonb := '{}'::jsonb;
  v_turnos jsonb := '{}'::jsonb; v_fin jsonb := '{}'::jsonb;
  v_plan jsonb := '[]'::jsonb; v_gaps jsonb := '[]'::jsonb;
  v_dem jsonb := '{}'::jsonb;
  v_ini_ts timestamp; v_fin_ts timestamp; v_dur numeric;
  v_found boolean; v_target numeric; v_pass int; v_cambio boolean; v_ix int;
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
    into v_target from public.employees e
  where e.account_id=p_account and e.active and e.location_id=p_location;
  v_target := coalesce(v_target, 8);

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
    with dem as (
      select split_part(k,'|',1)::date f, split_part(k,'|',2)::int h, v::numeric q
      from jsonb_each_text(v_dem) t(k,v)
    ),
    carga as (select f, sum(q) total_dia from dem group by f),   -- <<< demanda del dia
    win as (select f, min(h) w_ini, max(h)+1 w_fin from dem group by f),
    niv as (select d.f,d.h,n.nivel from dem d cross join generate_series(1,6) n(nivel)
            where d.q >= n.nivel - 0.5),
    grp as (select f,nivel,h, h-row_number() over (partition by f,nivel order by h) g from niv),
    blq as (select f,nivel,min(h) hi,max(h)+1 hf from grp group by f,nivel,g),
    ext as (select b.f,b.nivel,
                   greatest(w.w_ini, least(b.hi, b.hf - ceil(v_target)::int)) hi2,
                   least(w.w_fin, greatest(b.hf, b.hi + ceil(v_target)::int)) hf2
            from blq b join win w on w.f=b.f),
    part as (select e.f,e.nivel,e.hi2,e.hf2, ceil((e.hf2-e.hi2)::numeric/v_max_h)::int n_p
             from ext e where (e.hf2-e.hi2)>=1),
    fin as (select p.f,p.nivel,
                   p.hi2 + round((p.hf2-p.hi2)::numeric*(k.i-1)/p.n_p)::int hi3,
                   p.hi2 + round((p.hf2-p.hi2)::numeric*k.i/p.n_p)::int hf3
            from part p cross join lateral generate_series(1,p.n_p) k(i))
    select fin.f, fin.nivel, fin.hi3, fin.hf3, (fin.hf3-fin.hi3)::numeric horas
    from fin join carga c on c.f = fin.f
    where (fin.hf3-fin.hi3)>=1
    -- PRIMERO LOS DIAS FUERTES, y dentro del dia la capa base antes que los refuerzos
    order by c.total_dia desc, fin.nivel, fin.hi3
  loop
    v_ini_ts := (r_b.f + make_interval(hours=>r_b.hi3))::timestamp;
    v_fin_ts := (r_b.f + make_interval(hours=>r_b.hf3))::timestamp;
    v_dur := r_b.horas; v_found := false;

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
        and coalesce((v_horas->>e.id::text)::numeric,0)+v_dur <= coalesce(e.contracted_hours_week,40)
        and public.has_weekly_rest(coalesce(v_turnos->e.id::text,'[]'::jsonb),
              v_ini_ts, v_fin_ts, p_week_start, v_rest_min)
        and ((v_fin->>e.id::text) is null
             or v_ini_ts >= ((v_fin->>e.id::text)::timestamp + make_interval(mins=>v_rest_12h)))
      order by (coalesce(e.contracted_hours_week,40)
                - coalesce((v_horas->>e.id::text)::numeric,0)) desc, e.name
      limit 1
    loop
      v_plan := v_plan || jsonb_build_object('f',r_b.f,'ini',r_b.hi3,'fin',r_b.hf3,
                  'capa',r_b.nivel,'emp',r_c.id,'nom',r_c.name,'ext',0);
      v_horas := jsonb_set(v_horas, array[r_c.id::text], to_jsonb(r_c.ya+v_dur));
      v_dias  := jsonb_set(v_dias, array[r_b.f::text],
                   coalesce(v_dias->(r_b.f::text),'[]'::jsonb)||to_jsonb(r_c.id::text));
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

  v_pass := 0;
  loop
    v_pass := v_pass + 1; v_cambio := false;
    exit when v_pass > 60;
    for r_x in
      with dem as (
        select split_part(k,'|',1)::date f, split_part(k,'|',2)::int h, v::numeric q
        from jsonb_each_text(v_dem) t(k,v)
      ),
      plan as (
        select (x->>'f')::date f, (x->>'ini')::int ini, (x->>'fin')::int fin,
               (x->>'emp')::uuid emp, (ord.i - 1)::int AS idx
        from jsonb_array_elements(v_plan) with ordinality ord(x,i)
      ),
      cob as (
        select p.f, h.hora, count(*) n
        from plan p cross join lateral generate_series(p.ini, p.fin-1) h(hora)
        group by p.f, h.hora
      ),
      def as (
        select e.id emp, coalesce(e.contracted_hours_week,40)
               - coalesce((v_horas->>e.id::text)::numeric,0) falta
        from public.employees e
        where e.account_id=p_account and e.active and e.location_id=p_location
      )
      select p.idx, p.f, p.fin, p.emp, (d.q - coalesce(c.n,0)) dh
      from plan p
      join def df on df.emp=p.emp and df.falta >= 1
      join dem d on d.f=p.f and d.h=p.fin
      left join cob c on c.f=p.f and c.hora=p.fin
      where (d.q - coalesce(c.n,0)) > 0.25
        and (p.fin + 1 - p.ini) <= v_max_h
      order by (d.q - coalesce(c.n,0)) desc, p.f, p.ini
      limit 1
    loop
      v_ix := r_x.idx;
      v_plan := jsonb_set(v_plan, array[v_ix::text,'fin'], to_jsonb(r_x.fin+1));
      v_plan := jsonb_set(v_plan, array[v_ix::text,'ext'],
                  to_jsonb(coalesce((v_plan->v_ix->>'ext')::int,0)+1));
      v_horas := jsonb_set(v_horas, array[r_x.emp::text],
                   to_jsonb(coalesce((v_horas->>r_x.emp::text)::numeric,0)+1));
      v_cambio := true;
    end loop;
    exit when not v_cambio;
  end loop;

  return query
  select (x->>'f')::date, extract(isodow from (x->>'f')::date)::int-1,
         (x->>'ini')::int, (x->>'fin')::int,
         ((x->>'fin')::int-(x->>'ini')::int)::numeric,
         (x->>'capa')::int, (x->>'emp')::uuid, x->>'nom', false,
         case when (x->>'ext')::int > 0
              then 'Ampliado '||(x->>'ext')||' h con jornada contratada disponible'
              else 'Turno de demanda' end
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
