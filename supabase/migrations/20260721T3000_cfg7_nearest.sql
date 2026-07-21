-- 20260721T3000_cfg7_nearest.sql
-- CFG-7: ASIGNACIÓN por cercanía. Por local, elige cómo se ofrece el pedido a la
-- flota propia: 'broadcast' (actual, a todos a la vez) o 'nearest' (al más cercano,
-- con timeout y reoferta automática al siguiente). ADITIVO: default broadcast =
-- comportamiento idéntico a hoy.

-- 1) Config por local.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS assignment_strategy text NOT NULL DEFAULT 'broadcast',
  ADD COLUMN IF NOT EXISTS offer_timeout_s      int  NOT NULL DEFAULT 60;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_assignment_strategy_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_assignment_strategy_check
  CHECK (assignment_strategy IN ('broadcast','nearest'));

-- 2) Oferta dirigida: a quién y hasta cuándo (para 'nearest').
ALTER TABLE public.delivery_assignment
  ADD COLUMN IF NOT EXISTS offered_to       uuid,
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

-- 3) Trigger de auto-despacho: rama own_fleet respeta la estrategia.
CREATE OR REPLACE FUNCTION public.tg_auto_dispatch()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_mode     text;
  v_carrier  text;
  v_reason   text;
  v_strategy text;
  v_timeout  int;
  v_courier  uuid;
  v_secret   text := 'fv_catdisp_tnrMMcaI8gALFCitfvzPGsaHgQa3A83w';
  v_url      text := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-dispatch';
BEGIN
  IF new.service_type = 'own_delivery'
     AND new.order_status = 'accepted'
     AND new.carrier_order_id IS NULL
     AND (tg_op = 'INSERT' OR old.order_status IS DISTINCT FROM new.order_status)
  THEN
    IF EXISTS (SELECT 1 FROM public.delivery_assignment da
               WHERE da.sale_id = new.id AND da.state NOT IN ('failed','canceled')) THEN
      RETURN new;
    END IF;

    SELECT coalesce(l.dispatch_mode,'auto') INTO v_mode
      FROM public.locations l WHERE l.id = new.location_id;
    IF v_mode <> 'auto' THEN RETURN new; END IF;

    SELECT carrier, reason INTO v_carrier, v_reason FROM public.resolve_dispatch(new.id);

    IF v_carrier = 'own_fleet' THEN
      SELECT coalesce(l.assignment_strategy,'broadcast'), coalesce(l.offer_timeout_s,60)
        INTO v_strategy, v_timeout FROM public.locations l WHERE l.id = new.location_id;

      IF v_strategy = 'nearest' THEN
        -- repartidor en turno más cercano al local (sin GPS = al final).
        SELECT c.id INTO v_courier
          FROM public.courier c, public.locations l
         WHERE l.id = new.location_id AND c.account_id = new.account_id AND c.active AND c.on_shift
           AND (c.assigned_locations = '{}'::uuid[] OR new.location_id = ANY(c.assigned_locations))
         ORDER BY (CASE WHEN c.last_lat IS NOT NULL AND c.last_lng IS NOT NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL
                        THEN 2*6371*asin(sqrt(power(sin(radians(c.last_lat - l.lat)/2),2)
                             + cos(radians(l.lat))*cos(radians(c.last_lat))*power(sin(radians(c.last_lng - l.lng)/2),2)))
                        ELSE NULL END) ASC NULLS LAST
         LIMIT 1;
        -- v_courier NULL (nadie) → oferta broadcast como respaldo.
        INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by, offered_to, offer_expires_at)
        VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto', v_courier,
                CASE WHEN v_courier IS NOT NULL THEN now() + make_interval(secs => v_timeout) ELSE NULL END);
      ELSE
        INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by)
        VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto');
      END IF;

    ELSIF v_carrier = 'catcher' THEN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','x-catcher-dispatch-secret', v_secret),
        body    := jsonb_build_object('sale_id', new.id, 'internal', true)
      );
    END IF;
  END IF;
  RETURN new;
END;
$function$;

