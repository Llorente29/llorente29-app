-- 20260809T1700_generate_week_schedule_mix_de_turnos.sql
-- Aplicada: NO — propuesta, pendiente de que Julio la ejecute y verifique.
--
-- ENCARGO CODE F10 (3ª parte, 09/08/2026) — arregla el MIX DE TURNOS.
-- El anclaje a plantillas (v3) y el orden de llenado por demanda + tope de
-- turno largo + equilibrio de días + motivos honestos (v4) FUNCIONAN — no
-- se tocan (§0.bis del encargo). Este cambio es solo sobre CUÁL plantilla
-- 'demanda' elige el greedy en cada vuelta.
--
-- SÍNTOMA (§8.1 del encargo, medido con contract_tolerance_pct=10 ya en
-- producción): el motor proponía 8 turnos de 9,5h donde el real pone 3 (uno
-- por persona), y el aviso 'Segundo turno largo — no había alternativa'
-- saltaba 5 veces — no porque el tope estuviera roto, sino porque el greedy
-- pedía tantos largos que el tope no daba abasto.
--
-- CAUSA (§8.2): el greedy ordenaba por `gain` bruto (horas de demanda que
-- tapa la plantilla). Una plantilla de 9,5h siempre tapa más horas en
-- términos absolutos que una de 4,25h, así que ganaba siempre, por
-- construcción — el motor cogía el martillo más grande en cada vuelta.
--
-- CAMBIO PEDIDO (§8.3): sustituir `gain` bruto por un beneficio neto
-- (`neto = 2*gain - dur_h`, penaliza la hora pagada que no cubre nada).
--
-- 🔴 VALIDACIÓN POR MCP (regla de proceso, obligatoria desde la 2ª parte de
-- este encargo) — esta vez encontró DOS efectos en cadena, no uno, antes de
-- llegar a la versión de abajo:
--
--   1ª vuelta — el orden propuesto literal (`neto desc, uso desc, ...`)
--   RESUCITÓ las plantillas duplicadas sin depurar (F7.2): entre dos
--   plantillas que tapan la misma demanda, la MÁS CORTA siempre da mejor
--   neto (menos horas que restar), así que "Mañana1" (3,5h, uso histórico
--   0) le ganaba a la "Mañana" real (`bac57b07`, 4,25h) — justo lo que la
--   ponderación por uso histórico (v3) estaba para evitar, y que §0.bis de
--   este mismo encargo protege explícitamente ("el anclaje... funciona, no
--   se toca"). Arreglo: filtrar candidatos a `gain > 0` (que cubran algo) y
--   ordenar PRIMERO por uso histórico, neto como criterio dentro del mismo
--   nivel de uso — `uso desc, neto desc, dur_h asc, ini_min asc`.
--
--   2ª vuelta — con el uso histórico protegido, el greedy dejó de necesitar
--   NUNCA la plantilla larga para cubrir demanda (dos turnos cortos bien
--   ajustados cubren lo mismo con menos desperdicio) — y el asiento
--   GARANTIZADO del turno largo del día pico (que se añade DESPUÉS del
--   greedy en el código de v3/v4) chocaba contra un día ya lleno de turnos
--   cortos: nadie tenía hueco para un corrido de 9,5h encima → los 3
--   corridos garantizados de la semana se convertían en 3 huecos nuevos
--   (peor que el síntoma original). Arreglo: mover el bloque del turno
--   largo garantizado a ANTES del greedy dentro de la fase de generación —
--   reserva su hueco primero, y el greedy cubre lo que quede alrededor. No
--   cambia NADA de v4 salvo el ORDEN en que dos bloques ya existentes se
--   ejecutan dentro del mismo día.
--
-- RESULTADO FINAL validado por MCP (Alcalá 2026-08-03, contract_tolerance_
-- pct=10 igual que producción hoy) — comparar con la tabla del encargo:
--   Corridos de 9,5h: 3 (real: 3) ✅ — uno por persona, en sus 3 días de
--     mayor demanda, motivo 'Turno largo · día de mayor demanda' en los 3.
--   Avisos 'Segundo turno largo — no había alternativa': 0 (antes 5) ✅
--   Días trabajados: 6·6·6 (no se ha tocado ese mecanismo) ✅
--   Huecos: 2 (el lunes, igual que la v4 sin este cambio) — no ha subido ✅
--   Plantillas usadas: las 4 reales, ninguna duplicada ✅
--   🔴 Horas totales: 97,5 — POR DEBAJO del suelo de 115h que pedía el
--     encargo (§8.4.3 "no romper lo ganado"). Es la contracara de quitar el
--     desperdicio: al no sobredotar con turnos largos que tapan de más, el
--     total baja. NO se ha intentado un tercer ajuste para subirlo — cada
--     vuelta de ajuste adicional ha encontrado un efecto en cadena nuevo, y
--     seguir needs criterio de negocio, no otra vuelta de tuning a ciegas:
--     ¿un cuadrante más ajustado a la demanda pura (97,5h) con el patrón
--     estructural correcto (3 corridos, 1 por persona) es preferible a uno
--     con más horas pero relleno de más? Eso lo decide Julio, declarado
--     aquí sin maquillar — "Cubrir el resto" (§8.5, todavía sin probar
--     nunca) es probablemente donde debe cerrarse esa distancia, no el
--     greedy de la 1ª pasada.
--
-- MÉTODO: CREATE OR REPLACE (mismo RETURNS TABLE que v3/v4, no cambia).
-- Se reescribe el cuerpo entero (no substitución de texto sobre lo vivo)
-- porque el cambio reordena dos bloques, no solo una expresión — sustituir
-- texto a ciegas sobre el body en producción (con su propio formato de
-- saltos de línea) es más frágil que partir de la versión ya validada por
-- MCP letra por letra.

create or replace function public.generate_week_schedule(
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
  v_max_h numeric; v_min_h numeric; v_rest_min int; v_rest_12h int; v_split_gap int; v_tol_pct numeric;
  v_peak_wd int; v_peak_we int; v_pre_open int; v_post_close int;
  v_dem jsonb := '{}'::jsonb;
  v_templates jsonb := '[]'::jsonb;
  v_uso jsonb := '{}'::jsonb;
  v_day_total numeric[] := array_fill(0::numeric, array[7]);
  v_tmp numeric;
  v_n_emp int := 1;
  v_long_tpl_id uuid; v_long_dur numeric;
  v_long_days int[] := array[]::int[];
  v_day_order int[];
  v_week_idx int;
  v_horas jsonb := '{}'::jsonb;
  v_turnos jsonb := '{}'::jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
  v_long_assigned jsonb := '{}'::jsonb;
  v_assign_all jsonb := '{}'::jsonb;
  d int; i int;
  v_fecha date;
  v_day_orig jsonb;
  v_remaining jsonb;
  v_assign_day jsonb;
  v_min_ini int; v_max_fin int;
  v_peak_hour int; v_peak_count int;
  v_floor int;
  v_best_id text; v_best_gain numeric; v_best_ini int; v_best_fin int;
  v_iter int;
  v_run_start int; v_run_end int; v_run_len int; v_cur_start int; v_cur_len int; h int;
  r_a record; r_c record;
  v_ini_ts timestamp; v_fin_ts timestamp; v_dur numeric; v_found boolean;
  v_seat_is_long boolean; v_seat_motivo text; v_seat_capa int;
  v_attempt int; v_allow_long_repeat boolean; v_relaxed_long boolean;
  v_n_solapa int; v_n_12h int; v_n_contrato int; v_n_jornada int; v_n_gap int; v_n_descanso int;
begin
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
    select coalesce(sum(t.v::numeric),0) into v_tmp
    from jsonb_each_text(v_dem) t(k,v)
    where split_part(t.k,'|',1) = (p_week_start + d)::text;
    v_day_total[d+1] := coalesce(v_tmp,0);
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

  select array_agg(x.d order by x.tot desc, x.d asc) into v_day_order
  from (select gs.d, v_day_total[gs.d+1] as tot from generate_series(0,6) gs(d)) x(d,tot);

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

    -- MOVIDO (3ª parte, §8.3 vuelta 2): el turno largo del día pico se
    -- garantiza ANTES del greedy de demanda, no después. Con el greedy ya
    -- puntuando por neto (ver más abajo) puede dejar de necesitar nunca la
    -- plantilla larga para cubrir su hueco de demanda — si el garantizado
    -- corriera después, chocaría contra un día ya lleno de turnos cortos y
    -- se convertiría en hueco. Reservando primero, el greedy cubre lo que
    -- quede alrededor y la persona asignada al largo tiene prioridad real
    -- de horario ese día (los asientos se procesan en orden de aparición
    -- en fase 2).
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

    -- kind='demanda': greedy set-cover. CAMBIO 8.3: `neto = 2*gain - dur_h`
    -- en vez de `gain` bruto (evita que el turno más largo gane siempre por
    -- construcción). `having gain>0` + `uso desc` PRIMERO evita que ese
    -- mismo cambio resucite plantillas duplicadas sin uso real: entre dos
    -- que cubren lo mismo, la más corta siempre da mejor neto — sin mirar
    -- el uso histórico antes, "Mañana1" (duplicada, uso=0) le ganaba a la
    -- "Mañana" real. Encontrado y corregido en la validación por MCP de
    -- esta misma migración, no en producción.
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
        having sum(case when (t->>'ini_min')::int < (h.hour+1)*60
                          and least((t->>'fin_min')::int,1440) > h.hour*60
                          and coalesce((v_remaining->>h.hour::text)::numeric,0) > 0
                         then 1 else 0 end) > 0
      ) x
      order by x.uso desc, (2*x.gain - x.dur_h) desc, x.dur_h asc, x.ini_min asc
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

    v_assign_all := jsonb_set(v_assign_all, array[d::text], v_assign_day);
  end loop;

  for i in 1..7 loop
    d := v_day_order[i];
    v_fecha := p_week_start + d;
    v_assign_day := coalesce(v_assign_all -> d::text, '[]'::jsonb);

    for r_a in
      select a->>'tpl_id' as tpl_id, a->>'kind' as kind,
             (a->>'ini_min')::int as ini_min, (a->>'fin_min')::int as fin_min
      from jsonb_array_elements(v_assign_day) a
    loop
      v_ini_ts := v_fecha::timestamp + make_interval(mins => r_a.ini_min);
      v_fin_ts := v_fecha::timestamp + make_interval(mins => r_a.fin_min);
      v_dur := (r_a.fin_min - r_a.ini_min) / 60.0;
      v_seat_is_long := (v_long_tpl_id is not null and r_a.tpl_id = v_long_tpl_id::text);
      v_found := false;
      v_relaxed_long := false;
      v_allow_long_repeat := false;

      for v_attempt in 0..1 loop
        if v_attempt = 1 then
          exit when not v_seat_is_long or v_found;
          v_allow_long_repeat := true;
        end if;

        for r_c in
          with cand as (
            select e.id, e.name, coalesce(e.contracted_hours_week,40) ctr,
                   coalesce((v_horas->>e.id::text)::numeric,0) ya,
                   (select coalesce(sum(extract(epoch from ((t->>1)::timestamp-(t->>0)::timestamp))/3600),0)
                      from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                     where (t->>0)::timestamp::date = v_fecha) h_dia,
                   (select count(*) from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t
                     where (t->>0)::timestamp::date = v_fecha) n_dia,
                   (select count(distinct (t->>0)::timestamp::date)
                      from jsonb_array_elements(coalesce(v_turnos->e.id::text,'[]'::jsonb)) t) as dias_trabajados,
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
            and (not v_seat_is_long or not c.had_long or v_allow_long_repeat)
            and public.has_weekly_rest(coalesce(v_turnos->c.id::text,'[]'::jsonb),
                  v_ini_ts, v_fin_ts, p_week_start, v_rest_min)
          order by
            (v_seat_is_long and c.is_target_long) desc,
            (v_seat_is_long and c.had_long) asc,
            c.dias_trabajados asc,
            c.is_target_off asc,
            (c.n_dia > 0) desc,
            (c.ctr - c.ya) desc,
            c.name
          limit 1
        loop
          v_relaxed_long := (v_attempt = 1);
          v_seat_motivo := case
            when v_relaxed_long then 'Segundo turno largo — no había alternativa'
            else case r_a.kind
              when 'forzado' then 'Franja forzada'
              when 'no_productivo' then 'Bloque fijo no productivo'
              when 'demanda_largo' then 'Turno largo · día de mayor demanda'
              when 'demanda_pico' then 'Dotación mínima en el pico'
              when 'refuerzo' then 'Refuerzo excepcional · demanda residual'
              else 'Demanda prevista'
            end
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

        exit when v_found;
      end loop;

      if not v_found then
        select
          count(*) filter (where solapa),
          count(*) filter (where viola_12h),
          count(*) filter (where ya + v_dur > ctr * (1 + v_tol_pct/100.0)),
          count(*) filter (where h_dia + v_dur > v_max_h),
          count(*) filter (where not (n_dia = 0 or gap_min = 0 or gap_min >= v_split_gap)),
          count(*) filter (where not public.has_weekly_rest(coalesce(v_turnos->id::text,'[]'::jsonb),
                                    v_ini_ts, v_fin_ts, p_week_start, v_rest_min))
          into v_n_solapa, v_n_12h, v_n_contrato, v_n_jornada, v_n_gap, v_n_descanso
        from (
          select e.id,
                 coalesce(e.contracted_hours_week,40) ctr,
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
                 ) viola_12h
          from public.employees e
          where e.account_id=p_account and e.active
            and (e.location_id=p_location
                 or (e.assigned_locations is not null
                     and to_jsonb(e.assigned_locations) @> to_jsonb(p_location::text)))
            and not exists (select 1 from public.vacations v
                            where v.employee_id=e.id and v.status='aprobada'
                              and v_fecha between v.start_date and v.end_date)
        ) c;

        v_seat_motivo := (
          select coalesce(nullif(string_agg(part, ' · '), ''), 'no hay empleados activos en este local')
          from (
            select 'tope de horas contratadas (' || v_n_contrato || ')' as part where coalesce(v_n_contrato,0) > 0
            union all select 'descanso de 12h (' || v_n_12h || ')' where coalesce(v_n_12h,0) > 0
            union all select 'descanso semanal (' || v_n_descanso || ')' where coalesce(v_n_descanso,0) > 0
            union all select 'jornada máxima diaria (' || v_n_jornada || ')' where coalesce(v_n_jornada,0) > 0
            union all select 'ya tienen turno solapado (' || v_n_solapa || ')' where coalesce(v_n_solapa,0) > 0
            union all select 'hueco de turno partido insuficiente (' || v_n_gap || ')' where coalesce(v_n_gap,0) > 0
          ) parts
        );
        v_gaps := v_gaps || jsonb_build_object(
          'f', v_fecha, 'ini', r_a.ini_min, 'fin', r_a.fin_min, 'tpl', r_a.tpl_id,
          'motivo', 'SIN CUBRIR — ' || v_seat_motivo);
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
  'ENCARGO F10 mix de turnos, 09/08/2026 (3ª parte). Greedy de demanda ordena por neto (2*gain-dur_h) dentro de cada nivel de uso histórico (uso desc primero, evita resucitar duplicadas). Turno largo garantizado del día pico se reserva ANTES del greedy, no después. Validado por MCP: 3 corridos/semana (1 por persona, real=3), 0 avisos de segundo turno largo, huecos y días trabajados sin empeorar. Horas totales bajan a ~97,5 (por debajo del suelo de 115 que pedía el encargo) — declarado sin resolver, pendiente de criterio de negocio de Julio.';

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
  if position('2*x.gain - x.dur_h' in v_def) = 0 then
    raise exception 'FALLO: generate_week_schedule no tiene el ajuste de beneficio neto';
  end if;
  if position('having sum(case when' in v_def) = 0 then
    raise exception 'FALLO: generate_week_schedule no filtra candidatos con gain=0';
  end if;
  if position('v_assign_all' in v_def) = 0 then
    raise exception 'FALLO: generate_week_schedule perdio la fase 2 por demanda (v4)';
  end if;
  if position('o_shift_template_id' in v_def) = 0 then
    raise exception 'FALLO: generate_week_schedule perdio el anclaje a shift_templates (v3)';
  end if;
end $$;

notify pgrst, 'reload schema';
