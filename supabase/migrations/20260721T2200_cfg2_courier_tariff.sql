-- 20260721T2200_cfg2_courier_tariff.sql
-- CFG-2: TARIFA rica del repartidor autónomo. Hoy courier solo tiene cost_model +
-- un número (cost_value). Añadimos un modelo 'tariff' = base + €/km + mínimo de
-- recogida + fijo de recogida (+ tramos opcionales por distancia), al estilo
-- Stuart/Glovo/Uber Direct (base + distancia + mínimo garantizado por entrega).
-- Además CENTRALIZA el cálculo del payout en una función única y ARREGLA el bug
-- de que claim congelaba 0 € para los repartidores por km.

-- 1) Columnas de tarifa + ampliar cost_model a 'tariff'
ALTER TABLE public.courier
  ADD COLUMN IF NOT EXISTS rate_base       numeric,   -- € base por pedido
  ADD COLUMN IF NOT EXISTS rate_per_km     numeric,   -- €/km
  ADD COLUMN IF NOT EXISTS rate_min_pickup numeric,   -- mínimo garantizado por recogida
  ADD COLUMN IF NOT EXISTS rate_pickup_fee numeric,   -- € fijo por recoger
  ADD COLUMN IF NOT EXISTS rate_tiers      jsonb;     -- [{"to_km":2,"price":3.5},{"to_km":5,"price":5}]

ALTER TABLE public.courier DROP CONSTRAINT IF EXISTS courier_cost_model_check;
ALTER TABLE public.courier ADD CONSTRAINT courier_cost_model_check
  CHECK (cost_model = ANY (ARRAY['salary','hourly','per_order','per_km','tariff']));

-- 2) Distancia local->cliente de una venta (mismo origen que el feed: raw_tab).
CREATE OR REPLACE FUNCTION public.sale_delivery_distance_km(p_sale_id uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select case
    when l.lat is not null and l.lng is not null and g.dlat is not null and g.dlng is not null
    then round((2*6371*asin(sqrt(
      power(sin(radians(g.dlat - l.lat)/2),2) +
      cos(radians(l.lat))*cos(radians(g.dlat))*
      power(sin(radians(g.dlng - l.lng)/2),2)
    )))::numeric,1)
    else null end
  from public.sale s
  left join public.locations l on l.id = s.location_id
  cross join lateral (
    select case when left(btrim(coalesce(s.raw_tab,'')),1)='{' then s.raw_tab::jsonb else '{}'::jsonb end as rt
  ) j
  cross join lateral (
    select nullif(j.rt->'delivery'->>'latitude','')::numeric  as dlat,
           nullif(j.rt->'delivery'->>'longitude','')::numeric as dlng
  ) g
  where s.id = p_sale_id;
$function$;

-- 3) Payout canónico de un repartidor para una distancia dada (única fuente de verdad).
--    salary/hourly -> NULL (no se paga por pedido; se imputa por horas en el informe).
CREATE OR REPLACE FUNCTION public.courier_payout(p_courier_id uuid, p_distance_km numeric)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.courier; v_raw numeric; v_price numeric; v_dist numeric := coalesce(p_distance_km,0);
BEGIN
  SELECT * INTO c FROM public.courier WHERE id = p_courier_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF c.cost_model = 'per_order' THEN
    RETURN c.cost_value;

  ELSIF c.cost_model = 'per_km' THEN
    RETURN CASE WHEN p_distance_km IS NOT NULL
                THEN round((coalesce(c.cost_value,0) * p_distance_km)::numeric, 2)
                ELSE c.cost_value END;

  ELSIF c.cost_model = 'tariff' THEN
    IF c.rate_tiers IS NOT NULL AND jsonb_typeof(c.rate_tiers)='array' AND jsonb_array_length(c.rate_tiers) > 0 THEN
      -- Precio por tramo: primer tramo cuyo to_km >= distancia; si excede todos, el mayor.
      SELECT (t->>'price')::numeric INTO v_price
      FROM jsonb_array_elements(c.rate_tiers) t
      WHERE v_dist <= (t->>'to_km')::numeric
      ORDER BY (t->>'to_km')::numeric ASC LIMIT 1;
      IF v_price IS NULL THEN
        SELECT (t->>'price')::numeric INTO v_price
        FROM jsonb_array_elements(c.rate_tiers) t
        ORDER BY (t->>'to_km')::numeric DESC LIMIT 1;
      END IF;
      v_raw := coalesce(c.rate_pickup_fee,0) + coalesce(v_price,0);
    ELSE
      v_raw := coalesce(c.rate_base,0) + coalesce(c.rate_pickup_fee,0) + coalesce(c.rate_per_km,0) * v_dist;
    END IF;
    RETURN round(greatest(coalesce(c.rate_min_pickup,0), v_raw)::numeric, 2);

  ELSE
    RETURN NULL;  -- salary / hourly
  END IF;
