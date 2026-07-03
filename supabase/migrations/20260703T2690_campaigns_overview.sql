-- 20260703T2690_campaigns_overview.sql
-- Aplicada: (pendiente)
--
-- G2e.3 — Vista GENERAL de rendimiento (dashboard comercial del motor de
-- crecimiento). Agregado de toda la cuenta sobre coupon_redemption vivos. Solo
-- lectura; no toca motor ni checkout.
--
-- campaigns_overview(cuenta, from, to, kinds[], brand):
--   soldEur       € vendido en pedidos CON oferta (sale.total, sales distintas)
--   invested      € invertido = descuentos; para free_item el coste REAL del regalo
--                 (escandallo) si lo tiene, si no el importe grabado
--   marginReal    sum(margin_after) donde exista; marginKnown/marginMissing declarados
--   roi           marginReal / invested
--   redemptions   canjes vivos
--   newCustomers  clientes nuevos captados (canjes de bienvenida: standard auto/first)
--   offerOrders / totalOrders  pedidos con oferta vs total del Shop (para el %)
--   series[]      diario: {day, redemptions, invested, soldEur}
--   byKind[]      reparto por tipo: {kind, redemptions, invested, marginReal}
--   top[]         top 5 campañas por ROI/canjes: {id, name, kind, redemptions, invested, marginReal, roi}
--   Filtros: kinds[] (coupon.kind), brand (via campaign_scope; campañas de cuenta
--   entera -> todas las marcas). Rango por sale.sold_at.
--
-- No se prueba en la tx que la crea (auth.uid() null en editor).

begin;

create or replace function public.campaigns_overview(
  p_account uuid, p_from timestamptz, p_to timestamptz, p_kinds text[], p_brand uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_from   timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to     timestamptz := coalesce(p_to,   'infinity'::timestamptz);
  v_result jsonb;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  with cpn as (
    select c.id, c.name, c.kind,
           (c.kind = 'standard' and (c.auto_apply or c.first_order_only)) as is_welcome,
           case when c.kind = 'free_item' then (
             select round(ri.computed_cost + coalesce(mi.packaging_cost, 0), 2)
             from campaign_scope sc
             join menu_item mi on mi.id = sc.menu_item_id
             join recipe_item ri on ri.id = mi.recipe_item_id
             where sc.coupon_id = c.id and sc.menu_item_id is not null and ri.computed_cost is not null
             limit 1
           ) else null end as gift_cost
    from coupon c
    where c.account_id = p_account
      and (p_kinds is null or c.kind = any(p_kinds))
      and (
        p_brand is null
        or exists (
          select 1 from campaign_scope sc
          where sc.coupon_id = c.id
            and (sc.brand_id = p_brand
              or sc.menu_category_id in (select mc.id from menu_category mc where mc.brand_id = p_brand and mc.account_id = p_account)
              or sc.menu_item_id     in (select mi.id from menu_item     mi where mi.brand_id = p_brand and mi.account_id = p_account))
        )
        or not exists (select 1 from campaign_scope sc where sc.coupon_id = c.id)  -- cuenta entera = todas las marcas
      )
  ),
  red as (
    select cr.discount_amount, cr.margin_after, cr.sale_id, cr.customer_id,
           s.total as sale_total, s.sold_at,
           cp.id as coupon_id, cp.name, cp.kind, cp.is_welcome,
           case when cp.kind = 'free_item' then coalesce(cp.gift_cost, cr.discount_amount) else cr.discount_amount end as invested
    from coupon_redemption cr
    join cpn cp on cp.id = cr.coupon_id
    join sale s on s.id = cr.sale_id
    where cr.account_id = p_account and coalesce(s.status,'') <> 'cancelled'
      and s.sold_at >= v_from and s.sold_at < v_to
  ),
  offer_sales as (select distinct sale_id, sale_total from red),
  by_kind as (
    select kind, count(*) as redemptions, round(sum(invested), 2) as invested,
           sum(margin_after) filter (where margin_after is not null) as margin_real
    from red group by kind
  ),
  by_coupon as (
    select coupon_id, name, kind, count(*) as redemptions, round(sum(invested), 2) as invested,
           sum(margin_after) filter (where margin_after is not null) as margin_real,
           count(margin_after) as margin_known
    from red group by coupon_id, name, kind
  ),
  series as (
    select to_char((sold_at at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD') as day,
           count(*) as redemptions, round(sum(invested), 2) as invested, round(sum(sale_total), 2) as sold_eur
    from red group by 1 order by 1
  )
  select jsonb_build_object(
    'ok', true,
    'soldEur',       (select coalesce(round(sum(sale_total), 2), 0) from offer_sales),
    'invested',      (select coalesce(round(sum(invested), 2), 0) from red),
    'marginReal',    (select case when count(margin_after) > 0 then round(sum(margin_after) filter (where margin_after is not null), 2) else null end from red),
    'marginKnown',   (select count(margin_after) from red),
    'marginMissing', (select count(*) - count(margin_after) from red),
    'redemptions',   (select count(*) from red),
    'newCustomers',  (select count(distinct customer_id) filter (where is_welcome and customer_id is not null) from red),
    'offerOrders',   (select count(*) from offer_sales),
    'totalOrders',   (select count(*) from sale s where s.account_id = p_account and s.source = 'folvy_shop'
                        and coalesce(s.status,'') <> 'cancelled' and s.sold_at >= v_from and s.sold_at < v_to),
    'byKind',        coalesce((select jsonb_agg(jsonb_build_object(
                        'kind', kind, 'redemptions', redemptions, 'invested', invested,
                        'marginReal', round(margin_real, 2)) order by invested desc nulls last) from by_kind), '[]'::jsonb),
    'top',           coalesce((select jsonb_agg(t) from (
                        select jsonb_build_object(
                          'id', coupon_id, 'name', name, 'kind', kind, 'redemptions', redemptions,
                          'invested', invested, 'marginReal', round(margin_real, 2),
                          'roi', case when margin_known > 0 and invested > 0 then round(margin_real / invested, 2) else null end) as t
                        from by_coupon
                        order by (case when margin_known > 0 and invested > 0 then margin_real / invested else null end) desc nulls last, redemptions desc
                        limit 5) tt), '[]'::jsonb),
    'series',        coalesce((select jsonb_agg(jsonb_build_object(
                        'day', day, 'redemptions', redemptions, 'invested', invested, 'soldEur', sold_eur)) from series), '[]'::jsonb)
  ) into v_result;

  -- ROI global = margen real / invertido.
  v_result := v_result || jsonb_build_object('roi',
    case when (v_result->>'marginReal') is not null and (v_result->>'invested')::numeric > 0
         then round((v_result->>'marginReal')::numeric / (v_result->>'invested')::numeric, 2) else null end);

  return v_result;
end;
$fn$;

grant execute on function public.campaigns_overview(uuid, timestamptz, timestamptz, text[], uuid) to authenticated;

commit;
