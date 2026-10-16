-- R03 · La dirección que no llega: sale igual a Catcher por el punto del mapa,
-- y la cocina la puede pegar (Julio, 16/10, prioridad máxima).
--
-- cambia: public.resolve_dispatch · prueba: supabase/staging/sql/20261118_r03_direccion_incompleta_prueba.sql
--
-- POR QUÉ: desde el 02/09, ≈8 % de los Glovo de reparto propio llegan sin
-- calle. Glovo la manda en `delivery_address.label` y Glovo Bridge solo copia
-- los campos sueltos (street_name, floor_number…), que en esos pedidos vienen
-- a null. HubRise no guarda `label`: no hay de dónde recuperarla
-- (docs/reparto/R02_diagnostico_cancelaciones_20261016.md). Las coordenadas
-- sí llegan siempre (50 de 50), y el teléfono es el del cliente.
--
-- LO QUE HACE
--   1. Cuatro columnas nuevas en `sale`, todas nulas: la dirección que pega la
--      cocina (`delivery_address_fixed`, con cuándo y quién) y de dónde salió la
--      dirección con la que se mandó a Catcher (`delivery_address_origin`:
--      'plataforma' | 'punto_del_mapa' | 'pegada'). Lo que vino de la
--      plataforma (`delivery_address`, `raw_tab`) NO se toca: lo reescribe
--      `adapt_hubrise_order` en cada aviso, y una dirección pegada ahí se
--      perdería en el siguiente.
--   2. `resolve_dispatch`: el guard «sin dirección no se despacha» deja pasar
--      lo que tiene dirección pegada o punto del mapa. Solo para lo que no
--      tiene NI dirección NI coordenadas sigue diciendo que no. Es el único
--      cambio; lo demás está copiado de lo vigente en producción el 16/10
--      (md5 6315caeae752e60c4edc31c910a9e7d7).
--   3. `pedidos_sin_direccion(local, token)`: lo que alimenta el aviso rojo, en
--      la tablet (token del dispositivo: SOLO su local) y en el ordenador
--      (sesión: `kds_authorize`, la misma puerta que la alarma de reparto).
--   4. `fijar_direccion_entrega(pedido, texto, token)`: la cocina pega la
--      dirección. Misma doble puerta. Devuelve lo que dice `resolve_dispatch`
--      y si el pedido ya estaba en Catcher, para que la pantalla diga qué ha
--      pasado (regla 8).
--   5. `sale_coordenadas_de_entrega_by_token(token, pedido)`: el punto del mapa
--      para la tablet. Solo pedidos del local del dispositivo; el de sesión
--      (`sale_coordenadas_de_entrega`) sigue cerrado a `anon` (Julio, 16/10).
--
-- NO hace geocodificación inversa: eso va en `catcher-dispatch` (Mapbox, el
-- mismo MAPBOX_TOKEN que ya usa), y no se guarda: Mapbox no deja almacenar
-- los resultados del geocodificador temporal.
--
-- Vuelta atrás: supabase/vuelta-atras/20261118T0300_r03_direccion_incompleta.down.sql

-- ── 1. Las columnas ─────────────────────────────────────────────────────────
alter table public.sale add column if not exists delivery_address_fixed    text;
alter table public.sale add column if not exists delivery_address_fixed_at timestamptz;
alter table public.sale add column if not exists delivery_address_fixed_by text;
alter table public.sale add column if not exists delivery_address_origin   text;

comment on column public.sale.delivery_address_fixed is
  'R03: la dirección que pega la cocina cuando la plataforma no la manda. Manda sobre delivery_address en catcher-dispatch. delivery_address y raw_tab se quedan como llegaron.';
comment on column public.sale.delivery_address_fixed_by is
  'R03: quién la pegó: «tablet · <etiqueta del dispositivo>» o el id del usuario.';
comment on column public.sale.delivery_address_origin is
  'R03: de dónde salió la dirección con la que se mandó a Catcher: plataforma, punto_del_mapa (sin calle: coordenadas + calle más cercana) o pegada.';

-- ── 2. resolve_dispatch: el guard de la dirección ───────────────────────────
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
         s.delivery_address, s.delivery_address_fixed
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

  v_rt := CASE WHEN left(btrim(coalesce(v_sale.raw_tab,'')),1)='{' THEN v_sale.raw_tab::jsonb ELSE '{}'::jsonb END;

  -- GUARD (31/08 · R03 16/10): SIN DÓNDE IR NO SE DESPACHA. Desde el R03, «dónde
  -- ir» es la dirección que mandó la plataforma, la que pegó la cocina o, si no
  -- hay ninguna, el PUNTO DEL MAPA: catcher-dispatch lo manda con la calle más
  -- cercana y la nota «Dirección incompleta: llamar al cliente». Solo lo que no
  -- trae ni dirección ni coordenadas se queda sin despachar.
  IF coalesce(btrim(v_sale.delivery_address_fixed), '') = ''
     AND coalesce(btrim(v_sale.delivery_address), '') = ''
     AND (coalesce(nullif(v_rt->'customer'->>'latitude',''), nullif(v_rt->'delivery'->>'latitude','')) IS NULL
          OR coalesce(nullif(v_rt->'customer'->>'longitude',''), nullif(v_rt->'delivery'->>'longitude','')) IS NULL)
  THEN
    RETURN QUERY SELECT NULL::text,
      'la dirección no ha llegado y tampoco el punto del mapa: no se puede despachar'::text;
    RETURN;
  END IF;

  SELECT coalesce(l.dispatch_mode,'auto'), coalesce(l.dispatch_broker,'catcher'), l.lat, l.lng
    INTO v_mode, v_broker, v_llat, v_llng
    FROM public.locations l WHERE l.id = v_sale.location_id;
  v_broker := coalesce(v_broker,'catcher');

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

