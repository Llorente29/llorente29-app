-- 20260721T2100_cfg1_dispatch_carrier_chain.sql
-- CFG-1: motor de decisión propio-vs-contratado con CADENA de transportistas por
-- prioridad (own_fleet -> Catcher -> Jelp -> ...) + tope de distancia para el propio.
-- Aditivo y RETROCOMPATIBLE: sin reglas (hoy 0) o sin cadena, comportamiento idéntico a hoy.
-- Benchmark: Onfleet/Bringg/Deliverect deciden propio-vs-externo por distancia+disponibilidad+coste.

-- 1) Columnas nuevas en dispatch_rule
ALTER TABLE public.dispatch_rule
  ADD COLUMN IF NOT EXISTS carrier_chain   text[],
  ADD COLUMN IF NOT EXISTS max_distance_km numeric;

-- Backfill: derivar la cadena de las reglas antiguas (then + fallback).
UPDATE public.dispatch_rule
   SET carrier_chain = array_remove(ARRAY[then_carrier, fallback_carrier], NULL)
 WHERE carrier_chain IS NULL;

-- 2) Motor: recorre la cadena por orden; own_fleet solo si hay repartidor en turno
--    y (si se fija) dentro del tope de distancia; los externos se asumen serviceables.
CREATE OR REPLACE FUNCTION public.resolve_dispatch(p_sale_id uuid)
 RETURNS TABLE(carrier text, reason text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sale   record;
  v_mode   text;
  v_broker text;
  v_rule   record;
  v_now    timestamptz := now();
  v_dow    int;
  v_time   time;
  v_avail  int;
  v_rt     jsonb;
  v_dlat   numeric;
  v_dlng   numeric;
  v_llat   numeric;
  v_llng   numeric;
  v_dist   numeric;
  v_chain  text[];
  v_c      text;
BEGIN
  SELECT s.account_id, s.location_id, s.total, s.service_type, s.raw_tab
    INTO v_sale FROM public.sale s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'venta no encontrada'::text; RETURN;
  END IF;

  SELECT coalesce(l.dispatch_mode,'auto'), coalesce(l.dispatch_broker,'catcher'), l.lat, l.lng
    INTO v_mode, v_broker, v_llat, v_llng
    FROM public.locations l WHERE l.id = v_sale.location_id;
  v_broker := coalesce(v_broker,'catcher');

  -- Coordenadas del cliente desde raw_tab (mismo origen que el feed) -> distancia local->cliente
  v_rt := CASE WHEN left(btrim(coalesce(v_sale.raw_tab,'')),1)='{' THEN v_sale.raw_tab::jsonb ELSE '{}'::jsonb END;
  v_dlat := nullif(v_rt->'delivery'->>'latitude','')::numeric;
  v_dlng := nullif(v_rt->'delivery'->>'longitude','')::numeric;
  IF v_llat IS NOT NULL AND v_llng IS NOT NULL AND v_dlat IS NOT NULL AND v_dlng IS NOT NULL THEN
    v_dist := round((2*6371*asin(sqrt(
      power(sin(radians(v_dlat - v_llat)/2),2) +
      cos(radians(v_llat))*cos(radians(v_dlat))*
      power(sin(radians(v_dlng - v_llng)/2),2)
    )))::numeric, 1);
  END IF;

  v_dow  := ((extract(dow FROM (v_now AT TIME ZONE 'Europe/Madrid'))::int) + 6) % 7;
  v_time := (v_now AT TIME ZONE 'Europe/Madrid')::time;

  SELECT * INTO v_rule
  FROM public.dispatch_rule r
  WHERE r.is_active
    AND r.account_id = v_sale.account_id
    AND (r.location_id IS NULL OR r.location_id = v_sale.location_id)
    AND (r.weekdays IS NULL OR v_dow = ANY(r.weekdays))
    AND (r.time_from IS NULL OR r.time_to IS NULL OR
         (CASE WHEN r.time_from <= r.time_to
               THEN v_time >= r.time_from AND v_time < r.time_to
               ELSE v_time >= r.time_from OR  v_time < r.time_to END))
    AND (r.min_total IS NULL OR v_sale.total >= r.min_total)
    AND (r.max_total IS NULL OR v_sale.total <  r.max_total)
  ORDER BY r.priority ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_broker, ('sin regla -> broker por defecto ('||v_broker||')')::text; RETURN;
  END IF;

  -- Cadena: preferimos carrier_chain; si no, la derivamos de then/fallback (legacy).
  v_chain := v_rule.carrier_chain;
  IF v_chain IS NULL OR array_length(v_chain,1) IS NULL THEN
    v_chain := array_remove(ARRAY[v_rule.then_carrier, v_rule.fallback_carrier], NULL);
  END IF;
  IF array_length(v_chain,1) IS NULL THEN
    RETURN QUERY SELECT v_broker, ('regla '||v_rule.priority||' sin cadena -> broker por defecto')::text; RETURN;
  END IF;

  FOREACH v_c IN ARRAY v_chain LOOP
    IF v_c = 'own_fleet' THEN
      IF v_rule.max_distance_km IS NOT NULL AND v_dist IS NOT NULL AND v_dist > v_rule.max_distance_km THEN
        CONTINUE;  -- demasiado lejos para propio -> siguiente eslabón
      END IF;
      SELECT count(*) INTO v_avail
      FROM public.courier c
      WHERE c.account_id = v_sale.account_id AND c.active AND c.on_shift
        AND (c.assigned_locations = '{}'::uuid[] OR v_sale.location_id = ANY(c.assigned_locations));
      IF v_avail > 0 THEN
        RETURN QUERY SELECT 'own_fleet'::text,
          ('regla '||v_rule.priority||' -> propio ('||v_avail||' en turno'||coalesce(', '||v_dist||' km','')||')')::text;
        RETURN;
      END IF;
      -- sin repartidor -> siguiente eslabón
    ELSE
      RETURN QUERY SELECT v_c, ('regla '||v_rule.priority||' -> '||v_c||' (cadena)')::text;
      RETURN;
    END IF;
  END LOOP;

  -- Cadena agotada sin candidato viable -> broker por defecto del local (backstop: siempre se reparte).
  RETURN QUERY SELECT v_broker,
    ('regla '||v_rule.priority||' -> cadena agotada; broker por defecto ('||v_broker||')')::text;
END;
$function$;

-- 3) Guardado de reglas: acepta carrier_chain[] + max_distance_km; deriva then/fallback (compat).
CREATE OR REPLACE FUNCTION public.upsert_dispatch_rule(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_acc uuid; v_id uuid;
  v_chain text[]; v_then text; v_fallback text;
begin
  v_acc := (current_user_account_ids())[1];
  if v_acc is null or not current_user_is_admin_or_manager_of(v_acc) then raise exception 'forbidden'; end if;
  v_id := nullif(p->>'id','')::uuid;

  if jsonb_typeof(p->'carrier_chain')='array' then
    v_chain := (select array_agg(x) from jsonb_array_elements_text(p->'carrier_chain') x where nullif(x,'') is not null);
  end if;
  if v_chain is null or array_length(v_chain,1) is null then
    v_chain := array_remove(ARRAY[nullif(p->>'then_carrier',''), nullif(p->>'fallback_carrier','')], NULL);
  end if;
  v_then     := coalesce(v_chain[1], nullif(p->>'then_carrier',''), 'own_fleet');
  v_fallback := v_chain[2];

  if v_id is null then
    insert into dispatch_rule(account_id,location_id,priority,weekdays,time_from,time_to,min_total,max_total,
      margin_floor_pct,then_carrier,fallback_carrier,carrier_chain,max_distance_km,strategy,is_active)
    values (v_acc, nullif(p->>'location_id','')::uuid, coalesce((p->>'priority')::int,100),
      case when jsonb_typeof(p->'weekdays')='array' then (select array_agg(x::int) from jsonb_array_elements_text(p->'weekdays') x) else null end,
      nullif(p->>'time_from','')::time, nullif(p->>'time_to','')::time,
      nullif(p->>'min_total','')::numeric, nullif(p->>'max_total','')::numeric, nullif(p->>'margin_floor_pct','')::numeric,
      v_then, v_fallback, v_chain, nullif(p->>'max_distance_km','')::numeric,
      coalesce(nullif(p->>'strategy',''),'own_first'),
      coalesce((p->>'is_active')::boolean,true))
    returning id into v_id;
  else
    update dispatch_rule set location_id=nullif(p->>'location_id','')::uuid, priority=coalesce((p->>'priority')::int,priority),
      weekdays=case when jsonb_typeof(p->'weekdays')='array' then (select array_agg(x::int) from jsonb_array_elements_text(p->'weekdays') x) else null end,
      time_from=nullif(p->>'time_from','')::time, time_to=nullif(p->>'time_to','')::time,
      min_total=nullif(p->>'min_total','')::numeric, max_total=nullif(p->>'max_total','')::numeric,
      margin_floor_pct=nullif(p->>'margin_floor_pct','')::numeric,
      then_carrier=v_then, fallback_carrier=v_fallback, carrier_chain=v_chain,
      max_distance_km=nullif(p->>'max_distance_km','')::numeric,
      strategy=coalesce(nullif(p->>'strategy',''),strategy),
      is_active=coalesce((p->>'is_active')::boolean,is_active), updated_at=now()
    where id=v_id and account_id=v_acc;
  end if;
  return v_id;
end; $function$;

-- 4) Exponer carrier_chain + max_distance_km en la RPC de settings (para la UI del editor).
CREATE OR REPLACE FUNCTION public.reparto_settings()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with acc as (select unnest(current_user_account_ids()) as id)
  select jsonb_build_object(
    'track_base_url', (select a.track_base_url from accounts a join acc on acc.id=a.id order by a.id limit 1),
    'carriers', coalesce((
        select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by t.ord, t.name)
        from (
          select 'own_fleet'::text as code, 'Flota propia'::text as name, 0 as ord
          union
          select co.code, co.name, 1 as ord
          from account_connector ac
          join connector co on co.id = ac.connector_id
          where ac.account_id in (select id from acc)
            and coalesce(ac.is_active, false)
            and co.category = 'logistics'
        ) t
      ), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'id',l.id,'name',l.name,'mode',coalesce(l.dispatch_mode,'auto'),
        'broker',l.dispatch_broker,'notify',coalesce(l.customer_notify_enabled,false)) order by l.name)
      from locations l where l.account_id in (select id from acc)),'[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'priority',r.priority,'location_id',r.location_id,'weekdays',r.weekdays,
        'time_from',r.time_from,'time_to',r.time_to,'min_total',r.min_total,'max_total',r.max_total,
        'margin_floor_pct',r.margin_floor_pct,'then_carrier',r.then_carrier,'fallback_carrier',r.fallback_carrier,
        'carrier_chain',r.carrier_chain,'max_distance_km',r.max_distance_km,
        'strategy',r.strategy,'is_active',r.is_active) order by r.priority)
      from dispatch_rule r where r.account_id in (select id from acc)),'[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'phone',c.phone,'transport_type',c.transport_type,
        'assigned_locations',c.assigned_locations,'cost_model',c.cost_model,'cost_value',c.cost_value,
        'active',c.active,'on_shift',c.on_shift) order by c.name)
      from courier c where c.account_id in (select id from acc)),'[]'::jsonb)
  );
$function$;
