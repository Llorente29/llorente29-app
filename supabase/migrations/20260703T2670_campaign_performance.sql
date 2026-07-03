-- 20260703T2670_campaign_performance.sql
-- Aplicada: (pendiente)
--
-- G2e — DASHBOARD DE RENDIMIENTO. Margen real generado + ROI (lo que Uber/Glovo no
-- dan y Pleez solo estima desde fuera). Solo LECTURA; no toca motor ni checkout.
--
--   (1) campaign_performance(cuenta, coupon, from, to): canjes vivos (excluye
--       cancelled), € descontado, ventas atribuidas (nº y €), ticket medio CON la
--       campaña vs ticket del Shop SIN ella (mismo periodo), margen real
--       (sum margin_after donde EXISTA; declara los canjes sin margen = deuda de
--       escandallo visible), coste (descuentos; para free_item el coste REAL del
--       regalo si tiene escandallo), ROI = margen/coste, y serie diaria.
--   (2) list_campaigns += 'roi' (margen/descuento cuando hay margen conocido), para
--       la columna de la lista. Regenerado del texto VIVO + replace() anclado con
--       guarda/idempotencia (2560 está aplicada -> no se edita; va aquí).
--
-- Nota honesta: margin_after solo lo rellena el motor para cupones de SUBTOTAL
-- (standard/bienvenida/frecuencia). Las ofertas de item (item_percent/bogo/
-- free_delivery/free_item) guardan margin_after NULL -> aparecen como "canjes sin
-- margen" (deuda de escandallo), no maquillado.
--
-- No se prueba en la tx que la crea.

begin;

create or replace function public.campaign_performance(
  p_account uuid, p_coupon uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_kind       text;
  v_from       timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to         timestamptz := coalesce(p_to,   'infinity'::timestamptz);
  v_gift_cost  numeric;
  v_gift_costed boolean := false;
  v_result     jsonb;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  select kind into v_kind from coupon where id = p_coupon and account_id = p_account;
  if v_kind is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Coste REAL del regalo (free_item) por unidad, si el plato tiene escandallo.
  if v_kind = 'free_item' then
    select round(ri.computed_cost + coalesce(mi.packaging_cost, 0), 2)
      into v_gift_cost
    from campaign_scope sc
    join menu_item mi on mi.id = sc.menu_item_id
    join recipe_item ri on ri.id = mi.recipe_item_id
    where sc.coupon_id = p_coupon and sc.menu_item_id is not null and ri.computed_cost is not null
    limit 1;
    v_gift_costed := v_gift_cost is not null;
  end if;

  with red as (
    select cr.discount_amount, cr.margin_after, cr.sale_id, s.total as sale_total, s.sold_at
    from coupon_redemption cr
    join sale s on s.id = cr.sale_id
    where cr.coupon_id = p_coupon and cr.account_id = p_account
      and coalesce(s.status,'') <> 'cancelled'
      and s.sold_at >= v_from and s.sold_at < v_to
  ),
  shop_without as (
    select s.total
    from sale s
    where s.account_id = p_account and s.source = 'folvy_shop'
      and coalesce(s.status,'') <> 'cancelled'
      and s.sold_at >= v_from and s.sold_at < v_to
      and s.id not in (select sale_id from red)
  ),
  agg as (
    select
      count(*)                                                   as redemptions,
      coalesce(sum(discount_amount), 0)                          as discounted,
      count(distinct sale_id)                                    as sales_count,
      coalesce(sum(sale_total), 0)                               as sales_eur,
      avg(sale_total)                                            as ticket_with,
      sum(margin_after) filter (where margin_after is not null)  as margin_real,
      count(margin_after)                                        as margin_known,
      count(*) - count(margin_after)                             as margin_missing
    from red
  ),
  series as (
    select to_char((sold_at at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD') as day,
           count(*)                    as redemptions,
           round(sum(discount_amount), 2) as discounted,
           round(sum(sale_total), 2)      as sales_eur
    from red
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'ok',            true,
    'kind',          v_kind,
    'redemptions',   (select redemptions from agg),
    'discounted',    (select round(discounted, 2) from agg),
    'salesCount',    (select sales_count from agg),
    'salesEur',      (select round(sales_eur, 2) from agg),
    'ticketWith',    (select round(ticket_with, 2) from agg),
    'ticketWithout', (select round(avg(total), 2) from shop_without),
    'marginReal',    (select case when (select margin_known from agg) > 0 then round((select margin_real from agg), 2) else null end),
    'marginKnown',   (select margin_known from agg),
    'marginMissing', (select margin_missing from agg),
    'giftCosted',    v_gift_costed,
    'cost',          (case when v_kind = 'free_item' and v_gift_costed
                           then round(v_gift_cost * (select redemptions from agg), 2)
                           else round((select discounted from agg), 2) end),
    'series',        coalesce((select jsonb_agg(jsonb_build_object(
                        'day', day, 'redemptions', redemptions, 'discounted', discounted, 'salesEur', sales_eur))
                      from series), '[]'::jsonb)
  ) into v_result;

  -- ROI = margen real / coste (solo si hay margen conocido y coste > 0).
  v_result := v_result || jsonb_build_object('roi',
    case when (v_result->>'marginReal') is not null and (v_result->>'cost')::numeric > 0
         then round((v_result->>'marginReal')::numeric / (v_result->>'cost')::numeric, 2)
         else null end);

  return v_result;
end;
$fn$;

grant execute on function public.campaign_performance(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- (2) list_campaigns += 'roi' (regenerado del texto vivo con guarda/idempotencia).
do $mig$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.list_campaigns(uuid)'::regprocedure);
  if position('''roi''' in v_def) > 0 then
    raise notice 'G2e: list_campaigns ya tiene roi; nada que hacer.';
    return;
  end if;
  -- margen conocido en la subquery lateral p
  v_def := replace(v_def,
    $a$sum(cr.discount_amount) as sum_disc,$a$,
    $r$sum(cr.discount_amount) as sum_disc,
             sum(cr.margin_after) filter (where cr.margin_after is not null) as margin_total,$r$);
  if position('margin_total' in v_def) = 0 then raise exception 'G2e: ancla sum_disc no encontrada en list_campaigns'; end if;
  -- roi en el jsonb de salida
  v_def := replace(v_def,
    $a$'avgMarginPct', p.avg_margin_pct$a$,
    $r$'avgMarginPct', p.avg_margin_pct,
             'roi', case when p.margin_total is not null and coalesce(p.sum_disc, 0) > 0
                         then round(p.margin_total / p.sum_disc, 2) else null end$r$);
  if position('''roi''' in v_def) = 0 then raise exception 'G2e: ancla avgMarginPct no encontrada en list_campaigns'; end if;
  execute v_def;
  raise notice 'G2e: roi añadido a list_campaigns.';
end
$mig$;

commit;
