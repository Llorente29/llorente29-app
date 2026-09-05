create or replace function public.quality_dashboard(
  p_account uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_location uuid default null, p_brand uuid default null
) returns jsonb
language sql stable security invoker as $$
  with rev as (
    select r.*, b.name as brand from public.channel_review r
    left join public.brand b on b.id=r.brand_id
    where r.account_id=p_account
      and (p_from is null or r.review_date >= p_from::date)
      and (p_to is null or r.review_date < p_to::date)
      and (p_location is null or r.location_id=p_location)
      and (p_brand is null or r.brand_id=p_brand)
  ),
  inc as (
    select i.*, b.name as brand from public.channel_incident i
    left join public.brand b on b.id=i.brand_id
    where i.account_id=p_account
      and (p_from is null or i.incident_date >= p_from::date)
      and (p_to is null or i.incident_date < p_to::date)
      and (p_location is null or i.location_id=p_location)
      and (p_brand is null or i.brand_id=p_brand)
  ),
  ops as (
    select o.*, b.name as brand from public.channel_ops_time o
    left join public.brand b on b.id=o.brand_id
    where o.account_id=p_account
      and (p_location is null or o.location_id=p_location)
      and (p_brand is null or o.brand_id=p_brand)
  ),
  tag_rows as (
    select trim(t) as tag from rev, unnest(string_to_array(coalesce(rev.tags,''), ',')) t
    where trim(t) <> ''
  )
  select jsonb_build_object(
    'ratings', jsonb_build_object(
      'n', (select count(*) from rev where stars is not null),
      'avg', (select round(avg(stars),2) from rev where stars is not null),
      'dist', (select coalesce(jsonb_object_agg(s::text, c),'{}'::jsonb) from (
        select stars::int s, count(*) c from rev where stars is not null group by 1) d)
    ),
    'by_brand', (select coalesce(jsonb_agg(x order by x.n desc),'[]'::jsonb) from (
      select brand, round(avg(stars),2) as avg, count(*) as n, count(*) filter (where stars<=2) as neg
      from rev where stars is not null and brand is not null group by brand) x),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object('stars',stars,'brand',brand,'txt',comment,'tags',tags) order by review_date),'[]'::jsonb)
      from rev where comment is not null and comment<>''),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object('tag',tag,'n',n) order by n desc),'[]'::jsonb) from (
      select tag, count(*) n from tag_rows group by tag) tg),
    'err_types', (select coalesce(jsonb_agg(jsonb_build_object('type',incident_type,'n',n) order by n desc),'[]'::jsonb) from (
      select incident_type, count(*) n from inc group by incident_type) e),
    'top_fail', (select coalesce(jsonb_agg(jsonb_build_object('item',item,'n',n) order by n desc),'[]'::jsonb) from (
      select split_part(item_name,' | ',1) as item, count(*) n from inc where item_name is not null group by 1 order by n desc limit 10) f),
    'refund', jsonb_build_object(
      'total', (select round(coalesce(sum(refund_total),0)) from inc),
      'own', (select round(coalesce(sum(refund_own),0)) from inc)),
    'incidencias', (select count(*) from inc),
    'tiempos', (select case when coalesce(sum(n_orders),0) > 0 then jsonb_build_object(
        'n', sum(n_orders),
        'prep_avg', round(sum(prep_avg*n_orders)/nullif(sum(n_orders),0),1),
        'delivery_avg', round(sum(delivery_avg*n_orders)/nullif(sum(n_orders),0),1),
        'total_avg', round(sum(total_avg*n_orders)/nullif(sum(n_orders),0),1),
        'wait_avoidable_total_h', round(sum(wait_avoidable_total_min)/60.0,1),
        'completion_pct', round(sum(completion_pct*n_orders)/nullif(sum(n_orders),0),1),
        'by_brand', (select coalesce(jsonb_agg(jsonb_build_object('brand',brand,'total',total,'n',nn) order by total desc),'[]'::jsonb) from (
          select brand, round(sum(total_avg*n_orders)/nullif(sum(n_orders),0),1) as total, sum(n_orders) nn
          from ops where brand is not null group by brand having sum(n_orders)>=20) bt)
      ) else null end from ops)
  );
$$;