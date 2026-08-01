-- 20260801T1800_dispatch_guard_marca_reparto_propio.sql
-- Aplicada: 2026-08-01 (a mano por SQL Editor; la BD ya está en este estado = REGISTRO).
--
-- DEFECTO CORREGIDO: pedidos de marcas cedidas (ownership_type='licensed') se
-- despachaban a Catcher/flota propia porque resolve_dispatch() no miraba la marca.
-- Ejemplo real: Dos Coyotes (cedida) con 18 pedidos despachados a Catcher por error.
-- Saneamiento: 0 pedidos cedidos en vuelo. Dos Coyotes: 18 pedidos históricos
-- despachados por error (todos entregados/cancelados). Corregido hacia adelante.
--
-- SOLUCIÓN (dos piezas):
--
-- 1) brand += own_delivery_enabled boolean (nullable).
--    NULL → deriva de ownership_type (propia=on, cedida=off).
--    Editable por marca: cedida se puede encender el día que se negocie reparto propio.
--
-- 2) resolve_dispatch(p_sale_id) += guard al principio:
--    Trae brand_id de la venta. Calcula interruptor efectivo:
--      coalesce(brand.own_delivery_enabled, brand.ownership_type = 'own')
--    Si apagado → devuelve (NULL, 'marca sin reparto propio (interruptor apagado)')
--    → el trigger no despacha ni a flota ni a Catcher.
--
-- VERIFICADO EN VIVO:
--   Dos Coyotes (cedida) → NULL, 'marca sin reparto propio' ✓
--   Milanesa House (propia) → catcher, broker por defecto ✓

-- (1) Columna
alter table brand
  add column if not exists own_delivery_enabled boolean;

-- (2) resolve_dispatch — cuerpo LITERAL de pg_get_functiondef del vivo 2026-08-01
CREATE OR REPLACE FUNCTION public.resolve_dispatch(p_sale_id uuid)
 RETURNS TABLE(carrier text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  v_brand_enabled boolean;
BEGIN
  SELECT s.account_id, s.location_id, s.brand_id, s.total, s.service_type, s.raw_tab
    INTO v_sale FROM public.sale s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'venta no encontrada'::text; RETURN;
  END IF;

  -- GUARD: interruptor de reparto propio por marca.
  -- own_delivery_enabled NULL → deriva de ownership_type (propia=on, cedida=off).
  -- Si está apagado → no despacha a nadie (ni flota ni Catcher). Corta aquí.
  IF v_sale.brand_id IS NOT NULL THEN
    SELECT coalesce(b.own_delivery_enabled, b.ownership_type = 'own')
      INTO v_brand_enabled
      FROM public.brand b WHERE b.id = v_sale.brand_id;
    IF v_brand_enabled IS NOT TRUE THEN
      RETURN QUERY SELECT NULL::text, 'marca sin reparto propio (interruptor apagado)'::text;
      RETURN;
    END IF;
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
