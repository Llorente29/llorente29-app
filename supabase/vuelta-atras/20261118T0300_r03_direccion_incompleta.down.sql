-- supabase/vuelta-atras/20261118T0300_r03_direccion_incompleta.down.sql
--
-- Vuelta atrás de 20261118T0300_r03_direccion_incompleta: resolve_dispatch como
-- estaba (vigente en producción el 16/10, md5 6315caeae752e60c4edc31c910a9e7d7;
-- la comprobación de abajo lo mide), y fuera las tres funciones nuevas y las
-- cuatro columnas.
-- Las columnas se quitan solo si no hay ninguna dirección pegada: una dirección
-- que pegó la cocina es un dato, y no se tira sin que alguien lo decida. Si la
-- hay, para sin tocar nada.

do $$
begin
  if exists (select 1 from public.sale where delivery_address_fixed is not null) then
    raise exception 'Vuelta atrás R03: hay direcciones pegadas por la cocina (sale.delivery_address_fixed). No se toca nada.';
  end if;
end $$;

drop function if exists public.pedidos_sin_direccion(uuid, text);
drop function if exists public.fijar_direccion_entrega(uuid, text, text);
drop function if exists public.sale_coordenadas_de_entrega_by_token(text, uuid);

create or replace function public.resolve_dispatch(p_sale_id uuid)
 returns table(carrier text, reason text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  SELECT s.account_id, s.location_id, s.brand_id, s.total, s.service_type, s.raw_tab,
         s.delivery_address
    INTO v_sale FROM public.sale s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'venta no encontrada'::text; RETURN;
  END IF;

  -- GUARD (R02, 05/10): QUIÉN REPARTE YA ESTÁ DECIDIDO.
  -- Antes aquí se miraba el interruptor por marca, que valía para todas las
  -- plataformas a la vez y no cabía en la realidad
  -- (Smash: Glovo reparte Glovo, Uber repartimos nosotros). Ahora lo decide
  -- resolve_delivery_by al ENTRAR el pedido y queda escrito en su
  -- service_type. Aquí solo se respeta: si no es own_delivery, no se despacha.
  -- Así cambiar una celda en «Quién reparte» no toca pedidos ya abiertos.
  IF v_sale.service_type IS DISTINCT FROM 'own_delivery' THEN
    RETURN QUERY SELECT NULL::text, 'la reparte la plataforma: no se despacha'::text;
    RETURN;
  END IF;

  -- GUARD (31/08): SIN DIRECCION NO SE DESPACHA. Condicion previa, antes de
  -- mirar reglas, distancias o repartidores. No se puede repartir lo que no se
  -- sabe donde va. En la cocina es la etiqueta ámbar «Nosotros · falta la
  -- dirección» (R02), no una alarma.
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
$function$;

alter table public.sale drop column if exists delivery_address_fixed;
alter table public.sale drop column if exists delivery_address_fixed_at;
alter table public.sale drop column if exists delivery_address_fixed_by;
alter table public.sale drop column if exists delivery_address_origin;

do $verif$
begin
  if md5(pg_get_functiondef('public.resolve_dispatch(uuid)'::regprocedure)) <> '6315caeae752e60c4edc31c910a9e7d7' then
    raise exception 'Vuelta atrás R03: resolve_dispatch no ha quedado como estaba (md5 distinto).';
  end if;
end
$verif$;
