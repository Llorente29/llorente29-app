-- ============================================================================
-- VUELTA ATRÁS de 20261005T0120_r02_lectores_de_la_resolucion.sql
-- ----------------------------------------------------------------------------
-- Devuelve las cinco funciones EXACTAMENTE como estaban en producción el
-- 04/10/2026 (copiadas de pg_proc de producción, solo lectura): vuelven a
-- leer el interruptor por marca (brand.own_delivery_enabled) y la herencia
-- por tipo de marca. Mismas firmas: CREATE OR REPLACE, nada se borra.
--
-- ORDEN: si ya se aplicó la eliminación del interruptor (0200), su vuelta
-- atrás va ANTES que esta (vuelve a poner la columna). La guarda lo comprueba.
-- Las filas de brand_delivery_policy se quedan (no las lee nadie después de
-- esto); las quita, si se quiere, la vuelta atrás de la 0100.
-- ============================================================================

\ir 20261005T0120_r02_lectores_de_la_resolucion.down.guarda.sql

-- ── 1. El disparador de entrada, como estaba ───────────────────────────────
create or replace function public.tg_sale_service_type_por_interruptor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_apagado boolean;
begin
  if new.brand_id is null then return new; end if;
  if coalesce(new.source, '') <> 'hubrise' then return new; end if;
  if new.service_type is distinct from 'own_delivery' then return new; end if;

  -- CONDICION 2: sin direccion. Con direccion no se toca — ver arriba.
  if coalesce(btrim(new.delivery_address), '') <> '' then return new; end if;

  select b.own_delivery_enabled is false
    into v_apagado
    from public.brand b
   where b.id = new.brand_id;

  if v_apagado then
    new.service_type := 'platform_delivery';
  end if;
  return new;
end;
$function$;

-- ── 2. resolve_dispatch, como estaba ───────────────────────────────────────
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
$function$;

-- ── 3. El vigía, como estaba ───────────────────────────────────────────────
create or replace function public.dispatch_watchdog_scan(p_grace_minutes integer default 8)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_row   record;
  v_carrier text;
  v_reason  text;
begin
  for v_row in
    select s.id, s.dispatch_error
      from public.sale s
      join public.locations l on l.id = s.location_id
     where s.service_type = 'own_delivery'
       and coalesce(l.dispatch_mode,'auto') = 'auto'
       and s.order_status in ('accepted','in_preparation','awaiting_collection')
       and s.carrier_order_id is null
       and s.delivery_alarm_at is null
       and s.created_at > now() - interval '24 hours'
       and now() - coalesce(s.accepted_at, s.created_at) > make_interval(mins => greatest(p_grace_minutes,1))
       and not exists (
         select 1 from public.delivery_assignment da
          where da.sale_id = s.id and da.state not in ('failed','canceled'))
  loop
    select carrier, reason into v_carrier, v_reason
      from public.resolve_dispatch(v_row.id);

    if v_carrier is null then
      -- NO SE ENVIO. El guard hizo su trabajo. Se marca para que se vea, pero
      -- con el motivo REAL y sin decir «enviado»: afirmar un envio que no pasó
      -- es lo que hizo creer durante 20 dias que el interruptor no se leia.
      update public.sale s
         set delivery_alarm_at    = now(),
             delivery_alarm_kind   = 'no_despachado',
             delivery_alarm_ack_at = null,
             dispatch_error        = 'No se despachó: ' || coalesce(v_reason, 'sin motivo del resolutor'),
             updated_at            = now()
       where s.id = v_row.id;
    else
      update public.sale s
         set delivery_alarm_at    = now(),
             delivery_alarm_kind   = 'no_rider',
             delivery_alarm_ack_at = null,
             dispatch_error        = case
               when s.dispatch_error is not null and btrim(s.dispatch_error) <> ''
                 then 'No se pudo enviar a Catcher: ' || s.dispatch_error
               else 'Enviado a Catcher, sin rider tras ' || p_grace_minutes || ' min. Revisar/despachar a mano.'
             end,
             updated_at            = now()
       where s.id = v_row.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- ── 4. La métrica, como estaba ─────────────────────────────────────────────
