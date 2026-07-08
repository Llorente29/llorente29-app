-- 20260708T2400_agent_mechanic_signal.sql
--
-- APRENDIZAJE TRANSVERSAL (frente #2): una sola señal que mide el uplift de ventas por
-- MARCA × CANAL × MECÁNICA, para los 4 canales (Shop, Glovo, Uber, JustEat). Jubila las
-- dos señales parciales de hoy (agent_learning_signal solo miraba plataforma; la lógica
-- de aprendizaje de Happy Hour/regalo solo miraba Shop) → una verdad única.
--
-- Mecánica derivada del cupón: free_item→gift · bogo→bogo · free_delivery→free_delivery ·
-- item_percent con franja→happy_hour · resto (standard/item_percent plano)→pct. Así, cuando
-- el arsenal meta más tipos en cualquier canal, la señal ya los segmenta sin tocarla.
--
-- Uplift = (ventas durante la oferta − ventas de la ventana anterior de igual duración) /
-- ventana anterior, promediado. Misma matemática honesta que agent_learning_signal; solo se
-- añade la dimensión mecánica y se incluye el Shop. Ventana mínima 1 día.
--
-- SECURITY DEFINER, GRANT a service_role (la llama el offers-agent).

create or replace function public.agent_mechanic_signal(p_account_id uuid)
returns table (
  brand_id      uuid,
  channel_name  text,
  mechanic      text,
  n_medidas     int,
  uplift_medio  numeric,
  arranques     int
)
language sql
stable
security definer
set search_path = public
as $$
  with camp as (
    select c.id, c.starts_at,
           least(coalesce(c.ends_at, now()), now()) as dur_end,
           (select (jsonb_array_elements_text(c.scope->'brand_ids'))::uuid limit 1) as brand_id,
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(c.scope->'location_ids') x), null) as loc_ids,
           case
             when c.kind = 'free_item'     then 'gift'
             when c.kind = 'bogo'          then 'bogo'
             when c.kind = 'free_delivery' then 'free_delivery'
             when c.kind = 'item_percent' and c.time_from is not null then 'happy_hour'
             else 'pct'
           end as mechanic,
           case when c.channels = array['shop'] then 'Shop'
                else (select initcap(k) from unnest(c.channels) k where k <> 'shop' limit 1) end as ch_key
    from coupon c
    where c.account_id = p_account_id
      and c.origin = 'agent'
      and c.starts_at is not null
      and c.starts_at >= now() - interval '45 days'
      and c.starts_at < now()
  ),
  win as (
    select k.*,
           extract(epoch from (k.dur_end - k.starts_at)) / 86400.0 as dias,
           case when k.ch_key ilike 'uber%' then 'Uber' else k.ch_key end as channel_name
    from camp k
    where extract(epoch from (k.dur_end - k.starts_at)) / 86400.0 >= 1.0   -- ventana honesta
      and k.ch_key is not null
  ),
  cnt as (
    select w.id, w.brand_id, w.channel_name, w.mechanic, w.dias,
      count(s.id) filter (where s.created_at >= w.starts_at and s.created_at < w.dur_end) as n_dur,
      count(s.id) filter (where s.created_at >= w.starts_at - (w.dur_end - w.starts_at)
                            and s.created_at <  w.starts_at) as n_pre
    from win w
    left join sale s
      on s.account_id = p_account_id
     and s.brand_id = w.brand_id
     and s.order_status not in ('cancelled','rejected')
     and s.channel_id = (select id from sales_channel where account_id = p_account_id and name = w.channel_name limit 1)
     and (w.loc_ids is null or s.location_id = any(w.loc_ids))
    group by w.id, w.brand_id, w.channel_name, w.mechanic, w.dias
  )
  select c.brand_id, c.channel_name, c.mechanic,
         count(*)::int as n_medidas,
         round(avg(100.0 * (c.n_dur - c.n_pre) / nullif(c.n_pre, 0)), 1) as uplift_medio,
         (count(*) filter (where c.n_pre = 0 and c.n_dur > 0))::int as arranques
  from cnt c
  group by c.brand_id, c.channel_name, c.mechanic;
$$;

revoke all on function public.agent_mechanic_signal(uuid) from public;
grant execute on function public.agent_mechanic_signal(uuid) to service_role;
