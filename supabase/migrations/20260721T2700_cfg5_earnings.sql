-- 20260721T2700_cfg5_earnings.sql
-- CFG-5: GANANCIAS del repartidor en la app. Se calculan de delivery_assignment
-- (transport_price = payout ya congelado CON surge al aceptar) + retos completados.
-- Todo por token, sin login. Sin duplicar estado.

CREATE OR REPLACE FUNCTION public.courier_earnings_by_token(p_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c public.courier;
  v_day_start  timestamptz;
  v_week_start timestamptz;
  v_today  record;
  v_week   record;
  v_quests jsonb;
  v_quest_reward numeric;
  v_history jsonb;
BEGIN
  c := public._courier_by_token(p_token);
  v_day_start  := (date_trunc('day',  now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  v_week_start := (date_trunc('week', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';

  SELECT count(*)::int AS deliveries,
         coalesce(sum(da.transport_price),0)::numeric AS earnings,
         coalesce(sum(public.sale_delivery_distance_km(da.sale_id)),0)::numeric AS km
    INTO v_today
    FROM public.delivery_assignment da
   WHERE da.courier_id = c.id AND da.state = 'delivered' AND da.delivered_at >= v_day_start;

  SELECT count(*)::int AS deliveries,
         coalesce(sum(da.transport_price),0)::numeric AS earnings,
         coalesce(sum(public.sale_delivery_distance_km(da.sale_id)),0)::numeric AS km
    INTO v_week
    FROM public.delivery_assignment da
   WHERE da.courier_id = c.id AND da.state = 'delivered' AND da.delivered_at >= v_week_start;

  -- Retos completados (progreso vigente) → suma de sus bonos.
  v_quests := public.courier_quest_progress(c.id);
  SELECT coalesce(sum((q->>'reward')::numeric),0) INTO v_quest_reward
    FROM jsonb_array_elements(v_quests) q
   WHERE (q->>'completed')::boolean;

  -- Histórico últimos 7 días (por fecha local).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', t.day, 'deliveries', t.deliveries, 'earnings', t.earnings) ORDER BY t.day DESC), '[]'::jsonb)
    INTO v_history
    FROM (
      SELECT (da.delivered_at at time zone 'Europe/Madrid')::date AS day,
             count(*)::int AS deliveries,
             coalesce(sum(da.transport_price),0)::numeric AS earnings
        FROM public.delivery_assignment da
       WHERE da.courier_id = c.id AND da.state = 'delivered'
         AND da.delivered_at >= (now() - interval '7 days')
       GROUP BY 1
    ) t;

  RETURN jsonb_build_object(
    'today', jsonb_build_object('deliveries', v_today.deliveries, 'earnings', round(v_today.earnings,2), 'km', round(v_today.km,1)),
    'week',  jsonb_build_object('deliveries', v_week.deliveries,  'earnings', round(v_week.earnings,2),  'km', round(v_week.km,1)),
    'quests', v_quests,
    'quest_reward', round(v_quest_reward,2),
    'week_total', round(v_week.earnings + v_quest_reward, 2),
    'history', v_history
  );
END;
$function$;
