-- 20260627T2400_shop_cash_and_feed_filter.sql
-- Aplicada: (pendiente)
--
-- Dos arreglos del pedido del Folvy Shop:
--
-- 1) place_shop_order: el estado inicial depende del método de pago.
--      payment.mode = 'cash'  -> nace order_status='accepted' (efectivo: se acepta
--                                automático; el cambio dispara impresión + Catcher).
--      cualquier otro          -> order_status='new' (online: espera al webhook de
--                                Stripe, que lo pasa a 'accepted' al confirmar pago).
--
-- 2) orders_feed y kds_board: ocultan los pedidos del Shop que sigan en 'new'
--    (= pago online pendiente). Un pedido NO confirmado no debe verse en cocina.
--    Los de efectivo nacen 'accepted', así que entran con normalidad.
--
-- Nota: si payment.mode='cash' y el insert ya nace 'accepted', el INSERT no
-- dispara los triggers (son AFTER UPDATE). Por eso, tras el insert, si nació
-- 'accepted' forzamos el disparo con un UPDATE no-op del estado (accepted->accepted
-- vía old IS DISTINCT FROM new NO basta). Solución limpia: insertar 'new' y, si es
-- cash, hacer UPDATE a 'accepted' al final (eso sí dispara impresión + Catcher).


-- ─────────────────────────────────────────────────────────────────────
-- 1) place_shop_order: efectivo nace aceptado
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_acc        uuid;
  v_channel    uuid;
  v_location   uuid;
  v_mode       text;
  v_service    text;
  v_pay_mode   text;
  v_line       jsonb;
  v_repr       jsonb;
  v_subtotal   numeric := 0;
  v_delivery   numeric := 0;
  v_total      numeric := 0;
  v_preview    jsonb := '[]'::jsonb;
  v_sale_id    uuid;
  v_code       text;
  v_brand_arr  uuid[];
  v_expected   timestamptz;
  v_addr       text;
  v_is_cash    boolean;
