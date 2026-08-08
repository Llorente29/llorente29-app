-- Aplicada: 2026-08-08 por MCP.
-- ⚠️ VERSIONADO PORQUE ESTÁ APLICADO, NO PORQUE ESTÉ LISTO. F10 sigue 🟡.
-- Ver 20260808T1600_labor_model_20_platos_hora.sql para el defecto medido:
-- team_labor_requirement redondea al alza hora a hora e infla la necesidad de
-- personal un 101% (pide 79 personas-hora/semana cuando la producción real
-- necesita 39,4). generate_week_schedule hereda ese sobredimensionado.
--
-- GENERADOR NUEVO. No usa shift_templates. No toca propose_schedule.
-- Curva de venta -> bloques continuos dimensionados a la jornada contratada -> asignacion.
-- Objetivo primario: que cada trabajador ALCANCE su jornada contratada (suelo), sin pasarse (techo).
-- Restricciones duras: vacaciones, 1 turno/dia, descanso semanal, 12 h entre jornadas,
-- jornada maxima diaria, pertenencia al local.

CREATE OR REPLACE FUNCTION public.generate_week_schedule(
  p_account uuid, p_location uuid, p_week_start date, p_role text DEFAULT 'cocina')
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

  -- turno objetivo: jornada contratada media / 5 dias, acotado por la jornada maxima
  select least(v_max_h, greatest(v_min_h, avg(coalesce(e.contracted_hours_week,40))/5.0))
    into v_target
  from public.employees e
  where e.account_id=p_account and e.active and e.location_id=p_location;
  v_target := coalesce(v_target, 8);

  for r_b in
    with req as (
      select r.fecha f, r.dow d, r.hora h, r.required q
      from public.team_labor_requirement(p_account,p_location,p_week_start) r
      where r.role_kind=p_role and r.required>0
    ),
    win as (select f, min(h) w_ini, max(h)+1 w_fin from req group by f),
    niv as (select req.f,req.d,req.h,n.nivel from req cross join generate_series(1,6) n(nivel)
            where req.q>=n.nivel),
    grp as (select f,d,nivel,h, h-row_number() over (partition by f,d,nivel order by h) g from niv),
    blq as (select f,d,nivel,min(h) hi,max(h)+1 hf from grp group by f,d,nivel,g),
    -- estirar cada bloque hacia el turno objetivo, dentro de la ventana del dia
    ext as (
      select b.f,b.d,b.nivel,
             greatest(w.w_ini, least(b.hi,
               b.hf - ceil(least(v_target, v_max_h))::int)) as hi2,
             least(w.w_fin, greatest(b.hf,
               b.hi + ceil(least(v_target, v_max_h))::int)) as hf2
      from blq b join win w on w.f=b.f
    )
    select f,d,nivel,hi2,hf2,(hf2-hi2)::numeric horas from ext
    where (hf2-hi2) >= 1
    order by f, nivel, hi2
  loop
    v_ini_ts := (r_b.f + make_interval(hours => r_b.hi2))::timestamp;
    v_fin_ts := (r_b.f + make_interval(hours => r_b.hf2))::timestamp;
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
      -- SUELO: primero quien mas lejos esta de su jornada contratada
      order by (coalesce(e.contracted_hours_week,40)
                - coalesce((v_horas->>e.id::text)::numeric,0)) desc, e.name
      limit 1
    loop
      o_fecha:=r_b.f; o_dow:=r_b.d; o_ini:=r_b.hi2; o_fin:=r_b.hf2; o_horas:=v_dur;
      o_capa:=r_b.nivel; o_employee_id:=r_c.id; o_employee:=r_c.name;
      o_hueco:=false;
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
      o_fecha:=r_b.f; o_dow:=r_b.d; o_ini:=r_b.hi2; o_fin:=r_b.hf2; o_horas:=v_dur;
      o_capa:=r_b.nivel; o_employee_id:=null; o_employee:=null; o_hueco:=true;
      o_motivo:='SIN CUBRIR — nadie de la plantilla puede sin incumplir';
      return next;
    end if;
  end loop;
end $function$;

DO $g$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='generate_week_schedule') THEN
    RAISE EXCEPTION 'generate_week_schedule no quedo'; END IF;
END $g$;

NOTIFY pgrst, 'reload schema';
