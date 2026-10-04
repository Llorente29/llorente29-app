-- ============================================================================
-- R02 · 3/4 · LOS LECTORES PASAN A LA RESOLUCIÓN ÚNICA
-- ----------------------------------------------------------------------------
-- Va DESPUÉS del 2/4: cuando esto entra, las filas migradas ya reproducen lo
-- de hoy, así que cambiar de lector no cambia ninguna decisión (prueba de 0
-- diferencias: supabase/staging/sql/20261005_r02_prueba_cero_diferencias.sql).
--
-- Todo es CREATE OR REPLACE con la MISMA firma (regla 2: no se añade ningún
-- parámetro; nada de sobrecargas). No se borra nada: el interruptor antiguo
-- deja de leerse aquí y la columna se elimina en el fichero aparte 0200.
--
-- QUÉ CAMBIA
--   1. tg_sale_service_type_por_interruptor (el disparador de ENTRADA; se
--      queda con su nombre para no borrar ni renombrar un objeto de Cocina
--      en este fichero): ahora PONE el service_type de reparto de los pedidos
--      de HubRise y de Last con resolve_delivery_by. «El service_type se pone
--      con la resolución, no al revés.» Un pedido ya abierto NO se toca:
--      cambiar una celda se aplica a los siguientes.
--   2. resolve_dispatch: deja de mirar el interruptor. Quién reparte ya está
--      decidido en el service_type (lo puso la resolución al entrar); aquí
--      solo se respeta. Mismo resultado que antes para todo pedido que entre
--      después de la migración.
--   3. dispatch_watchdog_scan: un «propio» sin dirección ya no es una alarma
--      roja. Es la etiqueta ámbar «Nosotros · falta la dirección» y la cocina
--      cocina igual (encargo §5). La alarma sigue para lo que sí se podía
--      despachar y no salió.
--   4. metrica_direcciones_de_reparto: el eje «quién reparte» sale de la
--      resolución, no del interruptor.
--   5. brand_price_grid: qué modalidad de precio aplica sale de la resolución
--      por MARCA, no de la herencia por tipo de marca (respuesta 1, punto 4).
--      Los precios no cambian: solo policy_allowed / policy_reason.
-- ============================================================================

-- ── 1. El disparador de entrada ────────────────────────────────────────────
create or replace function public.tg_sale_service_type_por_interruptor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug       text;
  v_by         text;
  v_recalcular boolean;
begin
  -- Solo los pedidos que llegan de las plataformas. La tienda propia, el TPV
  -- y lo manual deciden su modalidad ellos mismos (hoy: 22 + 3 + 2 ventas).
  if coalesce(new.source, '') not in ('hubrise', 'lastapp') then return new; end if;
  if new.brand_id is null then return new; end if;
  -- Solo la modalidad de reparto. Recogida y en local no se tocan.
  if new.service_type is null or new.service_type not in ('own_delivery', 'platform_delivery') then
    return new;
  end if;

  -- Una vuelta atrás que devuelve a un pedido la modalidad que tenía la pone
  -- tal cual (supabase/vuelta-atras/20261005T0210…down.sql). Nadie más la usa.
  if coalesce(current_setting('folvy.reparto_tal_cual', true), '') = 'on' then return new; end if;

  if tg_op = 'UPDATE' then
    -- Los webhooks reescriben el pedido en cada cambio de estado y mandan otra
    -- vez su modalidad. Un pedido ya abierto conserva la que se le puso al
    -- entrar, salvo que:
    --   · hasta ahora no se pudiera resolver (sin marca o sin canal), o
    --   · alguien lo pida a propósito en esta transacción
    --     (reparto_cambiar_celda_desde_pedido o el saneado del despliegue).
    v_recalcular :=
         old.service_type is null
      or old.service_type not in ('own_delivery', 'platform_delivery')
      or old.brand_id is null
      or old.channel_id is distinct from new.channel_id
      or coalesce(current_setting('folvy.reparto_recalcular', true), '') = 'on';
    if not v_recalcular then
      new.service_type := old.service_type;
      return new;
    end if;
  end if;

  select sc.slug into v_slug
    from public.sales_channel sc
   where sc.id = new.channel_id and sc.account_id = new.account_id;
  if coalesce(btrim(v_slug), '') = '' then return new; end if;   -- sin canal: como llegue

  select r.delivery_by into v_by
    from public.resolve_delivery_by(new.account_id, new.brand_id, v_slug, new.location_id) r;

  new.service_type := case when v_by = 'own' then 'own_delivery' else 'platform_delivery' end;
  return new;
end;
$$;

comment on function public.tg_sale_service_type_por_interruptor() is
  'R02 · Pone el service_type de reparto (own_delivery / platform_delivery) de los pedidos de HubRise y Last '
  'con resolve_delivery_by al ENTRAR. Un pedido abierto conserva el suyo. El nombre es el de antes para no '
  'renombrar un objeto de Cocina; ya no lee ningún interruptor.';

-- El disparador ya existe con este nombre y esta función (BEFORE INSERT OR
-- UPDATE ON sale). No se toca.

-- ── 2. resolve_dispatch ────────────────────────────────────────────────────
create or replace function public.resolve_dispatch(p_sale_id uuid)
returns table(carrier text, reason text)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ── 3. El vigía del despacho ───────────────────────────────────────────────
create or replace function public.dispatch_watchdog_scan(p_grace_minutes integer default 8)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
       -- R02 (05/10): un «propio» SIN dirección no es una alarma. La cocina
       -- lo ve en ámbar («Nosotros · falta la dirección») con sus dos
       -- acciones; el reparto nunca pinta el pedido en rojo.
       and coalesce(btrim(s.delivery_address), '') <> ''
       and not exists (
         select 1 from public.delivery_assignment da
          where da.sale_id = s.id and da.state not in ('failed','canceled'))
  loop
    select carrier, reason into v_carrier, v_reason
      from public.resolve_dispatch(v_row.id);

    if v_carrier is null then
      -- NO SE ENVIO. El guard hizo su trabajo. Se marca para que se vea, pero
      -- con el motivo REAL y sin decir «enviado».
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
$$;