create or replace function public.metrica_direcciones_de_reparto(p_account_id uuid, p_dias integer default 30)
returns table(reparto text, marca text, pasarela text, canal text, pedidos bigint, sin_direccion bigint, sin_direccion_pct numeric, con_coordenadas bigint, coords_en_delivery bigint, coords_en_customer bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  -- service_role (informes, cron) pasa; un usuario tiene que ser de la cuenta.
  if current_setting('request.jwt.claims', true) is not null
     and not public.belongs_to_account(p_account_id) then
    raise exception 'metrica_direcciones_de_reparto: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with base as (
    select
      -- EJE 1, quien reparte. NULL = no declarado = se asume que nosotros.
      -- Ver la nota de arriba: para las 9 licenciadas eso es falso hoy.
      case when coalesce(b.own_delivery_enabled, true)
           then 'nosotros' else 'plataforma' end as reparto,
      -- EJE 2, de quien es la marca. Nada que ver con el anterior.
      case b.ownership_type
           when 'own'      then 'propia'
           when 'licensed' then 'licenciada'
           when null       then 'sin marca'
           else coalesce(b.ownership_type, 'sin marca')
      end as marca,
      coalesce(s.source, '(sin source)') as pasarela,
      coalesce(nullif(btrim(s.external_channel_text), ''), '(sin canal)') as canal,
      coalesce(btrim(s.delivery_address), '') = '' as sin_dir,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'delivery'->>'latitude', '') end as lat_delivery,
      case when left(btrim(coalesce(s.raw_tab, '')), 1) = '{'
           then nullif(s.raw_tab::jsonb->'customer'->>'latitude', '') end as lat_customer
    from public.sale s
    left join public.brand b on b.id = s.brand_id
    where s.account_id = p_account_id
      and s.service_type = 'own_delivery'
      and s.created_at > now() - make_interval(days => greatest(1, p_dias))
  )
  select
    b.reparto,
    b.marca,
    b.pasarela,
    b.canal,
    count(*),
    count(*) filter (where b.sin_dir),
    round(100.0 * count(*) filter (where b.sin_dir) / nullif(count(*), 0), 1),
    count(*) filter (where b.sin_dir and coalesce(b.lat_delivery, b.lat_customer) is not null),
    count(*) filter (where b.lat_delivery is not null),
    count(*) filter (where b.lat_customer is not null)
  from base b
  group by b.reparto, b.marca, b.pasarela, b.canal
  -- Lo que repartimos primero; dentro, lo que mas falla. El criterio ORDENA.
  order by case when b.reparto = 'nosotros' then 0 else 1 end,
           count(*) filter (where b.sin_dir) desc,
           count(*) desc;
end;
$function$;

-- ── 5. La rejilla de precios, como estaba ──────────────────────────────────
create or replace function public.brand_price_grid(p_brand_id uuid, p_location_id uuid default null::uuid, p_overrides jsonb default null::jsonb)
returns table(menu_item_id uuid, menu_item_name text, category_id uuid, category_name text, product_type text, base_price numeric, channel_id uuid, channel_name text, channel_type text, service_type text, price numeric, price_source text, is_location_override boolean, is_available boolean, vat_rate numeric, cost_available boolean, net_margin numeric, net_margin_pct numeric, contribution_margin_pct numeric, channel_orders_30d integer, policy_allowed boolean, policy_reason text)
language sql
stable
set search_path to 'public'
as $function$
  with marca as (
    select b.id, b.account_id, coalesce(b.ownership_type, 'own') as ownership_type
    from brand b where b.id = p_brand_id
  ),
  productos as (
    select mi.id, mi.name, mi.menu_category_id, mi.product_type, mi.price
    from menu_item mi, marca m
    where mi.brand_id = m.id
      and mi.account_id = m.account_id
      and mi.is_active is not false
  ),
  uso_30d as (
    select s.channel_id, s.service_type, count(*)::integer as n
    from sale s, marca m
    where s.account_id = m.account_id
      and s.created_at >= now() - interval '30 days'
    group by s.channel_id, s.service_type
  )
  select
    p.id, p.name, p.menu_category_id, mc.name, p.product_type, p.price,
    e.channel_id, e.channel_name, e.channel_type, e.service_type,
    e.price, e.price_source, e.is_location_override, e.is_available, e.vat_rate,
    e.cost_available, e.net_margin, e.net_margin_pct, e.contribution_margin_pct,
    coalesce(u.n, 0),
    case
      when e.channel_type <> 'delivery' then true
      when e.service_type is null or e.service_type = 'pickup' then true
      else exists (
        select 1
        from channel_delivery_policy pol
        join sales_channel sc
          on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id
          and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type
          and pol.service_type = e.service_type)
    end,
    case
      when e.channel_type <> 'delivery' then null
      when e.service_type is null or e.service_type = 'pickup' then null
      when exists (
        select 1 from channel_delivery_policy pol
        join sales_channel sc on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type and pol.service_type = e.service_type)
        then null
      when exists (
        select 1 from channel_delivery_policy pol
        join sales_channel sc on sc.slug = pol.channel_slug and sc.account_id = pol.account_id
        where pol.account_id = m.account_id and sc.id = e.channel_id
          and pol.ownership_type = m.ownership_type)
        then 'La politica de reparto de este canal dice otra modalidad para marcas '
             || m.ownership_type || '.'
      else 'Sin politica de reparto declarada para este canal y tipo de marca. No se adivina.'
    end
  from productos p
  cross join marca m
  left join menu_category mc on mc.id = p.menu_category_id
  cross join lateral menu_item_channel_economics(
    p.id,
    case when p_overrides is null then null else p_overrides -> (p.id::text) end,
    p_location_id) e
  left join uso_30d u
    on u.channel_id = e.channel_id
   and u.service_type is not distinct from e.service_type;
$function$;
