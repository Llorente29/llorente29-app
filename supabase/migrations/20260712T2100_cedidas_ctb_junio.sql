-- 20260712T2100_cedidas_ctb_junio.sql
-- Módulo Ventas — marcas CEDIDAS (Cloudtown / CTB): segundo motor de ingreso.
-- Cargado inicialmente vía MCP el 12/07/2026; este fichero versiona lo aplicado.
-- Cuenta Llorente29 = 51ad1792-6629-4ef7-833a-b57b09a86710 (data-load específico de cliente).
--
-- Contiene: (1) tabla cabecera licensed_settlement + RLS, (2) RPC
-- licensed_economics_dashboard, (3) carga junio de ventas cedidas en
-- channel_settlement (flow_type='licensed') + mapeo local, (4) cabeceras
-- licensed_settlement de junio (food_cost/packaging=0: el coste de cedidas NO
-- sale de CTB, va por compras propias/escandallo — pendiente).

-- (1) ─────────────────────────────────────────────────────────────────────
create table if not exists public.licensed_settlement (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  location_id uuid references public.locations(id),
  settlement_ref text,
  period_from date not null,
  period_to date not null,
  period_grain text default 'month',
  service_revenue numeric default 0,
  materials_supplied numeric default 0,
  stock_invoice_cost numeric default 0,
  food_cost numeric default 0,
  packaging_cost numeric default 0,
  net_settlement numeric default 0,
  source text default 'ctb_settlement',
  import_key text unique,
  raw jsonb,
  created_at timestamptz default now()
);
alter table public.licensed_settlement enable row level security;
drop policy if exists licensed_settlement_read on public.licensed_settlement;
create policy licensed_settlement_read on public.licensed_settlement
  for select using (account_id = any(public.current_user_account_ids()));
drop policy if exists licensed_settlement_write on public.licensed_settlement;
create policy licensed_settlement_write on public.licensed_settlement
  for all using (public.current_user_is_admin_of(account_id))
  with check (public.current_user_is_admin_of(account_id));

-- (2) ─────────────────────────────────────────────────────────────────────
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
grant execute on function public.licensed_economics_dashboard(uuid,timestamptz,timestamptz,uuid) to authenticated, anon;

-- (3) carga junio de ventas cedidas en channel_settlement (flow_type='licensed')
delete from channel_settlement where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and source='ctb_sales_detail' and period_from='2026-06-01';
insert into channel_settlement
 (account_id,channel_id,brand_id,location_id,settlement_ref,period_from,period_to,period_grain,
  gross_sales,net_payout,commission,promo_product,promo_flash,flow_type,source,import_key,external_location_text)
