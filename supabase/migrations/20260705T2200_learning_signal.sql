-- 20260705T2200_learning_signal.sql
-- MOTOR DE OFERTAS v2.1 · T6 — AUTOAPRENDIZAJE (05/07/2026).
-- Filosofía: aprendizaje DETERMINISTA Y AUDITABLE, sin estado oculto que derive — el
-- agente recalcula en cada corrida lo aprendido desde el uplift MEDIDO (T3) y lo dice
-- en el razonamiento. Esta RPC agrega, por marca×canal, las campañas del agente de los
-- últimos 45 días con ventana HONESTA (>=1 día vivido; la regla de honestidad de ventana
-- se descubrió hoy con -100% falsos de campañas de 0,6 días):
--   n_medidas · uplift medio (solo campañas con base > 0) · arranques desde cero.
-- El agente v1.6 solo actúa con n_medidas >= 2 (jamás aprender de un solo dato):
--   uplift medio <= 0 y 0 arranques -> marca promo-insensible en ese canal: -5 de
--   profundidad y sugerencia de cambiar de táctica (2x1). Histórico favorable -> se
--   deja constancia sin gastar más (lo que funciona no se sobrepaga).

begin;

create or replace function public.agent_learning_signal(p_account_id uuid)
 returns table(brand_id uuid, channel_name text, n_medidas integer,
               uplift_medio numeric, arranques integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  with camp as (
    select c.id, c.starts_at,
           least(coalesce(c.ends_at, now()), now()) as dur_end,
           (select (jsonb_array_elements_text(c.scope->'brand_ids'))::uuid limit 1) as brand_id,
           coalesce(
             (select array_agg(x::uuid) from jsonb_array_elements_text(c.scope->'location_ids') x),
             null) as loc_ids,
           (select initcap(k) from unnest(c.channels) k where k <> 'shop' limit 1) as ch_key
    from coupon c
    where c.account_id = p_account_id
      and c.origin = 'agent'
      and c.starts_at is not null
      and c.starts_at >= now() - interval '45 days'
      and not (c.channels = array['shop'])
      and c.starts_at < now()
  ),
  win as (
    select k.*,
           extract(epoch from (k.dur_end - k.starts_at)) / 86400.0 as dias,
           case when k.ch_key ilike 'uber%' then 'Uber' else k.ch_key end as channel_name
    from camp k
    where extract(epoch from (k.dur_end - k.starts_at)) / 86400.0 >= 1.0  -- ventana honesta
  ),
  cnt as (
    select w.id, w.brand_id, w.channel_name, w.dias,
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
    group by w.id, w.brand_id, w.channel_name, w.dias
  )
  select c.brand_id, c.channel_name,
         count(*)::int as n_medidas,
         round(avg(100.0 * (c.n_dur - c.n_pre) / nullif(c.n_pre, 0)), 1) as uplift_medio,
         (count(*) filter (where c.n_pre = 0 and c.n_dur > 0))::int as arranques
  from cnt c
  group by c.brand_id, c.channel_name;
$function$;

revoke all on function public.agent_learning_signal(uuid) from public, anon;
grant execute on function public.agent_learning_signal(uuid) to authenticated, service_role;

commit;
