-- Migración: agent_sales_signal_v2 — universo = TODOS los canales, no solo los que tienen objetivo
-- Aplicada: 2026-07-08
--
-- PROBLEMA (verificado 07/07): la señal arrancaba de brand_channel_target (los objetivos).
-- Como solo había objetivos de Glovo y Uber (24+24, cero de Shop/JustEat), el agente era CIEGO
-- al Shop (canal de más margen, 5%, auto-publicable) y a JustEat. foodint sin una sola oferta del agente.
--
-- ARREGLO: el universo pasa a ser el producto (marca activa × local donde opera × canal activo),
-- con el objetivo como dato OPCIONAL (LEFT JOIN, ya no la puerta de entrada).
--   · Marcas PROPIAS  → Glovo, Uber, JustEat, Shop (los 4)
--   · Marcas CEDIDAS  → SOLO Shop (regla de oro: cedidas nunca en plataforma de terceros)
--   · target_daily = objetivo si existe, si no NULL (el agente ya trata "sin objetivo" como cobertura mínima)
--   · Cobertura total de verdad: todas las combinaciones reales, con o sin objetivo.
--
-- NOTA: esta función vivía solo en BD (deuda de versionado). Esta migración la salda.

CREATE OR REPLACE FUNCTION public.agent_sales_signal_v2(p_account_id uuid)
 RETURNS TABLE(
   brand_id uuid, channel_name text, location_id uuid, location_name text,
   target_daily numeric, sales_7d numeric, avg_28d numeric, peak_daily numeric,
   ownership_type text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with
  -- canales activos de la cuenta, con su naturaleza (plataforma vs shop propio)
  channels as (
    select sc.id as channel_id, sc.name as channel_name,
           (sc.name <> 'Shop') as is_platform
    from sales_channel sc
    where sc.account_id = p_account_id
      and sc.is_active = true
  ),
  -- marca × local donde la marca OPERA de verdad (mapeo real, no producto ciego)
  brand_loc as (
    select bla.brand_id, bla.location_id,
           b.name as brand_name, b.ownership_type,
           l.name as location_name
    from brand_location_availability bla
    join brand b on b.id = bla.brand_id and b.is_active = true
    join locations l on l.id = bla.location_id
    where bla.account_id = p_account_id
      and bla.is_active = true
  ),
  -- UNIVERSO: cada (marca × local operativo) × cada canal válido para esa marca
  --   propias → todos los canales; cedidas → SOLO Shop
  universe as (
    select bl.brand_id, c.channel_name, bl.location_id, bl.location_name, bl.ownership_type
    from brand_loc bl
    cross join channels c
    where
      -- cedidas (licensed) solo en el Shop; propias en todos los canales
      (bl.ownership_type <> 'licensed' OR c.is_platform = false)
  ),
  -- objetivo diario, OPCIONAL (ya no es la fuente del universo)
  tgt as (
    select t.brand_id, sc.name as channel_name, t.location_id, t.target_daily
    from brand_channel_target t
    join sales_channel sc on sc.id = t.channel_id
    where t.account_id = p_account_id
      and t.target_daily > 0
  ),
  -- ventas recientes (7d y 28d) por marca×canal×local
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
  -- pico histórico (mejor mes de 12m) por marca×canal×local
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
    t.target_daily,                                   -- NULL si no hay objetivo (opcional)
    round(coalesce(r.s7, 0), 2)   as sales_7d,
    round(coalesce(r.s28, 0), 2)  as avg_28d,
    round(coalesce(p.peak_daily, 0), 2) as peak_daily,
    u.ownership_type
  from universe u
  left join tgt  t on t.brand_id = u.brand_id and t.channel_name = u.channel_name and t.location_id = u.location_id
  left join rec  r on r.brand_id = u.brand_id and r.channel_name = u.channel_name and r.location_id = u.location_id
  left join peak p on p.brand_id = u.brand_id and p.channel_name = u.channel_name and p.location_id = u.location_id;
$function$;
