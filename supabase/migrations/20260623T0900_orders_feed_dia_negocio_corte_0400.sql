-- supabase/migrations/20260623T0900_orders_feed_dia_negocio_corte_0400.sql
-- ============================================================================
-- orders_feed: "Cerrados" usa DÍA DE NEGOCIO con corte a las 04:00, no medianoche.
--
-- PROBLEMA (T1700, día natural 00:00–24:00): al pasar las 00:00, el servicio de
-- noche desaparecía de "Cerrados" — el turno se partía en dos días.
--
-- AHORA: el día de negocio va de las 04:00 local de hoy a las 03:59 de mañana.
-- Un pedido cerrado entre 00:00 y 03:59 cuenta todavía como el día anterior.
-- Único cambio vs 20260622T1700: el cálculo de v_day_start (medianoche -> 04:00,
-- restando el corte antes de truncar y volviéndolo a sumar) + la constante del
-- corte. Todo lo demás (vivos sin límite, TZ de la cuenta con respaldo Europe/
-- Madrid, cota superior +1 día, y TODO el cuerpo del feed) INTACTO.
--
-- Firma idéntica (orders_feed(uuid) returns jsonb) -> CREATE OR REPLACE, conserva
-- grants. security definer + belongs_to_account. Idempotente, sin BEGIN/COMMIT,
-- sin SELECT de prueba (no probar en SQL Editor: auth.uid() null; validar en app).
-- ============================================================================

create or replace function public.orders_feed(
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id  uuid;
  v_location_id uuid := p_location_id;
  v_tz          text;
  -- Corte del "día de negocio": 04:00 local. Un pedido de 00:00–03:59 cuenta como
  -- el día anterior (cubre el servicio de noche sin partir el turno). Constante
  -- para legibilidad; si algún día se quiere configurable por cuenta, este es el
  -- ÚNICO punto a tocar (no se hace configurable ahora).
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

  -- Zona horaria de la cuenta (respaldo Europe/Madrid si la cuenta no la define).
  select coalesce(a.timezone, 'Europe/Madrid') into v_tz
  from accounts a where a.id = v_account_id;

  -- Inicio del DÍA DE NEGOCIO = 04:00 local del día en curso, retrocediendo al día
  -- anterior si aún no son las 04:00 (resta el corte antes de truncar y lo vuelve a
  -- sumar). Devuelto a timestamptz (UTC) para comparar con sale.* (UTC).
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
      and (
        -- VIVOS (no terminales): siempre, sin límite temporal.
        s.order_status not in ('completed','rejected','cancelled','delivery_failed')
        -- TERMINALES: solo si su cierre cae en el DÍA DE NEGOCIO en curso
        -- [04:00 hoy, 04:00 mañana) en la zona horaria de la cuenta.
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
$$;
