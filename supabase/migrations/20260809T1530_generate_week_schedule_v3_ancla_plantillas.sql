-- 20260809T1530_generate_week_schedule_v3_ancla_plantillas.sql
-- Aplicada: NO — propuesta, pendiente de que Julio la ejecute y verifique.
--
-- ENCARGO CODE F10 — Bloque A.4. Rediseño de generate_week_schedule (v2→v3).
-- Parte de la definición VIVA capturada por pg_get_functiondef el 09/08/2026
-- (después de la migración T0945, que ya está en producción) y la sustituye
-- entera porque el cambio de forma de salida (o_ini/o_fin pasan de hora
-- entera a texto "HH:MM", se añade o_shift_template_id) exige DROP + CREATE:
-- CREATE OR REPLACE no admite cambiar el tipo de las columnas de salida.
--
-- ⚠️ CAMBIO DE CONTRATO — leer antes de aplicar:
--   o_ini / o_fin dejan de ser "hora entera" (13, 17) y pasan a ser texto
--   "HH:MM" ("14:45", "00:15"). Se añade o_shift_template_id (uuid, null solo
--   en el bloque de refuerzo excepcional). ESTA MIGRACIÓN Y EL DEPLOY DEL
--   FRONTEND (scheduleProposalService.ts + CalendarioPage.tsx, mismo commit)
--   DEBEN IR JUNTOS. Si el SQL llega antes que el frontend nuevo, el botón
--   "Proponer cuadrante" viejo recibirá o_ini/o_fin como texto donde esperaba
--   número y las horas saldrán mal hasta que el frontend se despliegue. Si el
--   frontend nuevo llega antes que el SQL, el botón "Cubrir el resto" no
--   existe todavía en la BBDD y fallará con error de RPC hasta aplicar esto.
--
-- QUÉ CAMBIA respecto a v2 (hallazgos §1 del encargo, con su número):
--   #5 Local cerrado (locations.active=false) → 0 filas, nunca un cuadrante
--      en rojo. Guard al principio de la función.
--   #1 Ancla a shift_templates reales de kind='demanda' en vez de generar
--      bloques libres por hora entera. Cada plantilla se pondera por su USO
--      HISTÓRICO real en schedules.cells (últimos 90 días) para que, entre
--      gemelas sin depurar (F7.2, pendiente de Julio — Mañana vs Mañana1),
--      gane la que de verdad se usa, sin tener que borrar ni desactivar nada.
--   kind='forzado' se abre siempre que coverage_<dia> > 0 (parámetro 3).
--   kind='no_productivo' se coloca y suma horas pero no descuenta demanda
--      (parámetro 4).
--   #4 min_shift_minutes ya no es un ">= 1" hardcodeado: el ÚNICO bloque que
--      se genera fuera de plantilla (el refuerzo excepcional) se descarta y
--      se declara hueco directo si no llega al mínimo — nunca sale un turno
--      suelto por debajo.
--   #3 Tolerancia sobre contrato configurable (break_policy.contract_
--      tolerance_pct, 0 % por defecto = comportamiento previo exacto).
--   Dotación en el pico (team_labor_model.peak_weekday/peak_weekend, 0 por
--      defecto = sin efecto) y márgenes de apertura/cierre (pre_open_minutes/
--      post_close_minutes, 0 por defecto = sin efecto) — parámetros 1 y 4.
--   Reparto del excedente (§3.A.5): un turno largo (la plantilla 'demanda' de
--      mayor duración) por persona, colocado en uno de los v_n_emp días de
--      mayor demanda de la semana; un día "objetivo" de descanso por persona,
--      deprioritizado (no bloqueado) en el desempate. Ambos rotan semana a
--      semana por FÓRMULA (offset = nº de semana desde una fecha ancla fija),
--      no leyendo el cuadrante de la semana anterior — más simple y no
--      depende de que exista una semana previa guardada.
--
-- LÍMITES DECLARADOS DE ESTA VERSIÓN (decir la verdad, no maquillar):
--   - Equidad de fines de semana/cierres y "continuidad" (§3.A.5, puntos 3 y
--     4) NO están implementados — solo distancia al contrato como desempate
--     final, igual que v2. Declarado, no fingido.
--   - El ajuste por plantilla ('gain' del greedy) puntúa la cobertura SOLO
--     contra la demanda del mismo día natural: el tramo de un turno que cruza
--     medianoche (p.ej. Corrido1 hasta las 00:15) no puntúa contra la demanda
--     de la madrugada del día siguiente. Simplificación declarada — evita
--     llevar un libro de demanda entre días distintos.
--   - "Fin de semana" para peak_weekend = sábado y domingo (viernes cuenta
--     como entre semana). Ajustable si Julio quiere otra frontera.
--   - Si dos turnos abren (o cierran) exactamente a la misma hora, el margen
--     de apertura/cierre se aplica a los dos, no a uno solo.
--
-- MÉTODO: DROP + CREATE (no hay forma de conservar el body viejo con
-- CREATE OR REPLACE cuando cambia el tipo de columnas de salida). Idempotente
-- por construcción: reaplicar este fichero vuelve a dejar la función igual.

