-- supabase/migrations/20260619T1100_orders_feed_group_type.sql
-- ============================================================================
-- #6 MODIFICADORES CON DATO REAL + ORDEN LÓGICO DE LAS HIJAS.
-- ============================================================================
-- orders_feed pasaba line_type tal cual y el front adivinaba "quitar vs añadir"
-- por el texto del nombre (frágil). Ahora trae la VERDAD DEL CATÁLOGO: el
-- group_type del modifier_group (vía modifier_option), que el front usa para
-- pintar con certeza (removal=rojo, extras=ámbar, choice/side=neutro). Para los
-- modificadores que no casaron con el catálogo (~8%), el front cae a la heurística
-- de texto como red de seguridad, marcándolos "sin confirmar".
--
-- ORDEN LÓGICO DE LAS HIJAS (pedido por Julio): lo que importa a la cocina arriba,
-- lo accesorio (bebidas/postres/cross_sell) al final, para no desviar la atención.
-- Orden: combo_item (componentes del plato) -> modificadores que afectan al plato
-- (removal/extras/choice/side) -> cross_sell/info (bebidas, postres, extras de venta)
-- -> resto. Dentro de cada grupo, por nombre (estable).
--
-- Único cambio vs 20260619T0910: la CTE `hijas` añade el join al catálogo y un
-- rango de orden; el JSON de cada hija expone `group_type`; el order by de children
-- usa el rango. Todo lo demás (padres, notas, tickets, alérgenos, marcado) intacto.
--
-- security definer + belongs_to_account. Idempotente, sin BEGIN/COMMIT, sin SELECT
-- de prueba. Tras correr: regenerar database.ts (el JSON gana un campo).
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

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref,
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
        s.order_status not in ('completed','rejected','cancelled','delivery_failed')
        or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= now() - interval '6 hours'
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
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is null
  ),
  -- Líneas HIJAS: + group_type del catálogo (LEFT JOIN: null si no casó / si es combo)
  -- + rango de orden lógico para que cocina vea lo importante arriba.
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id,
           mg.group_type,
           case
             when sl.line_type = 'combo_item'                      then 1  -- componentes del plato
             when mg.group_type = 'removal'                        then 2  -- quitar
             when mg.group_type = 'extras'                         then 3  -- añadir de pago
             when mg.group_type in ('choice','side')               then 4  -- elecciones del plato
             when mg.group_type in ('cross_sell','info')           then 6  -- bebidas/postres/venta -> al final
             else 5                                                        -- modifier sin casar
           end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group  mg on mg.id = mo.modifier_group_id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is not null
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.order_status, v.status, v.service_type, v.source,
           b.name as brand, coalesce(ch.name, v.external_channel_text) as channel,
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
