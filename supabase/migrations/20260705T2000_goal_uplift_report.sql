-- 20260705T2000_goal_uplift_report.sql
-- MOTOR DE OFERTAS v2.1 · T3 — INFORME DE OBJETIVOS + UPLIFT (05/07/2026).
-- Dos preguntas que hoy nadie responde sin SQL: (1) ¿cómo va cada marca×canal×local
-- contra SU objetivo, y hacia dónde se mueve? (2) ¿las campañas del agente FUNCIONAN
-- (pedidos/día durante vs justo antes)? La segunda es además el cimiento del
-- autoaprendizaje (T6): sin uplift medido no hay nada que aprender.
-- Mecánica: mismas fuentes y filtros que agent_sales_signal_v2 (verificada hoy);
-- LANGUAGE sql STABLE + RLS del invocador (patrón preview_platform_promo_impact).
-- v1 HONESTA: uplift en PEDIDOS/DÍA (conteos, columnas verificadas). Ingresos y margen
-- real por campaña = T3.1 (requiere RECON de columnas de importes de sale — no se inventa).

begin;

-- ── 1. Consecución de objetivos: dónde está cada combinación y hacia dónde va
create or replace function public.offers_goal_report(p_account_id uuid)
 returns table(brand_id uuid, brand_name text, channel_name text,
               location_id uuid, location_name text,
               target_daily numeric, ped_dia_7d numeric, ped_dia_prev7 numeric,
               pct_objetivo numeric, tendencia_pct numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  with base as (
    select t.brand_id, b.name as brand_name, sc.name as channel_name,
           t.location_id, l.name as location_name, t.target_daily
    from brand_channel_target t
    join sales_channel sc on sc.id = t.channel_id
    join locations l on l.id = t.location_id
    join brand b on b.id = t.brand_id and b.is_active
    where t.account_id = p_account_id and t.target_daily > 0
  ),
  rec as (
    select s.brand_id, sc.name as channel_name, s.location_id,
      count(*) filter (where s.created_at >= now() - interval '7 days') / 7.0 as s7,
      count(*) filter (where s.created_at >= now() - interval '14 days'
                         and s.created_at <  now() - interval '7 days') / 7.0 as s7p
    from sale s
    join sales_channel sc on sc.id = s.channel_id
    where s.account_id = p_account_id
      and s.created_at >= now() - interval '14 days'
      and s.order_status not in ('cancelled','rejected')
    group by s.brand_id, sc.name, s.location_id
  )
  select b.brand_id, b.brand_name, b.channel_name, b.location_id, b.location_name,
         b.target_daily,
         round(coalesce(r.s7, 0), 2)  as ped_dia_7d,
         round(coalesce(r.s7p, 0), 2) as ped_dia_prev7,
         round(100 * coalesce(r.s7, 0) / nullif(b.target_daily, 0), 1) as pct_objetivo,
         case when coalesce(r.s7p, 0) = 0 then null
              else round(100 * (coalesce(r.s7,0) - r.s7p) / r.s7p, 1) end as tendencia_pct
  from base b
  left join rec r on r.brand_id = b.brand_id
                 and r.channel_name = b.channel_name
                 and r.location_id = b.location_id
  order by (coalesce(r.s7,0) / nullif(b.target_daily,0)) nulls first, b.brand_name;
$function$;

revoke all on function public.offers_goal_report(uuid) from public, anon;
grant execute on function public.offers_goal_report(uuid) to authenticated, service_role;

-- ── 2. Uplift de las campañas del agente: pedidos/día durante vs ventana previa igual
--      de larga, para la marca×canal(×locales) del alcance. arranque_desde_cero=true
--      cuando la base era 0 (el uplift % no se puede calcular pero el dato es elocuente).
create or replace function public.agent_campaign_uplift(p_account_id uuid, p_days_back integer default 30)
 returns table(coupon_id uuid, campaign_name text, brand_name text, channel_name text,
               ambito_locales text, dias_campaña numeric,
               ped_dia_antes numeric, ped_dia_durante numeric,
               uplift_pct numeric, arranque_desde_cero boolean, activa boolean)
 language sql
 stable
 set search_path to 'public'
as $function$
  with camp as (
    select c.id, c.name, c.starts_at,
           least(coalesce(c.ends_at, now()), now()) as dur_end,
           c.active,
           (select (jsonb_array_elements_text(c.scope->'brand_ids'))::uuid limit 1) as brand_id,
           coalesce(
             (select array_agg(x::uuid) from jsonb_array_elements_text(c.scope->'location_ids') x),
             null) as loc_ids,
           (select initcap(k) from unnest(c.channels) k where k <> 'shop' limit 1) as ch_key
    from coupon c
    where c.account_id = p_account_id
      and c.origin = 'agent'
      and c.starts_at is not null
      and c.starts_at >= now() - make_interval(days => p_days_back)
      and not (c.channels = array['shop'])
      and c.starts_at < now()
  ),
  win as (
    select k.*, b.name as brand_name,
           greatest(extract(epoch from (k.dur_end - k.starts_at)) / 86400.0, 0.25) as dias,
           case when k.ch_key ilike 'uber%' then 'Uber' else k.ch_key end as channel_name
    from camp k
    join brand b on b.id = k.brand_id
  ),
  cnt as (
    select w.id,
      count(s.id) filter (where s.created_at >= w.starts_at and s.created_at < w.dur_end) as n_dur,
      count(s.id) filter (where s.created_at >= w.starts_at - (w.dur_end - w.starts_at)
                            and s.created_at <  w.starts_at) as n_pre
    from win w
    left join sale s
      on s.account_id = p_account_id
     and s.brand_id = w.brand_id
     and s.order_status not in ('cancelled','rejected')
     and s.channel_id = (select id from sales_channel
                          where account_id = p_account_id and name = w.channel_name limit 1)
     and (w.loc_ids is null or s.location_id = any(w.loc_ids))
    group by w.id
  )
  select w.id, w.name, w.brand_name, w.channel_name,
         case when w.loc_ids is null then 'cuenta entera'
              else (select string_agg(replace(l.name, 'Foodint ', ''), ', ')
                      from locations l where l.id = any(w.loc_ids)) end,
         round(w.dias, 1),
         round(coalesce(c.n_pre, 0) / w.dias, 2) as ped_dia_antes,
         round(coalesce(c.n_dur, 0) / w.dias, 2) as ped_dia_durante,
         case when coalesce(c.n_pre, 0) = 0 then null
              else round(100.0 * (c.n_dur - c.n_pre) / c.n_pre, 1) end as uplift_pct,
         (coalesce(c.n_pre, 0) = 0 and coalesce(c.n_dur, 0) > 0) as arranque_desde_cero,
         w.active
  from win w
  join cnt c on c.id = w.id
  order by w.starts_at desc;
$function$;

revoke all on function public.agent_campaign_uplift(uuid, integer) from public, anon;
grant execute on function public.agent_campaign_uplift(uuid, integer) to authenticated, service_role;

commit;