drop function if exists public.generate_week_schedule(uuid, uuid, date, text, numeric);

create function public.generate_week_schedule(
  p_account uuid,
  p_location uuid,
  p_week_start date,
  p_role text default 'cocina'::text,
  p_min_pct_dias numeric default 15.0
)
returns table(
  o_fecha date,
  o_dow integer,
  o_shift_template_id uuid,
  o_ini text,
  o_fin text,
  o_horas numeric,
  o_capa integer,
  o_employee_id uuid,
  o_employee text,
  o_hueco boolean,
  o_motivo text
)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- break_policy
  v_max_h numeric; v_min_h numeric; v_rest_min int; v_rest_12h int; v_split_gap int; v_tol_pct numeric;
  -- team_labor_model (parámetros 1 y 4)
  v_peak_wd int; v_peak_we int; v_pre_open int; v_post_close int;
  -- demanda y plantillas
  v_dem jsonb := '{}'::jsonb;
  v_templates jsonb := '[]'::jsonb;
  v_uso jsonb := '{}'::jsonb;
  v_day_total numeric[] := array_fill(0::numeric, array[7]);
  v_n_emp int := 1;
  v_long_tpl_id uuid; v_long_dur numeric;
  v_long_days int[] := array[]::int[];
  v_week_idx int;
  -- acumuladores del plan (mismo patrón que v2)
  v_horas jsonb := '{}'::jsonb;
  v_turnos jsonb := '{}'::jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
  v_long_assigned jsonb := '{}'::jsonb;
  -- por día
  d int;
  v_fecha date;
  v_day_orig jsonb;
  v_remaining jsonb;
  v_assign_day jsonb;
  v_min_ini int; v_max_fin int;
  v_peak_hour int; v_peak_count int;
  v_floor int;
  -- selección greedy de plantilla 'demanda'
  v_best_id text; v_best_gain numeric; v_best_ini int; v_best_fin int;
  v_iter int;
  -- refuerzo excepcional (racha más larga de horas con demanda sin cubrir)
  v_run_start int; v_run_end int; v_run_len int; v_cur_start int; v_cur_len int; h int;
  -- asignación por asiento
  r_a record; r_c record;
  v_ini_ts timestamp; v_fin_ts timestamp; v_dur numeric; v_found boolean;
  v_seat_is_long boolean; v_seat_motivo text; v_seat_capa int;
