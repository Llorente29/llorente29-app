-- 20260718T1710_signal_excluir_locales_cerrados.sql
-- agent_sales_signal_v2: excluir del universo del agente los locales cerrados/vacaciones.
--
-- BUG (18/07/2026): un local marcado locations.active=false (p.ej. Plaza Castilla de
-- vacaciones en Glovo/Uber) SEGUÍA entrando en el universo de la señal, porque el CTE
-- brand_loc joinea locations pero NO filtraba l.active. Resultado: el agente proponía
-- ofertas para ese local, se aprobaban, y el robot fallaba ("ningún establecimiento ...")
-- porque la tienda está cerrada en la plataforma.
--
-- FIX: añadir `and l.active = true` al CTE brand_loc. Un solo cambio; el resto idéntico.

CREATE OR REPLACE FUNCTION public.agent_sales_signal_v2(p_account_id uuid)
 RETURNS TABLE(brand_id uuid, channel_name text, location_id uuid, location_name text, target_daily numeric, sales_7d numeric, avg_28d numeric, peak_daily numeric, ownership_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  channels as (
    select sc.id as channel_id, sc.name as channel_name,
           (sc.name <> 'Shop') as is_platform
    from sales_channel sc
    where sc.account_id = p_account_id
      and sc.is_active = true
  ),
  brand_loc as (
    select bla.brand_id, bla.location_id,
           b.name as brand_name, b.ownership_type,
           l.name as location_name
    from brand_location_availability bla
    join brand b on b.id = bla.brand_id and b.is_active = true
    join locations l on l.id = bla.location_id
    where bla.account_id = p_account_id
      and bla.is_active = true
      and l.active = true                    -- FIX 18/07: excluir locales cerrados/vacaciones
  ),
  universe as (
    select bl.brand_id, c.channel_name, bl.location_id, bl.location_name, bl.ownership_type
    from brand_loc bl
    cross join channels c
    where
      (bl.ownership_type <> 'licensed' OR c.is_platform = false)
  ),
  tgt as (
    select t.brand_id, sc.name as channel_name, t.location_id, t.target_daily
    from brand_channel_target t
    join sales_channel sc on sc.id = t.channel_id
    where t.account_id = p_account_id
      and t.target_daily > 0
  ),
  rec as (
    select s.brand_id, sc.name as channel_name, s.location_id,
      count(*) filter (where s.created_at >= now() - interval '7 days')  / 7.0  as s7,
      count(*) filter (where s.created_at >= now() - interval '28 days') / 28.0 as s28
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '28 days'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, s.location_id
  ),
  daily as (
    select s.brand_id, sc.name as channel_name, s.location_id,
           date_trunc('month', s.created_at) as mes,
           count(*) / greatest(extract(day from
             least(date_trunc('month', s.created_at) + interval '1 month', now())
             - date_trunc('month', s.created_at))::numeric, 1) as ventas_dia
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '12 months'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, s.location_id, date_trunc('month', s.created_at)
  ),
  peak as (
    select brand_id, channel_name, location_id, max(ventas_dia) as peak_daily
    from daily group by brand_id, channel_name, location_id
  )
  select
    u.brand_id,
    u.channel_name,
    u.location_id,
    u.location_name,
    t.target_daily,
    round(coalesce(r.s7, 0), 2)   as sales_7d,
    round(coalesce(r.s28, 0), 2)  as avg_28d,
    round(coalesce(p.peak_daily, 0), 2) as peak_daily,
    u.ownership_type
  from universe u
  left join tgt  t on t.brand_id = u.brand_id and t.channel_name = u.channel_name and t.location_id = u.location_id
  left join rec  r on r.brand_id = u.brand_id and r.channel_name = u.channel_name and r.location_id = u.location_id
  left join peak p on p.brand_id = u.brand_id and p.channel_name = u.channel_name and p.location_id = u.location_id;
$function$;
