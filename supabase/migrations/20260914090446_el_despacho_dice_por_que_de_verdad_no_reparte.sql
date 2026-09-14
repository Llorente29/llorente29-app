-- ═══════════════════════════════════════════════════════════════════════════
-- EL DESPACHO DICE POR QUÉ DE VERDAD NO REPARTE
-- 14/09/2026 · Foodint 51ad1792-6629-4ef7-833a-b57b09a86710
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Sólo cambian DOS FRASES. Ni una rama de decisión: quien no repartía sigue
-- sin repartir y quien repartía sigue igual. El ensayo lo comprueba por los
-- tres caminos, con ventas reales.
--
-- ── LO QUE SE MIDIÓ ANTES DE TOCAR NADA ───────────────────────────────────
--
-- 484 ventas de reparto propio en 30 días. 407 despachadas, 77 sin despachar,
-- 74 con un motivo escrito en `dispatch_error`. Repartidos por clase:
--
--   Auto-despacho SIN CONFIRMAR: sin rider tras 8 min   25   15/08 → 21/08
--   Catcher no está conectado en este local             11   21/08 → 25/08
--   HubRise sin coordenadas                             10   28/08 → 31/08
--   Enviado a Catcher, sin rider tras 8 min              9   27/08 → 31/08
--   marca sin reparto propio (interruptor apagado)       8   01/09 → 13/09
--   HubRise sin coordenadas (variante)                   7   28/08 → 31/08
--   sin dirección de entrega: no la ha enviado           3   05/09 → 11/09
--   sin dirección: este pedido no lo repartimos          1   05/09
--
-- SESENTA Y DOS de los 74 son un montón histórico que se acabó el 31/08. Lo
-- que sigue vivo en septiembre son DOCE, y de ésos ocho no son averías: son
-- decisiones. Las dos pantallas ya las filtran por la marca y no por el texto
-- --lo dice el comentario de `needsDispatch` desde el 05/09--, así que a nadie
-- se le pide que arregle algo que funciona.
--
-- ── 🔴 PERO EL MOTIVO QUE SE GUARDA ES FALSO EN LA MAYORÍA ────────────────
--
-- `resolve_dispatch` devolvía SIEMPRE «marca sin reparto propio (interruptor
-- apagado)». Y el interruptor sólo está apagado en una parte de los casos:
--
--   Dos Coyotes           cedida · own_delivery_enabled SIN PONER · 5 ventas
--   Smash Brothers        propia · own_delivery_enabled = false   · 3 ventas
--
-- Cuando `own_delivery_enabled` es NULL, el reparto lo decide el TIPO DE
-- MARCA: `marca_reparte_propio` deriva propia = sí, cedida = no. Nadie ha
-- apagado nada. Decirle a quien lo lea que hay un interruptor apagado lo manda
-- a buscar un interruptor que en ese caso no existe, y si lo encuentra y lo
-- enciende, le pone reparto propio a una marca que no repartimos.
--
-- Es la misma familia de todo lo de hoy: la pantalla --o el registro-- afirma
-- una causa que no ha comprobado.
--
-- ── LO QUE NO TOCA ESTA PIEZA, Y VA AL PARTE ──────────────────────────────
--
-- · `dispatch_error` sigue guardando decisiones y averías en la misma columna.
--   Las dos pantallas se defienden filtrando por la marca, pero cada pantalla
--   nueva tiene que acordarse. Lo suyo sería una clase sellada, como el
--   `error_kind` de `social_post`. No se hace aquí porque no se pidió.
-- · Las 3 «sin dirección de entrega» SÍ son de verdad, y la pantalla ya tiene
--   su cartel desde el 05/09 (B68).
--
-- ── LA BANDA ──────────────────────────────────────────────────────────────
-- `resolve_dispatch` SÍ está en el camino del pedido --la llama
-- `tg_auto_dispatch` en cada venta de reparto propio--, pero un
-- `create or replace` de función no toma cierre exclusivo sobre ninguna tabla.
-- Aplicada a las 11:40 de la mañana, fuera de la banda por delante.
-- Y medido antes: 0 funciones miran ese literal.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_dispatch(p_sale_id uuid)
RETURNS TABLE(carrier text, reason text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
  v_sin_poner boolean;
BEGIN
  SELECT s.account_id, s.location_id, s.brand_id, s.total, s.service_type, s.raw_tab,
         s.delivery_address
    INTO v_sale FROM public.sale s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'venta no encontrada'::text; RETURN;
  END IF;

  -- GUARD: interruptor de reparto propio por marca.
  -- own_delivery_enabled NULL → deriva de ownership_type (propia=on, cedida=off).
  -- Si está apagado → no despacha a nadie (ni flota ni Catcher). Corta aquí.
  IF v_sale.brand_id IS NOT NULL THEN
    SELECT public.marca_reparte_propio(b), (b.own_delivery_enabled IS NULL)
      INTO v_brand_enabled, v_sin_poner
      FROM public.brand b WHERE b.id = v_sale.brand_id;
    IF v_brand_enabled IS NOT TRUE THEN
      -- 🔴 EL MOTIVO DE VERDAD, NO UNO INVENTADO (14/09).
      --
      -- Aqui se devolvia SIEMPRE «marca sin reparto propio (interruptor
      -- apagado)», y eso es falso en la mayoria de los casos. Cuando
      -- `own_delivery_enabled` esta SIN PONER, el reparto se decide por el
      -- TIPO DE MARCA --cedida = no la repartimos nosotros-- y nadie ha
      -- apagado ningun interruptor.
      --
      -- Medido el 14/09 sobre las 8 de septiembre: 5 son Dos Coyotes (cedida,
      -- sin poner: nadie toco nada) y 3 son Smash Brothers Burgers (propia,
      -- apagada a mano de verdad). El mismo texto para las dos cosas manda a
      -- quien lo lea a buscar un interruptor que en un caso no existe.
      RETURN QUERY SELECT NULL::text,
        CASE WHEN v_sin_poner
          THEN 'esta marca no la repartimos nosotros: es cedida y no tiene reparto propio'
          ELSE 'el reparto propio de esta marca esta apagado' END;
      RETURN;
    END IF;
  END IF;

  -- GUARD NUEVO (31/08): SIN DIRECCION NO SE DESPACHA. Condicion previa, antes
  -- de mirar reglas, distancias o repartidores. No se puede repartir lo que no
  -- se sabe donde va, y en Glovo la ausencia de direccion es justamente la
  -- señal de que reparte la plataforma.
  IF coalesce(btrim(v_sale.delivery_address), '') = '' THEN
    RETURN QUERY SELECT NULL::text,
      'sin dirección de entrega: la plataforma no la ha enviado'::text;
    RETURN;
  END IF;

  SELECT coalesce(l.dispatch_mode,'auto'), coalesce(l.dispatch_broker,'catcher'), l.lat, l.lng
    INTO v_mode, v_broker, v_llat, v_llng
    FROM public.locations l WHERE l.id = v_sale.location_id;
  v_broker := coalesce(v_broker,'catcher');

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
        CONTINUE;
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
    ELSE
      RETURN QUERY SELECT v_c, ('regla '||v_rule.priority||' -> '||v_c||' (cadena)')::text;
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_broker,
    ('regla '||v_rule.priority||' -> cadena agotada; broker por defecto ('||v_broker||')')::text;
END;
$fn$;