END;
$function$;

-- 4) FEED del repartidor: el payout mostrado usa la función canónica.
CREATE OR REPLACE FUNCTION public.courier_feed_by_token(p_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.courier; v jsonb;
BEGIN
  c := public._courier_by_token(p_token);
  SELECT coalesce(jsonb_agg(item ORDER BY sort_key, offered_at), '[]'::jsonb) INTO v
  FROM (
    SELECT
      CASE WHEN da.courier_id = c.id THEN 0 ELSE 1 END AS sort_key,
      da.offered_at,
      jsonb_build_object(
        'assignment_id',    da.id,
        'state',            da.state,
        'mine',             (da.courier_id = c.id),
        'sale_id',          s.id,
        'order_code',       coalesce(s.platform_order_code, s.external_tab_ref, s.external_ref, left(s.id::text,8)),
        'brand',            b.name,
        'brand_logo',       b.logo_url,
        'customer_name',    s.customer_name,
        'customer_phone',   s.customer_phone,
        'total',            s.total,
        'items_count',      (SELECT count(*) FROM public.sale_line sl WHERE sl.sale_id = s.id AND sl.line_type = 'product'),
        'delivery_address', coalesce(NULLIF(j.rt->'delivery'->>'geocodedAddress',''),
                                     NULLIF(j.rt->'delivery'->>'address',''), s.delivery_address),
        'delivery_details', j.rt->'delivery'->>'details',
        'delivery_lat',     g.dlat,
        'delivery_lng',     g.dlng,
        'pickup_name',      l.name,
        'pickup_address',   l.address,
        'pickup_lat',       l.lat,
        'pickup_lng',       l.lng,
        'distance_km',      dk.dist_km,
        'payout',           public.courier_payout(c.id, dk.dist_km),
        'offered_at',       da.offered_at
      ) AS item
    FROM public.delivery_assignment da
    JOIN public.sale s      ON s.id = da.sale_id
    LEFT JOIN public.brand b ON b.id = s.brand_id
    LEFT JOIN public.locations l ON l.id = da.location_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN left(btrim(coalesce(s.raw_tab,'')),1) = '{' THEN s.raw_tab::jsonb ELSE '{}'::jsonb END AS rt
    ) j
    CROSS JOIN LATERAL (
      SELECT NULLIF(j.rt->'delivery'->>'latitude','')::numeric  AS dlat,
             NULLIF(j.rt->'delivery'->>'longitude','')::numeric AS dlng
    ) g
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN l.lat IS NOT NULL AND l.lng IS NOT NULL AND g.dlat IS NOT NULL AND g.dlng IS NOT NULL
        THEN round((2 * 6371 * asin(sqrt(
               power(sin(radians(g.dlat - l.lat) / 2), 2) +
               cos(radians(l.lat)) * cos(radians(g.dlat)) *
               power(sin(radians(g.dlng - l.lng) / 2), 2)
             )))::numeric, 1)
        ELSE NULL END AS dist_km
    ) dk
    WHERE da.account_id = c.account_id
      AND (
        (da.courier_id = c.id AND da.state IN ('accepted','picked_up','in_delivery'))
        OR
        (da.courier_id IS NULL AND da.state = 'offered'
          AND NOT (c.id = ANY(coalesce(da.declined_by, '{}'::uuid[])))
          AND (c.assigned_locations = '{}'::uuid[] OR da.location_id = ANY(c.assigned_locations)))
      )
  ) t;
  RETURN v;
END;
$function$;

