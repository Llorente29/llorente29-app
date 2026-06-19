-- supabase/migrations/20260619T0910_orders_feed.sql
-- ============================================================================
-- RPC orders_feed · el FEED de pedidos (lente "por pedido" de Folvy Orders).
-- ============================================================================
-- Gemela de kds_board pero con OTRO eje: kds_board organiza por estado de COCINA
-- (excluye lo "expo done", rutea por estación); orders_feed organiza por el
-- CICLO DE PLATAFORMA (order_status) y trae los datos del pedido (cliente,
-- entrega, hora prometida, total) que la cocina no necesita pero la recepción sí.
--
-- AGNÓSTICA DE CANAL: lee SOLO columnas canónicas de sale (las rellena el
-- adaptador de cada canal). No sabe de HubRise/Otter/Last. raw_tab solo se usa
-- para las notas por línea (mismo cruce que kds_board, por organizationProductId).
--
-- REUSA de kds_board (sin reinventar): el desglose padre/hijo de líneas
-- (combos + modifiers en `children`), alérgenos (recipe_item_allergen contains),
-- notas de cliente por línea, marcado (kds_line_state), minutos (semáforo).
--
-- NO incluye ruteo por estación (eso es A2, el cruce cocina↔pedido). A1 = lente
-- por pedido.
--
-- Qué muestra: pedidos del local con order_status no nulo (= pedidos de
-- plataforma). Los terminales (completed/rejected/cancelled/delivery_failed)
-- solo si son recientes (ventana 6 h); los activos, siempre. El front filtra por
-- pestañas (activos/nuevos/en curso/cerrados/incidencias) y ordena por urgencia.
--
-- security definer + belongs_to_account (mismo patrón que kds_board). Idempotente,
-- sin BEGIN/COMMIT, sin SELECT de prueba. Tras correr: regenerar database.ts.
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
      and s.order_status is not null                       -- solo pedidos de plataforma
      and (
        s.order_status not in ('completed','rejected','cancelled','delivery_failed')
        or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= now() - interval '6 hours'
      )
  ),
  -- Notas de cliente por línea, desde el crudo del TPV (igual que kds_board):
  -- safe_jsonb (null si raw inválido, no lanza), products array, casado por
  -- organizationProductId = sale_line.external_product_id.
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
  -- Líneas PADRE (visibles en la tarjeta): producto o, en raro, top-level no-product.
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
  -- Líneas HIJAS (combo_item, modifier): cuelgan de su padre por parent_sale_line_id.
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id
    from sale_line sl
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
                           'customer_note', (
                             select n2.note from notas n2
                              where n2.sale_id = h.sale_id and n2.ext_pid = h.external_product_id limit 1
                           )
                         ) order by h.line_id)
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