-- ── 3. Lo que alimenta el aviso ─────────────────────────────────────────────
-- Un pedido de reparto propio, vivo, sin dirección (ni de la plataforma ni
-- pegada). Con token: SOLO el local del dispositivo. Sin token: sesión con
-- acceso al local (kds_authorize, como kds_alarms).
create or replace function public.pedidos_sin_direccion(p_location_id uuid, p_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_loc    uuid;
  v_result jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'pedidos_sin_direccion: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
  else
    if p_location_id is null then raise exception 'pedidos_sin_direccion: falta location_id'; end if;
    v_loc := p_location_id;
    perform public.kds_authorize(v_loc, null);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sold_at), '[]'::jsonb)
    into v_result
    from (
      select s.id                                   as sale_id,
             s.sold_at,
             coalesce(s.pos_short_code, s.platform_order_code, s.external_ref) as code,
             s.platform_order_ref,
             s.external_channel_text                as channel,
             b.name                                 as brand,
             (case when left(btrim(coalesce(s.raw_tab,'')),1)='{'
                   then coalesce(nullif(s.raw_tab::jsonb->'customer'->>'latitude',''),
                                 nullif(s.raw_tab::jsonb->'delivery'->>'latitude','')) end)::numeric  as lat,
             (case when left(btrim(coalesce(s.raw_tab,'')),1)='{'
                   then coalesce(nullif(s.raw_tab::jsonb->'customer'->>'longitude',''),
                                 nullif(s.raw_tab::jsonb->'delivery'->>'longitude','')) end)::numeric as lng,
             s.carrier_code,
             (s.carrier_order_id is not null)       as en_catcher,
             s.rider_name,
             s.rider_phone,
             s.dispatch_error
        from public.sale s
        left join public.brand b on b.id = s.brand_id
       where s.location_id = v_loc
         and s.service_type = 'own_delivery'
         and s.status = 'open'
         and coalesce(s.order_status, '') not in ('completed', 'cancelled', 'rejected', 'delivery_failed')
         and coalesce(s.delivery_state, '') not in ('delivered', 'completed')
         and coalesce(btrim(s.delivery_address), '') = ''
         and coalesce(btrim(s.delivery_address_fixed), '') = ''
         and s.sold_at > now() - interval '12 hours'
    ) x;

  return jsonb_build_object('location_id', v_loc, 'now', now(), 'pedidos', v_result);
end;
$function$;

comment on function public.pedidos_sin_direccion(uuid, text) is
  'R03: pedidos de reparto propio vivos sin dirección (ni de la plataforma ni pegada), para el aviso rojo de la cocina. Con token, solo el local del dispositivo.';
revoke all on function public.pedidos_sin_direccion(uuid, text) from public;
grant execute on function public.pedidos_sin_direccion(uuid, text) to anon, authenticated, service_role;

