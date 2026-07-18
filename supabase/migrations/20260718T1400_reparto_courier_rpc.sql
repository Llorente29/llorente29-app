-- supabase/migrations/20260718T1400_reparto_courier_rpc.sql
-- T3a — App del repartidor: RPC por token (sesión, feed, turno, reclamar, avanzar, GPS).
-- Patrón by-token como la Estación (sin sesión auth; el token ES la credencial).

BEGIN;

ALTER TABLE public.courier
  ALTER COLUMN access_token SET DEFAULT ('cour_' || replace(gen_random_uuid()::text,'-',''));
UPDATE public.courier SET access_token = ('cour_' || replace(gen_random_uuid()::text,'-',''))
  WHERE access_token IS NULL;

CREATE OR REPLACE FUNCTION public._courier_by_token(p_token text)
RETURNS public.courier LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier;
BEGIN
  SELECT * INTO c FROM public.courier WHERE access_token = p_token AND active LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token de repartidor no válido' USING errcode = '28000';
  END IF;
  RETURN c;
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_session_by_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier;
BEGIN
  c := public._courier_by_token(p_token);
  RETURN jsonb_build_object(
    'courier_id', c.id, 'name', c.name, 'phone', c.phone,
    'kind', c.kind, 'transport_type', c.transport_type,
    'on_shift', c.on_shift, 'account_id', c.account_id,
    'assigned_locations', to_jsonb(c.assigned_locations)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_set_shift_by_token(p_token text, p_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier;
BEGIN
  c := public._courier_by_token(p_token);
  UPDATE public.courier SET on_shift = p_on WHERE id = c.id;
  RETURN jsonb_build_object('on_shift', p_on);
END;
$$;

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
        'delivery_lat',     NULLIF(j.rt->'delivery'->>'latitude','')::numeric,
        'delivery_lng',     NULLIF(j.rt->'delivery'->>'longitude','')::numeric,
        'pickup_name',      l.name,
        'pickup_address',   l.address,
        'pickup_lat',       l.lat,
        'pickup_lng',       l.lng,
        'offered_at',       da.offered_at
      ) AS item
    FROM public.delivery_assignment da
    JOIN public.sale s      ON s.id = da.sale_id
    LEFT JOIN public.brand b ON b.id = s.brand_id
    LEFT JOIN public.locations l ON l.id = da.location_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN left(btrim(coalesce(s.raw_tab,'')),1) = '{' THEN s.raw_tab::jsonb ELSE '{}'::jsonb END AS rt
    ) j
    WHERE da.account_id = c.account_id
      AND (
        (da.courier_id = c.id AND da.state IN ('accepted','picked_up','in_delivery'))
        OR
        (da.courier_id IS NULL AND da.state = 'offered'
          AND (c.assigned_locations = '{}'::uuid[] OR da.location_id = ANY(c.assigned_locations)))
      )
  ) t;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_claim_by_token(p_token text, p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier; v_cost numeric; v_upd uuid;
BEGIN
  c := public._courier_by_token(p_token);
  IF NOT c.on_shift THEN
    RAISE EXCEPTION 'ponte en turno para aceptar pedidos';
  END IF;
  v_cost := CASE WHEN c.cost_model = 'per_order' THEN c.cost_value ELSE 0 END;

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
  RETURN jsonb_build_object('assignment_id', v_upd, 'state', 'accepted');
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_advance_by_token(
  p_token text, p_assignment_id uuid, p_state text,
  p_note text DEFAULT NULL, p_proof_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier; a public.delivery_assignment;
BEGIN
  c := public._courier_by_token(p_token);
  SELECT * INTO a FROM public.delivery_assignment WHERE id = p_assignment_id;
  IF NOT FOUND OR a.courier_id IS DISTINCT FROM c.id THEN
    RAISE EXCEPTION 'este pedido no es tuyo';
  END IF;
  IF p_state NOT IN ('picked_up','in_delivery','delivered','failed','canceled') THEN
    RAISE EXCEPTION 'estado no válido: %', p_state;
  END IF;

  UPDATE public.delivery_assignment SET
    state          = p_state,
    picked_up_at   = CASE WHEN p_state = 'picked_up'   THEN now() ELSE picked_up_at END,
    in_delivery_at = CASE WHEN p_state = 'in_delivery' THEN now() ELSE in_delivery_at END,
    delivered_at   = CASE WHEN p_state = 'delivered'   THEN now() ELSE delivered_at END,
    failed_at      = CASE WHEN p_state IN ('failed','canceled') THEN now() ELSE failed_at END,
    failed_reason  = CASE WHEN p_state IN ('failed','canceled') THEN coalesce(p_note, failed_reason) ELSE failed_reason END,
    proof_note     = coalesce(p_note, proof_note),
    proof_url      = coalesce(p_proof_url, proof_url),
    proof_type     = CASE WHEN p_proof_url IS NOT NULL THEN 'photo' ELSE proof_type END
  WHERE id = p_assignment_id;

  IF p_state = 'delivered' THEN
    UPDATE public.sale SET order_status = 'completed'
     WHERE id = a.sale_id AND order_status NOT IN ('completed','cancelled','rejected');
  END IF;

  RETURN jsonb_build_object('assignment_id', p_assignment_id, 'state', p_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.courier_ping_by_token(p_token text, p_lat numeric, p_lng numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.courier;
BEGIN
  c := public._courier_by_token(p_token);
  UPDATE public.courier SET last_lat = p_lat, last_lng = p_lng, last_seen_at = now() WHERE id = c.id;
  UPDATE public.sale s SET rider_lat = p_lat, rider_lng = p_lng, rider_seen_at = now()
   WHERE s.id IN (
     SELECT da.sale_id FROM public.delivery_assignment da
     WHERE da.courier_id = c.id AND da.state IN ('accepted','picked_up','in_delivery'));
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.courier_session_by_token(text),
  public.courier_set_shift_by_token(text, boolean),
  public.courier_feed_by_token(text),
  public.courier_claim_by_token(text, uuid),
  public.courier_advance_by_token(text, uuid, text, text, text),
  public.courier_ping_by_token(text, numeric, numeric)
TO anon, authenticated;

COMMIT;