-- ── 4. La métrica de direcciones ───────────────────────────────────────────
create or replace function public.metrica_direcciones_de_reparto(p_account_id uuid, p_dias integer default 30)
returns table(reparto text, marca text, pasarela text, canal text, pedidos bigint, sin_direccion bigint,
              sin_direccion_pct numeric, con_coordenadas bigint, coords_en_delivery bigint, coords_en_customer bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- service_role (informes, cron) pasa; un usuario tiene que ser de la cuenta.
  if current_setting('request.jwt.claims', true) is not null
     and not public.belongs_to_account(p_account_id) then
    raise exception 'metrica_direcciones_de_reparto: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with base as (
    select
      -- EJE 1, quien reparte: lo que dice «Quién reparte» HOY para esa marca
      -- en ese canal y local (R02). Antes, el interruptor por marca.
      case when (select r.delivery_by
                   from public.resolve_delivery_by(s.account_id, s.brand_id, sc.slug, s.location_id) r) = 'own'
           then 'nosotros' else 'plataforma' end as reparto,
      -- EJE 2, de quien es la marca. Nada que ver con el anterior.
      case b.ownership_type
           when 'own'      then 'propia'
           when 'licensed' then 'licenciada'
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
    left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
    left join public.sales_channel sc on sc.id = s.channel_id and sc.account_id = s.account_id
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
$$;

-- ── 5. La rejilla de precios ───────────────────────────────────────────────
create or replace function public.brand_price_grid(p_brand_id uuid, p_location_id uuid default null::uuid, p_overrides jsonb default null::jsonb)
returns table(menu_item_id uuid, menu_item_name text, category_id uuid, category_name text, product_type text,
              base_price numeric, channel_id uuid, channel_name text, channel_type text, service_type text,
              price numeric, price_source text, is_location_override boolean, is_available boolean, vat_rate numeric,
              cost_available boolean, net_margin numeric, net_margin_pct numeric, contribution_margin_pct numeric,
              channel_orders_30d integer, policy_allowed boolean, policy_reason text)
language sql
stable
set search_path = public
as $$
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
  ),
  -- R02: quién reparte ESTA marca en cada canal (y local), con la misma
  -- resolución que el pedido. Antes: la herencia por tipo de marca.
  quien as (
    select sc.id as channel_id,
           case r.delivery_by when 'own' then 'own_delivery' else 'platform_delivery' end as service_type,
           r.source
      from marca m
      join sales_channel sc on sc.account_id = m.account_id
      cross join lateral public.resolve_delivery_by(m.account_id, m.id, sc.slug, p_location_id) r
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
      else q.service_type is not distinct from e.service_type
    end,
    case
      when e.channel_type <> 'delivery' then null
      when e.service_type is null or e.service_type = 'pickup' then null
      when q.service_type is not distinct from e.service_type then null
      when q.source = 'default'
        then 'Nadie ha dicho quién reparte esta marca en este canal: se toma «la reparte la plataforma».'
      else 'En «Quién reparte», esta marca en este canal la reparte '
           || case q.service_type when 'own_delivery' then 'Folvy (nosotros)' else 'la plataforma' end || '.'
    end
  from productos p
  cross join marca m
  left join menu_category mc on mc.id = p.menu_category_id
  cross join lateral menu_item_channel_economics(
    p.id,
    case when p_overrides is null then null else p_overrides -> (p.id::text) end,
    p_location_id) e
  left join quien q on q.channel_id = e.channel_id
  left join uso_30d u
    on u.channel_id = e.channel_id
   and u.service_type is not distinct from e.service_type;
$$;

-- ── 6. Los dos feeds de pedidos (cocina y tablet por token) ─────────────────
-- Devolvían brand_own_delivery = marca_reparte_propio(b): el interruptor por
-- marca. La web lo usa para decidir si un pedido «propio» enseña algo de
-- despacho. Con el R02 quién reparte un pedido ya está decidido en su
-- service_type (lo puso la resolución al entrar), así que brand_own_delivery
-- pasa a ser eso. No se reescribe la función a mano: se toma su definición
-- ACTUAL y se cambia SOLO esa expresión (una vez en cada una; si no está
-- exactamente una vez, para). El resto queda idéntico byte a byte. La vuelta
-- atrás hace el cambio contrario y la prueba compara el md5 con producción.
-- (Encontrado al revisar quién llamaba a marca_reparte_propio antes de borrarla.)
do $$
declare
  f   text;
  d   text;
  viejo constant text := 'public.marca_reparte_propio(b) as brand_own_delivery';
  nuevo constant text := '(v.service_type = ''own_delivery'') as brand_own_delivery';
  n   int;
begin
  foreach f in array array['public.orders_feed(uuid)', 'public.orders_feed_by_token(text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    n := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
    if n = 0 and position(nuevo in d) > 0 then
      raise notice 'R02 0120: % ya estaba cambiada; no se toca.', f;
      continue;
    end if;
    if n <> 1 then
      raise exception 'R02 0120: en % la expresión de brand_own_delivery aparece % veces (se esperaba 1). No se toca nada.', f, n;
    end if;
    execute replace(d, viejo, nuevo);
    raise notice 'R02 0120: % · brand_own_delivery sale ya del service_type del pedido.', f;
  end loop;
end $$;