values
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02801','2026-06-01','2026-06-30','month',1875.68,472.87,1402.81,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_DosCoyotes_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','092fb053-fe28-4392-810b-92cc54e20723',NULL,'AF-02801','2026-06-01','2026-06-30','month',247.15,62.31,184.84,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_AyMamitaBowls_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','c8128975-b94a-4f98-b5e0-e025145f5e0f',NULL,'AF-02801','2026-06-01','2026-06-30','month',734.15,185.08,549.07,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_KoreansDoItBetter_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','5cb90109-1f41-4ae3-a780-a4f46a41b2dc',NULL,'AF-02801','2026-06-01','2026-06-30','month',126.08,31.79,94.29,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_MHaus_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02801','2026-06-01','2026-06-30','month',173.34,43.7,129.64,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_BigMikes_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','f675d9ae-7c99-4660-bcc2-21bb04a6194e',NULL,'AF-02801','2026-06-01','2026-06-30','month',416.31,104.95,311.36,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_BirriaBurrito_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02801','2026-06-01','2026-06-30','month',176.89,44.6,132.29,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Uber_Chivuos_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02801','2026-06-01','2026-06-30','month',611.06,152.76,458.3,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_Chivuos_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02801','2026-06-01','2026-06-30','month',2039.83,509.96,1529.87,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_DosCoyotes_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','467da045-849d-4f66-b784-0fdff191c2f4',NULL,'AF-02801','2026-06-01','2026-06-30','month',419.17,104.79,314.38,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_DeepPizza_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','5cb90109-1f41-4ae3-a780-a4f46a41b2dc',NULL,'AF-02801','2026-06-01','2026-06-30','month',778.45,194.61,583.84,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_MHaus_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','c8128975-b94a-4f98-b5e0-e025145f5e0f',NULL,'AF-02801','2026-06-01','2026-06-30','month',1413.69,353.42,1060.27,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_KoreansDoItBetter_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','f675d9ae-7c99-4660-bcc2-21bb04a6194e',NULL,'AF-02801','2026-06-01','2026-06-30','month',1469.94,367.49,1102.45,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_BirriaBurrito_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','092fb053-fe28-4392-810b-92cc54e20723',NULL,'AF-02801','2026-06-01','2026-06-30','month',1048.57,262.14,786.43,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_AyMamitaBowls_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02801','2026-06-01','2026-06-30','month',1385.65,346.41,1039.24,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_Glovo_BigMikes_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','60c822c8-e768-4290-8463-74e947564bcd','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02801','2026-06-01','2026-06-30','month',237.26,59.32,177.94,0,0,'licensed','ctb_sales_detail','ctb_AF-02801_JustEat_BigMikes_202606','jun'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02772','2026-06-01','2026-06-30','month',60.93,15.3,45.63,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_BigMikes_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02772','2026-06-01','2026-06-30','month',2146.11,538.82,1607.29,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_DosCoyotes_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','f675d9ae-7c99-4660-bcc2-21bb04a6194e',NULL,'AF-02772','2026-06-01','2026-06-30','month',318.14,79.88,238.26,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_BirriaBurrito_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02772','2026-06-01','2026-06-30','month',78.99,19.83,59.16,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_Chivuos_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','092fb053-fe28-4392-810b-92cc54e20723',NULL,'AF-02772','2026-06-01','2026-06-30','month',153.64,38.57,115.07,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_AyMamitaBowls_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','c8128975-b94a-4f98-b5e0-e025145f5e0f',NULL,'AF-02772','2026-06-01','2026-06-30','month',1408.15,353.54,1054.61,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_KoreansDoItBetter_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','5cb90109-1f41-4ae3-a780-a4f46a41b2dc',NULL,'AF-02772','2026-06-01','2026-06-30','month',534.78,134.27,400.51,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Uber_MHaus_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02772','2026-06-01','2026-06-30','month',437.58,109.43,328.15,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_Chivuos_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02772','2026-06-01','2026-06-30','month',5071.2,1268.2,3803.0,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_DosCoyotes_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','467da045-849d-4f66-b784-0fdff191c2f4',NULL,'AF-02772','2026-06-01','2026-06-30','month',581.92,145.53,436.39,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_DeepPizza_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','5cb90109-1f41-4ae3-a780-a4f46a41b2dc',NULL,'AF-02772','2026-06-01','2026-06-30','month',3478.27,869.84,2608.43,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_MHaus_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','c8128975-b94a-4f98-b5e0-e025145f5e0f',NULL,'AF-02772','2026-06-01','2026-06-30','month',2492.79,623.39,1869.4,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_KoreansDoItBetter_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','f675d9ae-7c99-4660-bcc2-21bb04a6194e',NULL,'AF-02772','2026-06-01','2026-06-30','month',810.25,202.63,607.62,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_BirriaBurrito_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','092fb053-fe28-4392-810b-92cc54e20723',NULL,'AF-02772','2026-06-01','2026-06-30','month',919.83,230.03,689.8,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_AyMamitaBowls_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02772','2026-06-01','2026-06-30','month',1047.26,261.9,785.36,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_Glovo_BigMikes_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','60c822c8-e768-4290-8463-74e947564bcd','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02772','2026-06-01','2026-06-30','month',102.25,29.5,72.75,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_JustEat_Chivuos_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','60c822c8-e768-4290-8463-74e947564bcd','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02772','2026-06-01','2026-06-30','month',220.25,63.55,156.7,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_JustEat_DosCoyotes_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','60c822c8-e768-4290-8463-74e947564bcd','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02772','2026-06-01','2026-06-30','month',249.25,71.92,177.33,0,0,'licensed','ctb_sales_detail','ctb_AF-02772_JustEat_BigMikes_202606','jun_1'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02802','2026-06-01','2026-06-30','month',1648.03,416.05,1231.98,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Uber_DosCoyotes_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','5cb90109-1f41-4ae3-a780-a4f46a41b2dc',NULL,'AF-02802','2026-06-01','2026-06-30','month',368.16,92.94,275.22,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Uber_MHaus_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','c8128975-b94a-4f98-b5e0-e025145f5e0f',NULL,'AF-02802','2026-06-01','2026-06-30','month',415.26,104.83,310.43,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Uber_KoreansDoItBetter_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','092fb053-fe28-4392-810b-92cc54e20723',NULL,'AF-02802','2026-06-01','2026-06-30','month',362.24,91.45,270.79,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Uber_AyMamitaBowls_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02802','2026-06-01','2026-06-30','month',0.0,0.0,0.0,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Uber_Chivuos_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','16ed2c7e-294b-4652-9a80-e5d3a241d2be','f675d9ae-7c99-4660-bcc2-21bb04a6194e',NULL,'AF-02802','2026-06-01','2026-06-30','month',538.83,136.03,402.8,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Uber_BirriaBurrito_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','d560f3a7-2213-4a5e-9832-be3d64917bc4',NULL,'AF-02802','2026-06-01','2026-06-30','month',273.21,68.3,204.91,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_Chivuos_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','63c85be9-15c9-48ed-ae2f-e9a3c63ef302',NULL,'AF-02802','2026-06-01','2026-06-30','month',2513.54,628.39,1885.15,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_DosCoyotes_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','467da045-849d-4f66-b784-0fdff191c2f4',NULL,'AF-02802','2026-06-01','2026-06-30','month',80.96,20.24,60.72,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_DeepPizza_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','5cb90109-1f41-4ae3-a780-a4f46a41b2dc',NULL,'AF-02802','2026-06-01','2026-06-30','month',3297.68,824.42,2473.26,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_MHaus_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','c8128975-b94a-4f98-b5e0-e025145f5e0f',NULL,'AF-02802','2026-06-01','2026-06-30','month',1337.3,334.33,1002.97,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_KoreansDoItBetter_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','f675d9ae-7c99-4660-bcc2-21bb04a6194e',NULL,'AF-02802','2026-06-01','2026-06-30','month',1252.48,313.12,939.36,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_BirriaBurrito_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','092fb053-fe28-4392-810b-92cc54e20723',NULL,'AF-02802','2026-06-01','2026-06-30','month',798.51,199.63,598.88,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_AyMamitaBowls_202606','jun_2'),
('51ad1792-6629-4ef7-833a-b57b09a86710','f98fcf5b-7ee3-4995-9a29-e755d2bd29f3','de93e5b4-8ec2-451e-ae92-1a54f127d754',NULL,'AF-02802','2026-06-01','2026-06-30','month',611.23,152.81,458.42,0,0,'licensed','ctb_sales_detail','ctb_AF-02802_Glovo_BigMikes_202606','jun_2');
-- (3b) mapeo liquidación → local (confirmado por Julio 12/07) ────────────────
update public.channel_settlement set location_id='38158159-cd71-4056-950b-53425afac1ce'
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and source='ctb_sales_detail' and settlement_ref='AF-02772';
update public.channel_settlement set location_id='629f9154-b888-48ed-9b8c-ffae77620615'
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and source='ctb_sales_detail' and settlement_ref='AF-02802';
update public.channel_settlement set location_id='92d7656e-082e-452a-8ebc-236b2d6ebf5f'
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and source='ctb_sales_detail' and settlement_ref='AF-02801';

