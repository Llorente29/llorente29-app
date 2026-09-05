create or replace function public.channel_trend_monthly(
  p_account uuid, p_channel uuid default null, p_brand uuid default null, p_location uuid default null
) returns jsonb
language sql stable security invoker as $$
  with m as (
    select to_char(date_trunc('month', order_date),'YYYY-MM') as mes,
      count(*) as pedidos,
      sum(coalesce(net_payout,0)+coalesce(commission,0)+coalesce(promo_product,0)+coalesce(promo_flash,0)) as venta,
      sum(coalesce(commission,0)) as comision,
      sum(coalesce(promo_product,0)+coalesce(promo_flash,0)) as promo,
      sum(coalesce(net_payout,0)) as pago,
      count(*) filter (where net_payout is not null) as con_pago
    from public.channel_settlement_order
    where account_id = p_account
      and order_date is not null
      and (p_channel is null or channel_id = p_channel)
      and (p_brand is null or brand_id = p_brand)
      and (p_location is null or location_id = p_location)
    group by 1
  )
  select jsonb_build_object(
    'months', coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'pedidos', pedidos, 'venta', round(venta), 'comision', round(comision),
      'comision_pct', round(100.0*comision/nullif(venta,0),1),
      'promo', round(promo), 'promo_pct', round(100.0*promo/nullif(venta,0),1),
      'pago', round(pago),
      'efect_pct', case when con_pago = pedidos then round(100.0*pago/nullif(venta,0),1) else null end
    ) order by mes), '[]'::jsonb)
  ) from m;
$$;
comment on function public.channel_trend_monthly is 'Evolucion mensual por canal (venta, comision, promo, pago, efectivo). Sobre channel_settlement_order (Capa C).';