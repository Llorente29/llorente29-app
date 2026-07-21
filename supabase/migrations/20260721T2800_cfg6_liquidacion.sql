-- 20260721T2800_cfg6_liquidacion.sql
-- CFG-6: LIQUIDACIÓN del repartidor (documento para pagar al autónomo).
-- Base auditable: transport_price (payout por entrega, ya con surge) + retos
-- conseguidos SELLADOS por periodo (para que un reto semanal no se pierda al
-- reiniciarse). RPC de informe por rango de fechas.

-- 1) Premios de retos sellados (idempotente por courier+reto+periodo).
CREATE TABLE IF NOT EXISTS public.courier_bonus_award (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL,
  courier_id  uuid NOT NULL REFERENCES public.courier(id) ON DELETE CASCADE,
  bonus_id    uuid NOT NULL REFERENCES public.courier_bonus(id) ON DELETE CASCADE,
  period_key  text NOT NULL,          -- 'd:2026-07-21' | 'w:2026-W29'
  reward      numeric NOT NULL,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier_id, bonus_id, period_key)
);
ALTER TABLE public.courier_bonus_award ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cba_select ON public.courier_bonus_award;
CREATE POLICY cba_select ON public.courier_bonus_award FOR SELECT USING (belongs_to_account(account_id));

-- 2) Sellar retos completados en la ventana vigente (día/semana). Idempotente.
CREATE OR REPLACE FUNCTION public.reparto_award_quests()
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  insert into courier_bonus_award(account_id, courier_id, bonus_id, period_key, reward)
  select qb.account_id, c.id, qb.id,
    case qb.period
      when 'day' then 'd:'||to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')
      else 'w:'||to_char((now() at time zone 'Europe/Madrid'), 'IYYY-"W"IW')
    end,
    qb.reward
  from courier c
  join courier_bonus qb on qb.account_id = c.account_id and qb.is_active
    and (qb.valid_from is null or (now() at time zone 'Europe/Madrid')::date >= qb.valid_from)
    and (qb.valid_to   is null or (now() at time zone 'Europe/Madrid')::date <= qb.valid_to)
    and (qb.location_id is null or c.assigned_locations = '{}'::uuid[] or qb.location_id = any(c.assigned_locations))
  where c.active
    and (
      select count(*) from delivery_assignment da
      where da.courier_id = c.id and da.state = 'delivered'
        and da.delivered_at >= (case qb.period
              when 'day' then (date_trunc('day',  now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid'
              else            (date_trunc('week', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid' end)
        and (qb.location_id is null or da.location_id = qb.location_id)
    ) >= qb.target_count
  on conflict (courier_id, bonus_id, period_key) do nothing;
$function$;

-- 3) Informe de liquidación por rango (admin/manager). Un fila por repartidor.
CREATE OR REPLACE FUNCTION public.reparto_liquidacion(p_from date, p_to date, p_location_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'courier_id', c.id, 'name', c.name, 'kind', c.kind, 'nif', c.nif, 'iban', c.iban,
    'deliveries', dl.deliveries, 'km', round(dl.km,1),
    'delivery_earnings', round(dl.earnings,2),
    'quest_bonus', round(qa.bonus,2),
    'total', round(dl.earnings + qa.bonus, 2)
  ) order by c.name), '[]'::jsonb)
  from courier c
  cross join lateral (
    select count(*)::int as deliveries,
           coalesce(sum(da.transport_price),0)::numeric as earnings,
           coalesce(sum(public.sale_delivery_distance_km(da.sale_id)),0)::numeric as km
    from delivery_assignment da
    where da.courier_id = c.id and da.state = 'delivered'
      and (da.delivered_at at time zone 'Europe/Madrid')::date between p_from and p_to
      and (p_location_id is null or da.location_id = p_location_id)
  ) dl
  cross join lateral (
    select coalesce(sum(a.reward),0)::numeric as bonus
    from courier_bonus_award a
    where a.courier_id = c.id
      and (a.awarded_at at time zone 'Europe/Madrid')::date between p_from and p_to
  ) qa
  where c.account_id = any(current_user_account_ids())
    and current_user_is_admin_or_manager_of(c.account_id)
    and (dl.deliveries > 0 or qa.bonus > 0);
$function$;

-- 4) Sellar retos periódicamente (cada 3 h) + una pasada inmediata.
do $$ begin perform cron.unschedule('reparto-award-quests'); exception when others then null; end $$;
select cron.schedule('reparto-award-quests', '5 */3 * * *', $$select public.reparto_award_quests()$$);
select public.reparto_award_quests();