begin
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  if jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  v_location := nullif(p_payload->>'locationId','')::uuid;
  v_mode     := coalesce(p_payload->>'mode', 'delivery');
  v_service  := case when v_mode = 'pickup' then 'pickup' else 'own_delivery' end;
  v_delivery := case when v_mode = 'pickup' then 0
                     else coalesce((p_payload#>>'{delivery,deliveryFee}')::numeric, 0) end;
  v_expected := nullif(p_payload->>'expectedTime','')::timestamptz;
  v_pay_mode := coalesce(p_payload#>>'{payment,mode}','simulated');
  v_is_cash  := (v_pay_mode = 'cash');

  select id into v_channel
  from sales_channel
  where account_id = v_acc and slug = 'shop' and is_active and archived_at is null
  limit 1;

  for v_line in select * from jsonb_array_elements(p_payload->'lines')
  loop
    v_repr := public._shop_reprice_line(v_acc, v_line);
    v_subtotal := v_subtotal + coalesce((v_repr->>'lineTotal')::numeric, 0);
    v_preview := v_preview || jsonb_build_array(jsonb_build_object(
      'name', v_repr->>'name',
      'quantity', (v_repr->>'quantity')::numeric,
      'unitPrice', (v_repr->>'unitPrice')::numeric,
      'lineTotal', (v_repr->>'lineTotal')::numeric,
      'valid', (v_repr->>'valid')::boolean
    ));
  end loop;
  v_total := v_subtotal + v_delivery;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'subtotal', round(v_subtotal,2),
      'deliveryFee', round(v_delivery,2),
      'total', round(v_total,2),
      'lines', v_preview
    );
  end if;

  v_addr := nullif(btrim(
              coalesce(p_payload#>>'{delivery,address}','') || ' · ' ||
              coalesce(p_payload#>>'{delivery,detail}',''),
              ' ·'), '');

  v_sale_id := gen_random_uuid();
  v_code    := 'FS' || upper(left(replace(v_sale_id::text,'-',''), 5));

  -- Nace SIEMPRE en 'new'. Si es efectivo, abajo se promueve a 'accepted' con un
  -- UPDATE (que SÍ dispara los triggers AFTER UPDATE de impresión + Catcher).
  insert into sale (id, account_id, channel_id, location_id, source,
                    sold_at, total, delivery_cost, service_type,
                    status, order_status, platform_order_code,
                    customer_name, customer_phone, delivery_address, customer_note,
                    expected_time, payment_method, payment_status, dispatch_mode, raw_tab, created_by_name)
  values (v_sale_id, v_acc, v_channel, v_location, 'folvy_shop',
          now(), round(v_total,2), round(v_delivery,2), v_service,
          'open', 'new', v_code,
          nullif(p_payload#>>'{customer,name}',''),
          nullif(p_payload#>>'{customer,phone}',''),
          v_addr,
          nullif(p_payload#>>'{delivery,note}',''),
          v_expected,
          v_pay_mode,
          case when v_is_cash then 'pending' else 'pending' end,
          'auto',
          p_payload::text,
          'Folvy Shop');

  perform public.adapt_folvy_shop_order(v_sale_id);

  perform public.compute_sale_line_cost(sl.id)
  from sale_line sl
  where sl.sale_id = v_sale_id and coalesce(sl.line_type,'product') = 'product';

  select array_agg(distinct mi.brand_id)
  into v_brand_arr
  from sale_line sl
  join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = v_sale_id and sl.line_type = 'product' and mi.brand_id is not null;

  update sale
  set brand_id = case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end
  where id = v_sale_id;

  -- EFECTIVO: se acepta automáticamente. El UPDATE new->accepted dispara
  -- impresión + Catcher por los triggers AFTER UPDATE existentes.
  if v_is_cash then
    update sale set order_status = 'accepted' where id = v_sale_id and order_status = 'new';
  end if;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'saleId', v_sale_id,
    'code', v_code,
    'accepted', v_is_cash,
    'subtotal', round(v_subtotal,2),
    'deliveryFee', round(v_delivery,2),
    'total', round(v_total,2)
  );
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────
-- 2a) orders_feed: ocultar Shop en 'new' (pago online pendiente)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.orders_feed(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id  uuid;
  v_location_id uuid := p_location_id;
  v_tz          text;
  c_business_day_cutoff_hours constant int := 4;
  v_cutoff      interval := make_interval(hours => c_business_day_cutoff_hours);
  v_day_start   timestamptz;
  v_result      jsonb;
begin
  if v_location_id is null then
    raise exception 'orders_feed: falta location';
  end if;
  select account_id into v_account_id from locations where id = v_location_id;
  if v_account_id is null then
    raise exception 'orders_feed: ubicación inexistente';
  end if;
  if not belongs_to_account(v_account_id) then
    raise exception 'orders_feed: sin acceso a esta ubicación';
  end if;

  select coalesce(a.timezone, 'Europe/Madrid') into v_tz
  from accounts a where a.id = v_account_id;

  v_day_start := (
    date_trunc('day', (now() at time zone v_tz) - v_cutoff) + v_cutoff
  ) at time zone v_tz;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           s.opened_at, s.closed_at, s.cancelled_at, s.sold_at, s.raw_tab,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id  = v_account_id
      and s.order_status is not null
      -- Pedido del Shop sin confirmar (pago online pendiente): NO entra en cocina.
      and not (s.source = 'folvy_shop' and s.order_status = 'new')
      and (
        s.order_status not in ('completed','rejected','cancelled','delivery_failed')
        or (
             coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= v_day_start
         and coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) <  v_day_start + interval '1 day'
        )
      )
  ),
  notas as (
    select v.id as sale_id,
           (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from vivos v
    cross join lateral (select safe_jsonb(v.raw_tab) as tab) rt
    cross join lateral (
      select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products
    ) p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.products) = 'array' then p.products else '[]'::jsonb end
    ) as prod
    where nullif(btrim(prod->>'comments'), '') is not null
      and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id, sl.external_product_id,
           sl.unit_price, sl.line_total,
           coalesce(ls.marked, false) as marked,
           mi.category               as menu_category,
           df.name                   as family,
           df.color                  as family_color,
           df.icon                   as family_icon,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id,
           sl.menu_item_id,
           mg.group_type,
           dfh.name  as family,
           dfh.color as family_color,
           mih.category as menu_category,
           case
             when sl.line_type = 'combo_item'                      then 1
             when mg.group_type = 'removal'                        then 2
             when mg.group_type = 'extras'                         then 3
             when mg.group_type in ('choice','side')               then 4
             when mg.group_type in ('cross_sell','info')           then 6
             else 5
           end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group  mg on mg.id = mo.modifier_group_id
    left join menu_item   mih on mih.id = sl.menu_item_id
    left join recipe_item rih on rih.id = mih.recipe_item_id
    left join recipe_family dfh on dfh.id = rih.family_id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is not null
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.platform_order_code, v.pos_short_code,
           v.order_status, v.status, v.service_type, v.source,
           b.name as brand,
           b.logo_url as brand_logo_url, b.color as brand_color,
           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption,
           b.ownership_type as brand_ownership_type,
           coalesce(ch.name, v.external_channel_text) as channel,
           v.channel_id,
           v.customer_name, v.customer_phone, v.delivery_address,
           v.expected_time, v.customer_note,
           v.total, v.paid, v.payment_method, v.discount_amount, v.delivery_cost,
           v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           (select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
                'unit_price', l.unit_price, 'line_total', l.line_total,
                'marked', l.marked, 'allergens', l.allergens,
                'family', l.family, 'family_color', l.family_color,
                'family_icon', l.family_icon, 'menu_category', l.menu_category,
                'has_recipe', (l.menu_item_id is not null),
                'customer_note', (
                  select n.note from notas n
                   where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1
                ),
                'children', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity,
                           'line_type', h.line_type,
                           'group_type', h.group_type,
                           'menu_item_id', h.menu_item_id,
                           'family', h.family, 'family_color', h.family_color,
                           'menu_category', h.menu_category,
                           'customer_note', (
                             select n2.note from notas n2
                              where n2.sale_id = h.sale_id and n2.ext_pid = h.external_product_id limit 1
                           )
                         ) order by h.sort_rank, h.product_name)
                  from hijas h where h.parent_sale_line_id = l.line_id
                ), '[]'::jsonb)
            ) order by l.product_name)
            from padres l where l.sale_id = v.id) as lineas
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', v_location_id,
    'now', now(),
    'orders', coalesce(
      jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null),
      '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────