-- ── 4. La cocina pega la dirección ──────────────────────────────────────────
create or replace function public.fijar_direccion_entrega(p_sale_id uuid, p_direccion text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s       record;
  v_device  kds_device;
  v_texto   text := btrim(regexp_replace(coalesce(p_direccion, ''), '\s+', ' ', 'g'));
  v_por     text;
  v_carrier text;
  v_reason  text;
  v_mode    text;
begin
  select s.id, s.location_id, s.service_type, s.status, s.carrier_order_id, s.rider_name, s.rider_phone
    into v_s from public.sale s where s.id = p_sale_id;
  if v_s.id is null then raise exception 'fijar_direccion_entrega: el pedido no existe'; end if;

  perform public.kds_authorize(v_s.location_id, p_token);

  if v_s.service_type is distinct from 'own_delivery' then
    raise exception 'Este pedido no lo repartimos nosotros: no hace falta dirección.';
  end if;
  if v_s.status is distinct from 'open' then
    raise exception 'Este pedido ya está cerrado.';
  end if;
  if length(v_texto) < 6 then
    raise exception 'Falta la dirección: pega la calle, el número, el piso y el portal.';
  end if;
  if length(v_texto) > 300 then
    raise exception 'La dirección es demasiado larga (más de 300 letras).';
  end if;

  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    v_por := 'tablet · ' || coalesce(v_device.label, 'sin nombre');
  else
    v_por := coalesce(auth.uid()::text, 'sesión');
  end if;

  update public.sale
     set delivery_address_fixed    = v_texto,
         delivery_address_fixed_at = now(),
         delivery_address_fixed_by = v_por,
         updated_at                = now()
   where id = p_sale_id;

  select r.carrier, r.reason into v_carrier, v_reason from public.resolve_dispatch(p_sale_id) r;
  select coalesce(l.dispatch_mode, 'auto') into v_mode from public.locations l where l.id = v_s.location_id;

  return jsonb_build_object(
    'ok',            true,
    'sale_id',       p_sale_id,
    'direccion',     v_texto,
    'carrier',       v_carrier,
    'reason',        v_reason,
    'dispatch_mode', v_mode,
    -- Catcher ya tiene el pedido (salió por el punto del mapa): no se puede
    -- reenviar sin crear otro (no hay cambio ni anulación en su API). La
    -- pantalla lo dice y da el contacto del repartidor.
    'ya_en_catcher', v_s.carrier_order_id is not null,
    'rider_name',    v_s.rider_name,
    'rider_phone',   v_s.rider_phone);
end;
$function$;

comment on function public.fijar_direccion_entrega(uuid, text, text) is
  'R03: la cocina pega la dirección que no llegó. Guarda en delivery_address_fixed (lo de la plataforma no se toca) y devuelve lo que dice resolve_dispatch y si el pedido ya estaba en Catcher. Con token, solo pedidos del local del dispositivo (kds_authorize).';
revoke all on function public.fijar_direccion_entrega(uuid, text, text) from public;
grant execute on function public.fijar_direccion_entrega(uuid, text, text) to anon, authenticated, service_role;

-- ── 5. El punto del mapa, para la tablet ────────────────────────────────────
create or replace function public.sale_coordenadas_de_entrega_by_token(p_device_token text, p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_s      record;
  v_rt     jsonb;
  v_lat    numeric;
  v_lng    numeric;
  v_org    text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'sale_coordenadas_de_entrega_by_token: token de dispositivo no válido';
  end if;

  select s.location_id, s.raw_tab, s.delivery_address, s.delivery_address_fixed
    into v_s from public.sale s where s.id = p_sale_id;
  -- Un pedido de otro local se trata igual que uno que no existe: la tablet no
  -- sabe ni que está ahí.
  if v_s.location_id is null or v_s.location_id <> v_device.location_id then
    raise exception 'sale_coordenadas_de_entrega_by_token: ese pedido no es de este local';
  end if;

  v_rt := case when left(btrim(coalesce(v_s.raw_tab, '')), 1) = '{'
               then v_s.raw_tab::jsonb else '{}'::jsonb end;
  v_lat := nullif(v_rt->'delivery'->>'latitude', '')::numeric;
  v_lng := nullif(v_rt->'delivery'->>'longitude', '')::numeric;
  v_org := 'delivery';
  if v_lat is null or v_lng is null then
    v_lat := nullif(v_rt->'customer'->>'latitude', '')::numeric;
    v_lng := nullif(v_rt->'customer'->>'longitude', '')::numeric;
    v_org := 'customer';
  end if;

  if v_lat is null or v_lng is null then
    return jsonb_build_object('hay', false, 'motivo', 'la plataforma tampoco ha enviado coordenadas',
      'direccion', nullif(coalesce(nullif(btrim(v_s.delivery_address_fixed), ''), btrim(v_s.delivery_address)), ''));
  end if;

  return jsonb_build_object(
    'hay', true, 'lat', v_lat, 'lng', v_lng, 'origen', v_org, 'aproximada', true,
    'tiene_direccion_postal', coalesce(btrim(v_s.delivery_address), '') <> ''
                              or coalesce(btrim(v_s.delivery_address_fixed), '') <> '',
    'direccion', nullif(coalesce(nullif(btrim(v_s.delivery_address_fixed), ''), btrim(v_s.delivery_address)), ''));
end;
$function$;

comment on function public.sale_coordenadas_de_entrega_by_token(text, uuid) is
  'R03: el punto del mapa y la dirección de un pedido, para la tablet. SOLO pedidos del local del dispositivo; uno de otro local da error como si no existiera. sale_coordenadas_de_entrega (sesión) sigue cerrada a anon.';
revoke all on function public.sale_coordenadas_de_entrega_by_token(text, uuid) from public;
grant execute on function public.sale_coordenadas_de_entrega_by_token(text, uuid) to anon, authenticated, service_role;

-- ── Comprobación al aplicar ─────────────────────────────────────────────────
do $verif$
begin
  if has_function_privilege('anon', 'public.sale_coordenadas_de_entrega(uuid)', 'EXECUTE') then
    raise exception 'R03: sale_coordenadas_de_entrega abierta a anon (no debe).';
  end if;
  if (select count(*) from pg_proc where proname = 'resolve_dispatch' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'R03: resolve_dispatch tiene más de una firma.';
  end if;
end
$verif$;
