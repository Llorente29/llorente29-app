-- 20260827215138_orders_feed_by_token_expone_platform_order_ref.sql
-- ============================================================================
-- La misma clave en el feed por token (tablet de cocina / KDS)
-- ============================================================================
-- Cuarta y ultima de la tanda de platform_order_ref. orders_feed_by_token es la
-- gemela de orders_feed para los dispositivos que entran por token en vez de por
-- sesion; si solo se arreglara una, el mismo pedido se veria distinto segun por
-- donde se mire.
--
-- Mismas dos lineas: s.platform_order_ref en `vivos`, v.platform_order_ref en
-- `tickets`.
--
-- Tampoco estaba versionada: la ultima completa del repo
-- (20260816T0901_kds_heartbeat_remove_writes.sql) tiene 8.315 caracteres de
-- cuerpo frente a los 8.491 vivos.
--
-- Transcrita de pg_get_functiondef y verificada byte a byte ANTES de tocarla:
-- md5 042a4e17b2686d518b3c1c8526808b9f (8.491 caracteres). Tras aplicar, el
-- cuerpo vivo da 8.362 caracteres y md5 c4f2fdd7c0bf6f1f2622b15a3ab9932a,
-- identico al calculado en local.
--
-- Finales de linea normalizados a LF, sin literales que crucen salto de linea.
-- OJO al espacio suelto de la linea 17 (tras el primer `end if;`): esta asi en
-- el catalogo y se conserva.
--
-- Verificada en vivo: 17 pedidos devueltos, clave presente en el JSON.
--
-- ⚠️ Despues de 20260827214035.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.orders_feed_by_token(p_device_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_location_id uuid;
  v_result      jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'orders_feed_by_token: token no válido';
  end if;
  
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;
  if v_location_id is null then
    raise exception 'orders_feed_by_token: el dispositivo no tiene local asignado';
  end if;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code, s.platform_order_ref,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           -- Reparto (paridad con orders_feed) + campos de rider de Catcher.
           s.dispatch_mode, s.carrier_code, s.delivery_state,
           s.rider_name, s.rider_phone, s.eta_pickup, s.eta_delivery, s.transport_price, s.dispatch_error,
           s.rider_transport_type, s.rider_lat, s.rider_lng, s.rider_seen_at, s.has_courier,
           -- Hitos de tiempo: KPI de cocina (accepted_at/ready_at) y reparto.
           s.accepted_at, s.ready_at, s.handed_to_courier_at, s.delivered_at,
           s.opened_at, s.closed_at, s.cancelled_at, s.sold_at, s.raw_tab,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id  = v_account_id
      and s.order_status is not null
      -- GUARDARRAÍL DE PAGO (idéntico a orders_feed): no mostrar en la tablet un
      -- pedido del Shop pagado online cuyo pago no esté confirmado.
      and not (
        s.source = 'folvy_shop'
        and s.payment_method = 'stripe'
        and coalesce(s.payment_status,'pending') <> 'paid'
      )
      and (
        s.order_status not in ('completed','rejected','cancelled','delivery_failed')
        or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= now() - interval '2 hours'
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
           v.platform_order_code, v.pos_short_code, v.platform_order_ref,
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
           -- Reparto (paridad con orders_feed) + campos de rider de Catcher.
           v.dispatch_mode, v.carrier_code, v.delivery_state,
           v.rider_name, v.rider_phone, v.eta_pickup, v.eta_delivery, v.transport_price, v.dispatch_error,
           v.rider_transport_type, v.rider_lat, v.rider_lng, v.rider_seen_at, v.has_courier,
           v.accepted_at, v.ready_at, v.handed_to_courier_at, v.delivered_at,
           v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           coalesce((select jsonb_agg(jsonb_build_object(
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
            from padres l where l.sale_id = v.id), '[]'::jsonb) as lineas
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
$function$
;