-- 5) CLAIM: al aceptar se CONGELA el payout real (arregla el bug del 0 € por km).
CREATE OR REPLACE FUNCTION public.courier_claim_by_token(p_token text, p_assignment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.courier; v_cost numeric; v_upd uuid; v_sale uuid;
BEGIN
  c := public._courier_by_token(p_token);
  IF NOT c.on_shift THEN
    RAISE EXCEPTION 'ponte en turno para aceptar pedidos';
  END IF;

  SELECT da.sale_id INTO v_sale FROM public.delivery_assignment da WHERE da.id = p_assignment_id;
  v_cost := coalesce(public.courier_payout(c.id, public.sale_delivery_distance_km(v_sale)), 0);

  UPDATE public.delivery_assignment da
     SET courier_id = c.id, state = 'accepted', accepted_at = now(), transport_price = v_cost
   WHERE da.id = p_assignment_id
     AND da.state = 'offered'
     AND da.courier_id IS NULL
     AND da.account_id = c.account_id
     AND (c.assigned_locations = '{}'::uuid[] OR da.location_id = ANY(c.assigned_locations))
   RETURNING da.id INTO v_upd;

  IF v_upd IS NULL THEN
    RAISE EXCEPTION 'esa oferta ya fue tomada o no está disponible';
  END IF;
  RETURN jsonb_build_object('assignment_id', v_upd, 'state', 'accepted', 'payout', v_cost);
END;
$function$;

-- 6) Guardado del repartidor: acepta los campos de tarifa.
CREATE OR REPLACE FUNCTION public.upsert_courier(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_acc uuid; v_id uuid;
begin
  v_acc := (current_user_account_ids())[1];
  if v_acc is null or not current_user_is_admin_or_manager_of(v_acc) then raise exception 'forbidden'; end if;
  v_id := nullif(p->>'id','')::uuid;
  -- kind es NOT NULL: por defecto 'freelance' (autónomo). Empleado exige employee_id
  -- (lo enlaza el alta de CFG-3); si falta, el CHECK courier_kind_employee lo rechaza.
  if v_id is null then
    insert into courier(account_id,name,phone,kind,employee_id,transport_type,assigned_locations,cost_model,cost_value,
      rate_base,rate_per_km,rate_min_pickup,rate_pickup_fee,rate_tiers,active,on_shift)
    values (v_acc, p->>'name', nullif(p->>'phone',''),
      coalesce(nullif(p->>'kind',''),'freelance'), nullif(p->>'employee_id','')::uuid,
      nullif(p->>'transport_type',''),
      case when jsonb_typeof(p->'assigned_locations')='array' then (select coalesce(array_agg(x::uuid),'{}'::uuid[]) from jsonb_array_elements_text(p->'assigned_locations') x) else '{}'::uuid[] end,
      coalesce(nullif(p->>'cost_model',''),'per_order'), nullif(p->>'cost_value','')::numeric,
      nullif(p->>'rate_base','')::numeric, nullif(p->>'rate_per_km','')::numeric,
      nullif(p->>'rate_min_pickup','')::numeric, nullif(p->>'rate_pickup_fee','')::numeric,
      case when jsonb_typeof(p->'rate_tiers')='array' then p->'rate_tiers' else null end,
      coalesce((p->>'active')::boolean,true), coalesce((p->>'on_shift')::boolean,false))
    returning id into v_id;
  else
    update courier set name=p->>'name', phone=nullif(p->>'phone',''),
      kind=coalesce(nullif(p->>'kind',''),kind),
      employee_id=case when p ? 'employee_id' then nullif(p->>'employee_id','')::uuid else employee_id end,
      transport_type=nullif(p->>'transport_type',''),
      assigned_locations=case when jsonb_typeof(p->'assigned_locations')='array' then (select coalesce(array_agg(x::uuid),'{}'::uuid[]) from jsonb_array_elements_text(p->'assigned_locations') x) else assigned_locations end,
      cost_model=coalesce(nullif(p->>'cost_model',''),cost_model), cost_value=nullif(p->>'cost_value','')::numeric,
      rate_base=nullif(p->>'rate_base','')::numeric, rate_per_km=nullif(p->>'rate_per_km','')::numeric,
      rate_min_pickup=nullif(p->>'rate_min_pickup','')::numeric, rate_pickup_fee=nullif(p->>'rate_pickup_fee','')::numeric,
      rate_tiers=case when jsonb_typeof(p->'rate_tiers')='array' then p->'rate_tiers' else rate_tiers end,
      active=coalesce((p->>'active')::boolean,active), on_shift=coalesce((p->>'on_shift')::boolean,on_shift), updated_at=now()
    where id=v_id and account_id=v_acc;
  end if;
  return v_id;
end; $function$;

-- 7) Exponer tarifa + kind en la RPC de settings (para la UI).
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
        'id',c.id,'name',c.name,'phone',c.phone,'kind',c.kind,'transport_type',c.transport_type,
        'assigned_locations',c.assigned_locations,'cost_model',c.cost_model,'cost_value',c.cost_value,
        'rate_base',c.rate_base,'rate_per_km',c.rate_per_km,'rate_min_pickup',c.rate_min_pickup,
        'rate_pickup_fee',c.rate_pickup_fee,'rate_tiers',c.rate_tiers,
        'active',c.active,'on_shift',c.on_shift) order by c.name)
      from courier c where c.account_id in (select id from acc)),'[]'::jsonb)
  );
$function$;