begin
  -- Hallazgo #5: local cerrado → cero filas, nunca un cuadrante en rojo.
  if not exists (select 1 from public.locations l where l.id = p_location and l.active) then
    return;
  end if;

  select coalesce(bp.max_daily_minutes_plan, bp.max_daily_minutes, 540)/60.0,
         coalesce(bp.min_shift_minutes,180)/60.0,
         coalesce(bp.weekly_rest_minutes,2160),
         coalesce(bp.min_rest_between_shifts_minutes,720),
         coalesce(bp.split_min_gap_minutes,90),
         coalesce(bp.contract_tolerance_pct,0)
    into v_max_h, v_min_h, v_rest_min, v_rest_12h, v_split_gap, v_tol_pct
  from public.break_policy bp
  where bp.account_id=p_account and (bp.location_id=p_location or bp.location_id is null)
  order by bp.location_id nulls last limit 1;
  v_max_h:=coalesce(v_max_h,9); v_min_h:=coalesce(v_min_h,3);
  v_rest_min:=coalesce(v_rest_min,2160); v_rest_12h:=coalesce(v_rest_12h,720);
  v_split_gap:=coalesce(v_split_gap,90); v_tol_pct:=coalesce(v_tol_pct,0);

  select coalesce(tlm.peak_weekday,0), coalesce(tlm.peak_weekend,0),
         coalesce(tlm.pre_open_minutes,0), coalesce(tlm.post_close_minutes,0)
    into v_peak_wd, v_peak_we, v_pre_open, v_post_close
  from public.team_labor_model tlm
  where tlm.account_id=p_account and tlm.role_kind=p_role and tlm.active
    and (tlm.location_id=p_location or tlm.location_id is null)
  order by tlm.location_id nulls last limit 1;
  v_peak_wd:=coalesce(v_peak_wd,0); v_peak_we:=coalesce(v_peak_we,0);
  v_pre_open:=coalesce(v_pre_open,0); v_post_close:=coalesce(v_post_close,0);

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

  -- Uso histórico real por plantilla (últimos 90 días de schedules.cells de
  -- este local) — desempata entre gemelas sin depurar (F7.2) sin borrar nada.
  select coalesce(jsonb_object_agg(k.tid, k.uso), '{}'::jsonb) into v_uso
  from (
    select k.tid, count(distinct s.week_start) as uso
    from public.schedules s
    cross join lateral jsonb_object_keys(s.cells) as k(tid)
    where s.location_id = p_location
      and s.week_start >= (p_week_start - interval '90 days')::date
      and s.week_start < p_week_start
    group by k.tid
  ) k;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', st.id::text,
      'kind', st.kind,
      'ini_min', (extract(hour from st.start_time)::int*60 + extract(minute from st.start_time)::int),
      'fin_min', case when st.end_time <= st.start_time
                      then (extract(hour from st.end_time)::int*60 + extract(minute from st.end_time)::int) + 1440
                      else (extract(hour from st.end_time)::int*60 + extract(minute from st.end_time)::int) end,
      'cov_mon', st.coverage_mon, 'cov_tue', st.coverage_tue, 'cov_wed', st.coverage_wed,
      'cov_thu', st.coverage_thu, 'cov_fri', st.coverage_fri, 'cov_sat', st.coverage_sat, 'cov_sun', st.coverage_sun,
      'uso', coalesce((v_uso->>st.id::text)::int, 0)
    ) order by st.start_time), '[]'::jsonb)
  into v_templates
  from public.shift_templates st
  where st.location_id = p_location and st.active;

  select count(*) into v_n_emp
  from public.employees e
  where e.account_id=p_account and e.active
    and (e.location_id=p_location
         or (e.assigned_locations is not null
             and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)));
  v_n_emp := greatest(coalesce(v_n_emp,0), 1);

  for d in 0..6 loop
    select coalesce(sum(t.v::numeric),0) into v_day_total[d+1]
    from jsonb_each_text(v_dem) t(k,v)
    where split_part(t.k,'|',1) = (p_week_start + d)::text;
  end loop;

  select (t->>'id')::uuid, ((t->>'fin_min')::int-(t->>'ini_min')::int)/60.0
    into v_long_tpl_id, v_long_dur
  from jsonb_array_elements(v_templates) t
  where t->>'kind'='demanda'
  order by ((t->>'fin_min')::int-(t->>'ini_min')::int) desc
  limit 1;

  if v_long_tpl_id is not null then
    select array_agg(x.d order by x.tot desc, x.d asc) into v_long_days
    from (
      select gs.d, v_day_total[gs.d+1] as tot
      from generate_series(0,6) gs(d)
      where v_day_total[gs.d+1] > 0
      order by v_day_total[gs.d+1] desc, gs.d asc
      limit v_n_emp
    ) x(d,tot);
  end if;
  v_long_days := coalesce(v_long_days, array[]::int[]);

  v_week_idx := (p_week_start - date '2024-01-01')::int / 7;

  for d in 0..6 loop
    v_fecha := p_week_start + d;

    select coalesce(jsonb_object_agg(t.k2, t.v), '{}'::jsonb) into v_day_orig
    from (
      select split_part(t.k,'|',2) as k2, t.v
      from jsonb_each_text(v_dem) t(k,v)
      where split_part(t.k,'|',1) = v_fecha::text
    ) t;
    v_remaining := v_day_orig;
    v_assign_day := '[]'::jsonb;

    -- kind='forzado': se abre siempre que coverage_<dia> > 0 (parámetro 3).
    for r_a in
      select t->>'id' as id, (t->>'ini_min')::int as ini_min, (t->>'fin_min')::int as fin_min,
             (case d
                when 0 then (t->>'cov_mon')::int when 1 then (t->>'cov_tue')::int
                when 2 then (t->>'cov_wed')::int when 3 then (t->>'cov_thu')::int
                when 4 then (t->>'cov_fri')::int when 5 then (t->>'cov_sat')::int
                else (t->>'cov_sun')::int end) as necesita
      from jsonb_array_elements(v_templates) t
      where t->>'kind' = 'forzado'
    loop
      if r_a.necesita > 0 then
        for v_iter in 1..r_a.necesita loop
          v_assign_day := v_assign_day || jsonb_build_object(
            'tpl_id', r_a.id, 'kind', 'forzado', 'ini_min', r_a.ini_min, 'fin_min', r_a.fin_min);
          select coalesce(jsonb_object_agg(k.k, greatest(0, k.v::numeric -
                   case when r_a.ini_min < (k.k::int+1)*60 and least(r_a.fin_min,1440) > k.k::int*60
                        then 1 else 0 end)), '{}'::jsonb)
            into v_remaining
          from jsonb_each_text(v_remaining) k(k,v);
        end loop;
      end if;
    end loop;

    -- kind='no_productivo': se coloca, suma horas, NO descuenta demanda (parámetro 4).
    for r_a in
      select t->>'id' as id, (t->>'ini_min')::int as ini_min, (t->>'fin_min')::int as fin_min,
             (case d
                when 0 then (t->>'cov_mon')::int when 1 then (t->>'cov_tue')::int
                when 2 then (t->>'cov_wed')::int when 3 then (t->>'cov_thu')::int
                when 4 then (t->>'cov_fri')::int when 5 then (t->>'cov_sat')::int
                else (t->>'cov_sun')::int end) as necesita
      from jsonb_array_elements(v_templates) t
      where t->>'kind' = 'no_productivo'
    loop
      if r_a.necesita > 0 then
        for v_iter in 1..r_a.necesita loop
          v_assign_day := v_assign_day || jsonb_build_object(
            'tpl_id', r_a.id, 'kind', 'no_productivo', 'ini_min', r_a.ini_min, 'fin_min', r_a.fin_min);
        end loop;
      end if;
    end loop;

    -- kind='demanda': greedy set-cover — en cada vuelta, la plantilla que más
    -- horas nuevas cubre; desempata por uso histórico (desc), duración (asc,
    -- evita sobredotar) y hora de inicio (asc, determinismo).
    for v_iter in 1..20 loop
      select x.id, x.gain, x.ini_min, x.fin_min
        into v_best_id, v_best_gain, v_best_ini, v_best_fin
      from (
        select t->>'id' as id,
               sum(case when (t->>'ini_min')::int < (h.hour+1)*60
                         and least((t->>'fin_min')::int,1440) > h.hour*60
                         and coalesce((v_remaining->>h.hour::text)::numeric,0) > 0
                        then 1 else 0 end) as gain,
               coalesce((t->>'uso')::int,0) as uso,
               ((t->>'fin_min')::int-(t->>'ini_min')::int)/60.0 as dur_h,
               (t->>'ini_min')::int as ini_min,
               (t->>'fin_min')::int as fin_min
        from jsonb_array_elements(v_templates) t
        cross join generate_series(0,23) h(hour)
        where t->>'kind' = 'demanda'
        group by t->>'id', t->>'uso', t->>'ini_min', t->>'fin_min'
      ) x
      order by x.gain desc, x.uso desc, x.dur_h asc, x.ini_min asc
      limit 1;

      exit when v_best_id is null or coalesce(v_best_gain,0) <= 0;

      v_assign_day := v_assign_day || jsonb_build_object(
        'tpl_id', v_best_id, 'kind', 'demanda', 'ini_min', v_best_ini, 'fin_min', v_best_fin);
      select coalesce(jsonb_object_agg(k.k, greatest(0, k.v::numeric -
               case when v_best_ini < (k.k::int+1)*60 and least(v_best_fin,1440) > k.k::int*60
                    then 1 else 0 end)), '{}'::jsonb)
        into v_remaining
      from jsonb_each_text(v_remaining) k(k,v);
    end loop;

    -- Turno largo del día pico (§3.A.5.2): si hoy es uno de los v_n_emp días
    -- de mayor demanda de la semana, garantiza un asiento de la plantilla
    -- 'demanda' más larga aunque la curva ya esté cubierta.
    if v_long_tpl_id is not null and d = any(v_long_days) then
      if not exists (
        select 1 from jsonb_array_elements(v_assign_day) a
        where a->>'tpl_id' = v_long_tpl_id::text
      ) then
        select (t->>'ini_min')::int, (t->>'fin_min')::int into v_best_ini, v_best_fin
        from jsonb_array_elements(v_templates) t
        where t->>'id' = v_long_tpl_id::text limit 1;
        v_assign_day := v_assign_day || jsonb_build_object(
          'tpl_id', v_long_tpl_id::text, 'kind', 'demanda_largo', 'ini_min', v_best_ini, 'fin_min', v_best_fin);
        select coalesce(jsonb_object_agg(k.k, greatest(0, k.v::numeric -
                 case when v_best_ini < (k.k::int+1)*60 and least(v_best_fin,1440) > k.k::int*60
                      then 1 else 0 end)), '{}'::jsonb)
          into v_remaining
        from jsonb_each_text(v_remaining) k(k,v);
      end if;
    end if;

    -- Dotación mínima en el pico (parámetro 1). 0/NULL = sin efecto.
    v_floor := case when d in (5,6) then v_peak_we else v_peak_wd end;
    if coalesce(v_floor,0) > 0 then
      select k.k::int into v_peak_hour
      from jsonb_each_text(v_day_orig) k(k,v)
      order by k.v::numeric desc, k.k::int asc
      limit 1;
      if v_peak_hour is not null then
        select count(*) into v_peak_count
        from jsonb_array_elements(v_assign_day) a
        where (a->>'ini_min')::int < (v_peak_hour+1)*60
          and least((a->>'fin_min')::int,1440) > v_peak_hour*60;
        v_iter := 0;
        while coalesce(v_peak_count,0) < v_floor and v_iter < 6 loop
          v_iter := v_iter + 1;
          select t->>'id', (t->>'ini_min')::int, (t->>'fin_min')::int
            into v_best_id, v_best_ini, v_best_fin
          from jsonb_array_elements(v_templates) t
          where t->>'kind' = 'demanda'
            and (t->>'ini_min')::int < (v_peak_hour+1)*60
            and least((t->>'fin_min')::int,1440) > v_peak_hour*60
          order by coalesce((t->>'uso')::int,0) desc,
                   ((t->>'fin_min')::int-(t->>'ini_min')::int) asc
          limit 1;
          exit when v_best_id is null;
          v_assign_day := v_assign_day || jsonb_build_object(
            'tpl_id', v_best_id, 'kind', 'demanda_pico', 'ini_min', v_best_ini, 'fin_min', v_best_fin);
          select coalesce(jsonb_object_agg(k.k, greatest(0, k.v::numeric -
                   case when v_best_ini < (k.k::int+1)*60 and least(v_best_fin,1440) > k.k::int*60
                        then 1 else 0 end)), '{}'::jsonb)
            into v_remaining
          from jsonb_each_text(v_remaining) k(k,v);
          v_peak_count := v_peak_count + 1;
        end loop;
      end if;
    end if;

    -- Refuerzo excepcional: como mucho UN bloque dinámico, cuadrado a horas
    -- completas (la demanda ya viene por hora). Se descarta si no llega a
    -- min_shift_minutes — nunca un turno suelto por debajo del mínimo.
    v_run_start := null; v_run_end := null; v_cur_start := null; v_cur_len := 0; v_run_len := 0;
    for h in 0..23 loop
      if coalesce((v_remaining->>h::text)::numeric,0) > 0 then
        if v_cur_start is null then v_cur_start := h; v_cur_len := 1;
        else v_cur_len := v_cur_len + 1; end if;
        if v_cur_len > v_run_len then
          v_run_len := v_cur_len; v_run_start := v_cur_start; v_run_end := h+1;
        end if;
      else
        v_cur_start := null; v_cur_len := 0;
      end if;
    end loop;

    if v_run_start is not null and (v_run_end - v_run_start) >= v_min_h then
      v_assign_day := v_assign_day || jsonb_build_object(
        'tpl_id', null, 'kind', 'refuerzo', 'ini_min', v_run_start*60, 'fin_min', v_run_end*60);
      select coalesce(jsonb_object_agg(k.k, greatest(0, k.v::numeric -
               case when v_run_start*60 < (k.k::int+1)*60 and v_run_end*60 > k.k::int*60
                    then 1 else 0 end)), '{}'::jsonb)
        into v_remaining
      from jsonb_each_text(v_remaining) k(k,v);
    end if;

    -- Lo que siga con remaining > 0 (incluida la racha descartada por corta)
    -- se declara hueco directo: nunca se intenta cubrir con nadie.
    for r_a in
      select k.k::int as hora
      from jsonb_each_text(v_remaining) k(k,v)
      where k.v::numeric > 0
      order by k.k::int
    loop
      v_gaps := v_gaps || jsonb_build_object(
        'f', v_fecha, 'ini', r_a.hora*60, 'fin', (r_a.hora+1)*60, 'tpl', null,
        'motivo', 'Demanda residual (menos de ' || round(v_min_h,1) || ' h) sin cubrir — no se abre un turno suelto por debajo del mínimo');
    end loop;

    -- Márgenes de apertura/cierre (parámetro 4). 0/NULL = sin efecto.
    if jsonb_array_length(v_assign_day) > 0 then
      select min((a->>'ini_min')::int), max((a->>'fin_min')::int)
        into v_min_ini, v_max_fin
      from jsonb_array_elements(v_assign_day) a;
      if coalesce(v_pre_open,0) > 0 then
        select coalesce(jsonb_agg(
                 case when (a->>'ini_min')::int = v_min_ini
                      then jsonb_set(a, '{ini_min}', to_jsonb(greatest(0,(a->>'ini_min')::int - v_pre_open)))
                      else a end),
               '[]'::jsonb)
          into v_assign_day
        from jsonb_array_elements(v_assign_day) a;
      end if;
      if coalesce(v_post_close,0) > 0 then
        select coalesce(jsonb_agg(
                 case when (a->>'fin_min')::int = v_max_fin
                      then jsonb_set(a, '{fin_min}', to_jsonb((a->>'fin_min')::int + v_post_close))
                      else a end),
               '[]'::jsonb)
          into v_assign_day
        from jsonb_array_elements(v_assign_day) a;
      end if;
    end if;

    -- Asignar empleado a cada asiento del día, en el orden en que se generó
    -- (forzado/no_productivo primero, curva de demanda, turno largo, pico,
    -- refuerzo al final).
    for r_a in
      select a->>'tpl_id' as tpl_id, a->>'kind' as kind,
             (a->>'ini_min')::int as ini_min, (a->>'fin_min')::int as fin_min
      from jsonb_array_elements(v_assign_day) a
    loop
      v_ini_ts := v_fecha::timestamp + make_interval(mins => r_a.ini_min);
      v_fin_ts := v_fecha::timestamp + make_interval(mins => r_a.fin_min);
      v_dur := (r_a.fin_min - r_a.ini_min) / 60.0;
      v_seat_is_long := (r_a.kind = 'demanda_largo');
      v_found := false;

      for r_c in
        with cand as (
          select e.id, e.name, coalesce(e.contracted_hours_week,40) ctr,
                 coalesce((v_horas->>e.id::text)::numeric,0) ya,
                 (select coalesce(sum(extract(epoch from ((t->>1)::timestamp-(t->>0)::timestamp))/3600),0)
                    from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                   where (t->>0)::timestamp::date = v_fecha) h_dia,
                 (select count(*) from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                   where (t->>0)::timestamp::date = v_fecha) n_dia,
                 (select min(greatest(extract(epoch from (v_ini_ts-(t->>1)::timestamp))/60,
                                      extract(epoch from ((t->>0)::timestamp-v_fin_ts))/60))
                    from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                   where (t->>0)::timestamp::date = v_fecha) gap_min,
                 exists (select 1 from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                          where (t->>0)::timestamp < v_fin_ts and (t->>1)::timestamp > v_ini_ts) solapa,
                 exists (select 1 from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                          where (t->>0)::timestamp::date <> v_fecha
                            and ( ((t->>1)::timestamp <= v_ini_ts
                                   and v_ini_ts < (t->>1)::timestamp + make_interval(mins=>v_rest_12h))
                               or (v_fin_ts <= (t->>0)::timestamp
                                   and (t->>0)::timestamp < v_fin_ts + make_interval(mins=>v_rest_12h)) )
                 ) viola_12h,
                 row_number() over (order by e.name) as rnk,
                 coalesce((v_long_assigned->>e.id::text)::boolean,false) as had_long
          from public.employees e
          where e.account_id=p_account and e.active
            and (e.location_id=p_location
                 or (e.assigned_locations is not null
                     and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
            and not exists (select 1 from public.vacations v
                            where v.employee_id=e.id and v.status='aprobada'
                              and v_fecha between v.start_date and v.end_date)
        ),
        cand2 as (
          select c.*,
                 (d = ((c.rnk - 1 + v_week_idx) % 7)) as is_target_off,
                 (array_length(v_long_days,1) > 0
                  and d = v_long_days[1 + ((c.rnk - 1 + v_week_idx) % array_length(v_long_days,1))]) as is_target_long
          from cand c
        )
        select c.id, c.name, c.ctr, c.ya, c.n_dia from cand2 c
        where not c.solapa and not c.viola_12h
          and c.ya + v_dur <= c.ctr * (1 + v_tol_pct/100.0)
          and c.h_dia + v_dur <= v_max_h
          and (c.n_dia = 0 or c.gap_min = 0 or c.gap_min >= v_split_gap)
          and public.has_weekly_rest(coalesce(v_turnos->c.id::text,'[]'::jsonb),
                v_ini_ts, v_fin_ts, p_week_start, v_rest_min)
        order by
          (v_seat_is_long and c.is_target_long) desc,
          (v_seat_is_long and c.had_long) asc,
          c.is_target_off asc,
          (c.n_dia > 0) desc,
          (c.ctr - c.ya) desc,
          c.name
        limit 1
      loop
        v_seat_motivo := case r_a.kind
          when 'forzado' then 'Franja forzada'
          when 'no_productivo' then 'Bloque fijo no productivo'
          when 'demanda_largo' then 'Turno largo · día de mayor demanda'
          when 'demanda_pico' then 'Dotación mínima en el pico'
          when 'refuerzo' then 'Refuerzo excepcional · demanda residual'
          else 'Demanda prevista'
        end;
        v_seat_capa := case r_a.kind
          when 'demanda_largo' then 2 when 'demanda_pico' then 3
          when 'refuerzo' then 4 else 1 end;
        v_plan := v_plan || jsonb_build_object(
          'f', v_fecha, 'ini', r_a.ini_min, 'fin', r_a.fin_min, 'tpl', r_a.tpl_id,
          'capa', v_seat_capa, 'emp', r_c.id, 'nom', r_c.name, 'motivo', v_seat_motivo);
        v_horas := jsonb_set(v_horas, array[r_c.id::text], to_jsonb(r_c.ya + v_dur));
        v_turnos := jsonb_set(v_turnos, array[r_c.id::text],
                     coalesce(v_turnos->r_c.id::text,'[]'::jsonb)
                     || jsonb_build_array(jsonb_build_array(
                          to_char(v_ini_ts,'YYYY-MM-DD"T"HH24:MI:SS'),
                          to_char(v_fin_ts,'YYYY-MM-DD"T"HH24:MI:SS'))));
        if v_seat_is_long then
          v_long_assigned := jsonb_set(v_long_assigned, array[r_c.id::text], to_jsonb(true));
        end if;
        v_found := true;
      end loop;

      if not v_found then
        v_gaps := v_gaps || jsonb_build_object(
          'f', v_fecha, 'ini', r_a.ini_min, 'fin', r_a.fin_min, 'tpl', r_a.tpl_id,
          'motivo', 'SIN CUBRIR — nadie puede sin incumplir convenio');
      end if;
    end loop;

  end loop;

  return query
  select (x->>'f')::date,
         extract(isodow from (x->>'f')::date)::int - 1,
         (x->>'tpl')::uuid,
         to_char((x->>'f')::date::timestamp + make_interval(mins => (x->>'ini')::int), 'HH24:MI'),
         to_char((x->>'f')::date::timestamp + make_interval(mins => (x->>'fin')::int), 'HH24:MI'),
         (((x->>'fin')::int - (x->>'ini')::int)/60.0)::numeric,
         (x->>'capa')::int,
         (x->>'emp')::uuid, x->>'nom', false, x->>'motivo'
  from jsonb_array_elements(v_plan) x
  union all
  select (x->>'f')::date,
         extract(isodow from (x->>'f')::date)::int - 1,
         (x->>'tpl')::uuid,
         to_char((x->>'f')::date::timestamp + make_interval(mins => (x->>'ini')::int), 'HH24:MI'),
         to_char((x->>'f')::date::timestamp + make_interval(mins => (x->>'fin')::int), 'HH24:MI'),
         (((x->>'fin')::int - (x->>'ini')::int)/60.0)::numeric,
         null::int,
         null::uuid, null::text, true, x->>'motivo'
  from jsonb_array_elements(v_gaps) x
  order by 1, 4;
end
$function$;

comment on function public.generate_week_schedule(uuid, uuid, date, text, numeric) is
  'ENCARGO F10 v3, 09/08/2026. Ancla la propuesta a shift_templates reales (kind=demanda/forzado/no_productivo), pondera duplicadas sin depurar por uso histórico, respeta min_shift_minutes, tolerancia de contrato y dotación de pico configurables, refuerzo excepcional único cuadrado a hora completa. Límites declarados: sin equidad de cierres/continuidad, sin libro de demanda entre días al cruzar medianoche — ver cabecera de la migración.';

-- Guard: aborta si la función no quedó con la forma nueva (columnas, no el
-- cuerpo viejo con o_ini/o_fin como hora entera).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prokind='f' and p.proname='generate_week_schedule';
  if v_def is null then
    raise exception 'FALLO: generate_week_schedule no existe tras la migracion';
  end if;
  if position('o_shift_template_id' in v_def) = 0 then
    raise exception 'FALLO: generate_week_schedule no tiene o_shift_template_id — quedo la forma vieja';
  end if;
  if position('locations l where l.id = p_location and l.active' in v_def) = 0 then
    raise exception 'FALLO: generate_week_schedule no filtra local cerrado';
  end if;
end $$;

notify pgrst, 'reload schema';
