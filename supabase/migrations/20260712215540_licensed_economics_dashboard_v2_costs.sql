create or replace function public.licensed_economics_dashboard(
  p_account uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location uuid default null
) returns jsonb
language sql stable
as $function$
  with rows as (
    select cs.brand_id, b.name as brand, cs.channel_id, ch.name as channel, ch.slug as channel_slug,
           cs.location_id, l.name as location,
           coalesce(cs.gross_sales,0) as gross,
           coalesce(cs.net_payout,0)  as ingreso,
           coalesce(cs.commission,0)  as corte
    from public.channel_settlement cs
    left join public.brand b on b.id = cs.brand_id
    left join public.sales_channel ch on ch.id = cs.channel_id
    left join public.locations l on l.id = cs.location_id
    where cs.account_id = p_account
      and cs.flow_type = 'licensed'
      and cs.source = 'ctb_sales_detail'
      and (p_from is null or cs.period_to   >= p_from::date)
      and (p_to   is null or cs.period_from <  p_to::date)
      and (p_location is null or cs.location_id = p_location)
  ),
  by_brand as (
    select brand, brand_id,
      round(sum(gross),2) as gross, round(sum(ingreso),2) as ingreso,
      round(100.0*sum(ingreso)/nullif(sum(gross),0),1) as share_pct
    from rows where brand is not null group by brand, brand_id having sum(gross) > 0
  ),
  by_channel as (
    select channel, channel_slug, round(sum(gross),2) as gross, round(sum(ingreso),2) as ingreso
    from rows where channel is not null group by channel, channel_slug having sum(gross) > 0
  ),
  -- coste y contribución por local desde licensed_settlement (grano local-mes)
  costs as (
    select s.location_id, l.name as location,
      round(sum(s.service_revenue),2) as rev,
      round(sum(s.food_cost),2) as food,
      round(sum(s.packaging_cost),2) as packaging,
      round(sum(s.food_cost+s.packaging_cost),2) as coste,
      round(sum(s.service_revenue-(s.food_cost+s.packaging_cost)),2) as contrib,
      round(sum(s.materials_supplied-s.stock_invoice_cost),2) as material_net,
      round(sum(s.net_settlement),2) as saldo
    from public.licensed_settlement s
    left join public.locations l on l.id = s.location_id
    where s.account_id = p_account
      and (p_from is null or s.period_to   >= p_from::date)
      and (p_to   is null or s.period_from <  p_to::date)
      and (p_location is null or s.location_id = p_location)
    group by s.location_id, l.name having sum(s.service_revenue) <> 0 or sum(s.food_cost) <> 0
  )
  select jsonb_build_object(
    'total', jsonb_build_object(
      'gross', (select round(sum(gross),2) from rows),
      'ingreso', (select round(sum(ingreso),2) from rows),
      'corte', (select round(sum(corte),2) from rows),
      'share_pct', (select round(100.0*sum(ingreso)/nullif(sum(gross),0),1) from rows),
      'marcas', (select count(*) from by_brand),
      'coste', (select round(sum(coste),2) from costs),
      'contrib', (select round(sum(contrib),2) from costs),
      'material_net', (select round(sum(material_net),2) from costs)
    ),
    'by_brand', coalesce((select jsonb_agg(jsonb_build_object(
        'brand', brand, 'gross', gross, 'ingreso', ingreso, 'share_pct', share_pct
      ) order by ingreso desc) from by_brand), '[]'::jsonb),
    'by_channel', coalesce((select jsonb_agg(jsonb_build_object(
        'channel', channel, 'slug', channel_slug, 'gross', gross, 'ingreso', ingreso
      ) order by ingreso desc) from by_channel), '[]'::jsonb),
    'by_location', coalesce((select jsonb_agg(jsonb_build_object(
        'location', location, 'ingreso', rev, 'coste', coste, 'food', food, 'packaging', packaging,
        'contrib', contrib, 'material_net', material_net, 'saldo', saldo
      ) order by rev desc) from costs), '[]'::jsonb)
  );
$function$;