-- 4) Reoferta por timeout: el que no responde pasa a declinado; se ofrece al siguiente
--    más cercano; si no queda nadie, cae a broadcast (offered_to NULL).
CREATE OR REPLACE FUNCTION public.reparto_reoffer()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_next uuid; v_timeout int;
BEGIN
  FOR r IN SELECT * FROM public.delivery_assignment da
           WHERE da.state = 'offered' AND da.courier_id IS NULL
             AND da.offered_to IS NOT NULL AND da.offer_expires_at IS NOT NULL
             AND da.offer_expires_at < now() LOOP
    SELECT coalesce(l.offer_timeout_s,60) INTO v_timeout FROM public.locations l WHERE l.id = r.location_id;
    SELECT c.id INTO v_next
      FROM public.courier c, public.locations l
     WHERE l.id = r.location_id AND c.account_id = r.account_id AND c.active AND c.on_shift
       AND (c.assigned_locations = '{}'::uuid[] OR r.location_id = ANY(c.assigned_locations))
       AND c.id <> r.offered_to
       AND NOT (c.id = ANY(coalesce(r.declined_by, '{}'::uuid[])))
     ORDER BY (CASE WHEN c.last_lat IS NOT NULL AND c.last_lng IS NOT NULL AND l.lat IS NOT NULL AND l.lng IS NOT NULL
                    THEN 2*6371*asin(sqrt(power(sin(radians(c.last_lat - l.lat)/2),2)
                         + cos(radians(l.lat))*cos(radians(c.last_lat))*power(sin(radians(c.last_lng - l.lng)/2),2)))
                    ELSE NULL END) ASC NULLS LAST
     LIMIT 1;

    UPDATE public.delivery_assignment SET
      declined_by      = array_append(coalesce(declined_by, '{}'::uuid[]), r.offered_to),
      offered_to       = v_next,
      offer_expires_at = CASE WHEN v_next IS NOT NULL THEN now() + make_interval(secs => v_timeout) ELSE NULL END
    WHERE id = r.id;
  END LOOP;
END;
$function$;

do $$ begin perform cron.unschedule('reparto-reoffer'); exception when others then null; end $$;
select cron.schedule('reparto-reoffer', '* * * * *', $$select public.reparto_reoffer()$$);

-- 5) FEED: además de broadcast, muestra la oferta DIRIGIDA a este repartidor.
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
        'base_payout',      public.courier_payout(c.id, dk.dist_km),
        'surge_pct',        public.location_surge_pct(da.location_id),
        'surge_reason',     public.location_surge_reason(da.location_id),
        'payout',           round((coalesce(public.courier_payout(c.id, dk.dist_km),0)
                                    * (1 + public.location_surge_pct(da.location_id)/100.0))::numeric, 2),
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
          AND (c.assigned_locations = '{}'::uuid[] OR da.location_id = ANY(c.assigned_locations))
          AND (da.offered_to IS NULL OR da.offered_to = c.id))
      )
  ) t;
  RETURN v;
END;
$function$;

-- 6) CLAIM: acepta broadcast o dirigida; al aceptar limpia la oferta dirigida.
CREATE OR REPLACE FUNCTION public.courier_claim_by_token(p_token text, p_assignment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.courier; v_base numeric; v_surge numeric; v_cost numeric; v_upd uuid; v_sale uuid; v_loc uuid;
BEGIN
  c := public._courier_by_token(p_token);
  IF NOT c.on_shift THEN RAISE EXCEPTION 'ponte en turno para aceptar pedidos'; END IF;

  SELECT da.sale_id, da.location_id INTO v_sale, v_loc FROM public.delivery_assignment da WHERE da.id = p_assignment_id;
  v_base  := coalesce(public.courier_payout(c.id, public.sale_delivery_distance_km(v_sale)), 0);
  v_surge := coalesce(public.location_surge_pct(v_loc), 0);
  v_cost  := round((v_base * (1 + v_surge/100.0))::numeric, 2);

  UPDATE public.delivery_assignment da
     SET courier_id = c.id, state = 'accepted', accepted_at = now(), transport_price = v_cost,
         offered_to = NULL, offer_expires_at = NULL
   WHERE da.id = p_assignment_id
     AND da.state = 'offered'
     AND da.courier_id IS NULL
     AND da.account_id = c.account_id
     AND (c.assigned_locations = '{}'::uuid[] OR da.location_id = ANY(c.assigned_locations))
     AND (da.offered_to IS NULL OR da.offered_to = c.id)
   RETURNING da.id INTO v_upd;

  IF v_upd IS NULL THEN RAISE EXCEPTION 'esa oferta ya fue tomada o no está disponible'; END IF;
  RETURN jsonb_build_object('assignment_id', v_upd, 'state', 'accepted', 'payout', v_cost, 'surge_pct', v_surge);
END;
$function$;

-- 7) RPC de config + exponer en settings.
CREATE OR REPLACE FUNCTION public.set_location_assignment(p_location_id uuid, p_strategy text, p_timeout_s int)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update locations set
    assignment_strategy = case when p_strategy in ('broadcast','nearest') then p_strategy else assignment_strategy end,
    offer_timeout_s = case when p_timeout_s is not null and p_timeout_s between 15 and 600 then p_timeout_s else offer_timeout_s end
  where id = p_location_id and account_id = any(current_user_account_ids())
    and current_user_is_admin_or_manager_of(account_id);
