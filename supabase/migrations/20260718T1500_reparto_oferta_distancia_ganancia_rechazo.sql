-- supabase/migrations/20260718T1500_reparto_oferta_distancia_ganancia_rechazo.sql
-- T3b.2 — Oferta: distancia + ganancia (autónomo) + rechazar por repartidor.

BEGIN;

ALTER TABLE public.delivery_assignment
  ADD COLUMN IF NOT EXISTS declined_by uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.courier_feed_by_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
        'payout',           CASE
                              WHEN c.cost_model = 'per_order' THEN c.cost_value
                              WHEN c.cost_model = 'per_km' AND dk.dist_km IS NOT NULL
                                THEN round((c.cost_value * dk.dist_km)::numeric, 2)
                              ELSE NULL END,
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
$$;

CREATE OR REPLACE FUNCTION public.courier_decline_by_token(p_token text, p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier;
BEGIN
  c := public._courier_by_token(p_token);
  UPDATE public.delivery_assignment
     SET declined_by = array_append(coalesce(declined_by, '{}'::uuid[]), c.id)
   WHERE id = p_assignment_id
     AND state = 'offered'
     AND courier_id IS NULL
     AND account_id = c.account_id
     AND NOT (c.id = ANY(coalesce(declined_by, '{}'::uuid[])));
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.courier_decline_by_token(text, uuid) TO anon, authenticated;

COMMIT;