-- 2b) kds_board: misma exclusión (Shop en 'new' no entra en el tablero)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.kds_board(p_location_id uuid default null::uuid, p_device_token text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_location_id uuid := p_location_id;
  v_device     kds_device;
  v_station_filter uuid[] := null;
  v_default_station uuid;
  v_result     jsonb;
begin
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is null then
      raise exception 'kds_board: token de dispositivo no válido';
    end if;
    if v_location_id is null then
      v_location_id := v_device.location_id;
    elsif v_device.location_id <> v_location_id then
      raise exception 'kds_board: el token no corresponde a esta ubicación';
    end if;
    v_account_id := v_device.account_id;
    v_station_filter := v_device.station_ids;
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    if v_location_id is null then
      raise exception 'kds_board: falta location o token';
    end if;
    select account_id into v_account_id from locations where id = v_location_id;
    if v_account_id is null then
      raise exception 'kds_board: ubicación inexistente';
    end if;
    if not belongs_to_account(v_account_id) then
      raise exception 'kds_board: sin acceso a esta ubicación';
    end if;
  end if;

  select id into v_default_station from kitchen_station
   where location_id = v_location_id and is_default and is_active limit 1;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref, s.status,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.opened_at, s.closed_at, s.sold_at, s.raw_tab,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id = v_account_id
      and s.status <> 'cancelled'
      -- Pedido del Shop sin confirmar (pago online pendiente): NO entra en cocina.
      and not (s.source = 'folvy_shop' and s.order_status = 'new')
      and not exists (
        select 1 from kds_ticket_station_state st
        join kitchen_station k on k.id = st.station_id
        where st.sale_id = s.id and k.kind = 'expo' and st.status = 'done'
      )
      and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '2 hours')
  ),
  notas as (
    select v.id as sale_id,
           (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from vivos v
    cross join lateral (
      select safe_jsonb(v.raw_tab) as tab
    ) rt
    cross join lateral (
      select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products
    ) p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.products) = 'array' then p.products else '[]'::jsonb end
    ) as prod
    where nullif(btrim(prod->>'comments'), '') is not null
      and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id, sl.external_product_id,
           coalesce(
             ri.kds_station_id,
             (select fr.station_id from kitchen_family_route fr
               where fr.account_id = v_account_id and fr.family_id = ri.family_id limit 1),
             v_default_station
           ) as station_id,
           coalesce(ls.marked, false) as marked,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id
    from sale_line sl
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is not null
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref, v.status,
           b.name as brand, coalesce(ch.name, v.external_channel_text) as channel, v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           (select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
                'station_id', l.station_id, 'marked', l.marked, 'allergens', l.allergens,
                'has_recipe', (l.menu_item_id is not null),
                'customer_note', (
                  select n.note from notas n
                   where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1
                ),
                'children', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity,
                           'line_type', h.line_type,
                           'customer_note', (
                             select n2.note from notas n2
                              where n2.sale_id = h.sale_id and n2.ext_pid = h.external_product_id limit 1
                           )
                         ) order by h.line_id)
                  from hijas h where h.parent_sale_line_id = l.line_id
                ), '[]'::jsonb)
            ) order by l.product_name)
            from padres l where l.sale_id = v.id) as lineas,
           (select jsonb_object_agg(st.station_id, st.status)
            from kds_ticket_station_state st where st.sale_id = v.id) as estaciones
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', v_location_id,
    'station_filter', to_jsonb(v_station_filter),
    'default_station_id', v_default_station,
    'expo_station_id', (select id from kitchen_station
                         where location_id = v_location_id and kind='expo' and is_active
                         order by display_order limit 1),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'kind', k.kind,
                'display_order', k.display_order, 'is_default', k.is_default
              ) order by k.display_order), '[]'::jsonb)
      from kitchen_station k
      where k.account_id = v_account_id and k.location_id = v_location_id and k.is_active
    ),
    'now', now(),
    'tickets', coalesce(jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null), '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$function$;
