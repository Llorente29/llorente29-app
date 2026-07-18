-- supabase/migrations/20260718T1300_reparto_dispatcher.sql
-- T2 — Cerebro dispatcher: resolve_dispatch + tg_auto_dispatch generalizado.
-- RETROCOMPATIBLE: sin dispatch_rule ni courier en turno, el resultado es
-- idéntico al de hoy (Catcher). La rama de Catcher va copiada literal.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_dispatch(p_sale_id uuid)
RETURNS TABLE(carrier text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sale   record;
  v_mode   text;
  v_broker text;
  v_rule   record;
  v_now    timestamptz := now();
  v_dow    int;
  v_time   time;
  v_avail  int;
BEGIN
  SELECT s.account_id, s.location_id, s.total, s.service_type
    INTO v_sale FROM public.sale s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'venta no encontrada'::text; RETURN;
  END IF;

  SELECT coalesce(l.dispatch_mode,'auto'), coalesce(l.dispatch_broker,'catcher')
    INTO v_mode, v_broker FROM public.locations l WHERE l.id = v_sale.location_id;
  v_broker := coalesce(v_broker,'catcher');

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
    RETURN QUERY SELECT v_broker, ('sin regla → broker por defecto ('||v_broker||')')::text; RETURN;
  END IF;

  IF v_rule.then_carrier = 'own_fleet' THEN
    SELECT count(*) INTO v_avail
    FROM public.courier c
    WHERE c.account_id = v_sale.account_id
      AND c.active AND c.on_shift
      AND (c.assigned_locations = '{}'::uuid[] OR v_sale.location_id = ANY(c.assigned_locations));
    IF v_avail > 0 THEN
      RETURN QUERY SELECT 'own_fleet'::text,
        ('regla '||v_rule.priority||' → propio ('||v_avail||' en turno)')::text; RETURN;
    ELSE
      RETURN QUERY SELECT coalesce(v_rule.fallback_carrier, v_broker),
        ('regla '||v_rule.priority||' → propio sin repartidor; fallback '||coalesce(v_rule.fallback_carrier, v_broker))::text; RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT v_rule.then_carrier,
    ('regla '||v_rule.priority||' → '||v_rule.then_carrier)::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_auto_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_mode    text;
  v_carrier text;
  v_reason  text;
  v_secret  text := 'fv_catdisp_tnrMMcaI8gALFCitfvzPGsaHgQa3A83w';
  v_url     text := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-dispatch';
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
    IF v_mode <> 'auto' THEN
      RETURN new;
    END IF;

    SELECT carrier, reason INTO v_carrier, v_reason
      FROM public.resolve_dispatch(new.id);

    IF v_carrier = 'own_fleet' THEN
      INSERT INTO public.delivery_assignment (sale_id, account_id, location_id, state, assigned_by)
      VALUES (new.id, new.account_id, new.location_id, 'offered', 'auto');
    ELSIF v_carrier = 'catcher' THEN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',              'application/json',
          'x-catcher-dispatch-secret', v_secret
        ),
        body    := jsonb_build_object('sale_id', new.id, 'internal', true)
      );
    END IF;
  END IF;
  RETURN new;
END;
$$;

COMMIT;