end; $function$;

-- 8) reparto_settings: exponer assignment_strategy + offer_timeout_s por local.
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
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.name)
      from employees e
      where coalesce(e.active,true)
        and exists (select 1 from locations l
                    where l.account_id in (select id from acc)
                      and (e.location_id = l.id or l.id = any(e.assigned_locations)))
      ),'[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'id',l.id,'name',l.name,'mode',coalesce(l.dispatch_mode,'auto'),
        'broker',l.dispatch_broker,'notify',coalesce(l.customer_notify_enabled,false),
        'bonus_rain_pct',l.bonus_rain_pct,'bonus_demand_max_pct',l.bonus_demand_max_pct,
        'bonus_combined_cap_pct',l.bonus_combined_cap_pct,'weather_is_raining',l.weather_is_raining,
        'weather_auto',l.weather_auto,'surge_pct',public.location_surge_pct(l.id),
        'assignment_strategy',coalesce(l.assignment_strategy,'broadcast'),'offer_timeout_s',coalesce(l.offer_timeout_s,60)) order by l.name)
      from locations l where l.account_id in (select id from acc)),'[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'priority',r.priority,'location_id',r.location_id,'weekdays',r.weekdays,
        'time_from',r.time_from,'time_to',r.time_to,'min_total',r.min_total,'max_total',r.max_total,
        'margin_floor_pct',r.margin_floor_pct,'then_carrier',r.then_carrier,'fallback_carrier',r.fallback_carrier,
        'carrier_chain',r.carrier_chain,'max_distance_km',r.max_distance_km,
        'strategy',r.strategy,'is_active',r.is_active) order by r.priority)
      from dispatch_rule r where r.account_id in (select id from acc)),'[]'::jsonb),
    'bonuses', coalesce((select jsonb_agg(jsonb_build_object(
        'id',qb.id,'name',qb.name,'period',qb.period,'target_count',qb.target_count,'reward',qb.reward,
        'location_id',qb.location_id,'valid_from',qb.valid_from,'valid_to',qb.valid_to,'is_active',qb.is_active)
        order by qb.reward desc)
      from courier_bonus qb where qb.account_id in (select id from acc)),'[]'::jsonb),
    'couriers', coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'phone',c.phone,'kind',c.kind,'employee_id',c.employee_id,
        'transport_type',c.transport_type,'vehicle_plate',c.vehicle_plate,'nif',c.nif,'iban',c.iban,
        'access_token',c.access_token,
        'assigned_locations',c.assigned_locations,'cost_model',c.cost_model,'cost_value',c.cost_value,
        'rate_base',c.rate_base,'rate_per_km',c.rate_per_km,'rate_min_pickup',c.rate_min_pickup,
        'rate_pickup_fee',c.rate_pickup_fee,'rate_max',c.rate_max,'rate_tiers',c.rate_tiers,
        'active',c.active,'on_shift',c.on_shift) order by c.name)
      from courier c where c.account_id in (select id from acc)),'[]'::jsonb)
  );
$function$;
