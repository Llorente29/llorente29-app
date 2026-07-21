-- 20260721T2500_cfg4b_weather_auto.sql
-- CFG-4b: CLIMA AUTOMÁTICO. pg_cron consulta Open-Meteo (gratis, sin API key) por
-- las coordenadas de cada local cada ~10 min y enciende/apaga el flag de lluvia solo.
-- Modo por local: weather_auto=true → lo maneja el cron; false → override manual del
-- encargado (para forzar lluvia si el pronóstico falla). Todo configurable.

-- 1) Modo auto/manual por local.
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS weather_auto boolean NOT NULL DEFAULT true;

-- 2) Cola de peticiones (request_id de pg_net por local).
CREATE TABLE IF NOT EXISTS public.weather_poll (
  location_id  uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  request_id   bigint,
  requested_at timestamptz DEFAULT now()
);

-- 3) Lanzar consultas a Open-Meteo (una por local con coordenadas y en modo auto).
CREATE OR REPLACE FUNCTION public.reparto_weather_poll()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net','extensions'
AS $function$
DECLARE r record; v_req bigint;
BEGIN
  FOR r IN SELECT id, lat, lng FROM public.locations
           WHERE weather_auto AND lat IS NOT NULL AND lng IS NOT NULL LOOP
    v_req := net.http_get(
      'https://api.open-meteo.com/v1/forecast?latitude='||r.lat||'&longitude='||r.lng||'&current=precipitation,weather_code'
    );
    INSERT INTO public.weather_poll(location_id, request_id, requested_at)
    VALUES (r.id, v_req, now())
    ON CONFLICT (location_id) DO UPDATE SET request_id = excluded.request_id, requested_at = excluded.requested_at;
  END LOOP;
END;
$function$;

-- 4) Leer respuestas y aplicar: lluvia si precipitación>0.1mm o weather_code de lluvia (>=51).
CREATE OR REPLACE FUNCTION public.reparto_weather_apply()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net','extensions'
AS $function$
DECLARE wp record; v_status int; v_content text; j jsonb; v_precip numeric; v_code int; v_rain boolean;
BEGIN
  FOR wp IN SELECT * FROM public.weather_poll WHERE request_id IS NOT NULL LOOP
    SELECT status_code, content::text INTO v_status, v_content
      FROM net._http_response WHERE id = wp.request_id;
    IF NOT FOUND OR v_status IS DISTINCT FROM 200 THEN CONTINUE; END IF;
    BEGIN
      j := (v_content::jsonb) -> 'current';
      v_precip := nullif(j->>'precipitation','')::numeric;
      v_code   := nullif(j->>'weather_code','')::int;
      v_rain   := coalesce(v_precip,0) > 0.1 OR coalesce(v_code,0) >= 51;
      UPDATE public.locations SET weather_is_raining = v_rain, weather_updated_at = now()
       WHERE id = wp.location_id AND weather_auto;
    EXCEPTION WHEN others THEN CONTINUE; END;
    UPDATE public.weather_poll SET request_id = NULL WHERE location_id = wp.location_id;
  END LOOP;
END;
$function$;

-- 5) Toggle manual/auto (amplía la RPC de CFG-4a; p_auto opcional para no romper la llamada antigua).
--    p_auto=true → auto (cron manda) · p_auto=false o null → manual (fija la lluvia a mano).
CREATE OR REPLACE FUNCTION public.set_location_weather(p_location_id uuid, p_is_raining boolean, p_auto boolean DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update locations set
    weather_auto = coalesce(p_auto, false),
    weather_is_raining = case when p_auto is true then weather_is_raining else coalesce(p_is_raining, false) end,
    weather_updated_at = now()
  where id = p_location_id and account_id = any(current_user_account_ids())
    and current_user_is_admin_or_manager_of(account_id);
end; $function$;

-- 6) Exponer weather_auto en settings.
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
        'weather_auto',l.weather_auto,'surge_pct',public.location_surge_pct(l.id)) order by l.name)
      from locations l where l.account_id in (select id from acc)),'[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'priority',r.priority,'location_id',r.location_id,'weekdays',r.weekdays,
        'time_from',r.time_from,'time_to',r.time_to,'min_total',r.min_total,'max_total',r.max_total,
        'margin_floor_pct',r.margin_floor_pct,'then_carrier',r.then_carrier,'fallback_carrier',r.fallback_carrier,
        'carrier_chain',r.carrier_chain,'max_distance_km',r.max_distance_km,
        'strategy',r.strategy,'is_active',r.is_active) order by r.priority)
      from dispatch_rule r where r.account_id in (select id from acc)),'[]'::jsonb),
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

-- 7) Programar los jobs: consulta cada 10 min (min 0,10,20…) y aplica 2 min después.
do $$ begin perform cron.unschedule('reparto-weather-poll');  exception when others then null; end $$;
do $$ begin perform cron.unschedule('reparto-weather-apply'); exception when others then null; end $$;
select cron.schedule('reparto-weather-poll',  '*/10 * * * *',    $$select public.reparto_weather_poll()$$);
select cron.schedule('reparto-weather-apply', '2-59/10 * * * *', $$select public.reparto_weather_apply()$$);