-- (4) cabeceras licensed_settlement junio (food_cost/packaging=0: coste cedido
--     NO sale de CTB; se rellenará desde compras propias/escandallo) ──────────
insert into public.licensed_settlement
 (account_id, location_id, settlement_ref, period_from, period_to, period_grain,
  service_revenue, materials_supplied, stock_invoice_cost, food_cost, packaging_cost, net_settlement, import_key)
values
 ('51ad1792-6629-4ef7-833a-b57b09a86710','38158159-cd71-4056-950b-53425afac1ce','AF-02772','2026-06-01','2026-06-30','month',5056.12,3051.64,2046.18,0,0,6606.16,'ctbset_AF-02772_202606'),
 ('51ad1792-6629-4ef7-833a-b57b09a86710','629f9154-b888-48ed-9b8c-ffae77620615','AF-02802','2026-06-01','2026-06-30','month',3382.54,1808.22,1941.45,0,0,3519.42,'ctbset_AF-02802_202606'),
 ('51ad1792-6629-4ef7-833a-b57b09a86710','92d7656e-082e-452a-8ebc-236b2d6ebf5f','AF-02801','2026-06-01','2026-06-30','month',3296.21,1937.62,1739.67,0,0,3775.78,'ctbset_AF-02801_202606')
on conflict (import_key) do update set
  service_revenue=excluded.service_revenue, materials_supplied=excluded.materials_supplied,
  stock_invoice_cost=excluded.stock_invoice_cost, food_cost=excluded.food_cost,
  packaging_cost=excluded.packaging_cost, net_settlement=excluded.net_settlement;
