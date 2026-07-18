-- 20260718T1700_uber_publishmode_robot.sql
-- Tablero unificado de ofertas: Uber pasa a publishMode 'robot' (antes 'manual' → "a mano").
-- Motivo (18/07/2026): se wireó el enrutado de Uber al brazo (uber-arm.mjs) en
-- agentOffersService.publishOffers (aprobar Uber encola promo_push_job platform='ubereats',
-- igual que Glovo). Por tanto el tablero debe mostrar Uber como canal con robot, no "a mano".
-- Cambio único: añadir `when 'uber' then 'robot'` al case de publishMode. El resto de la
-- función queda idéntico (estado 'publicada' sigue derivándose de jobsDone = jobsTotal).

CREATE OR REPLACE FUNCTION public.agent_offers_unified(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(o order by o_created desc)
    from (
      select
        jsonb_build_object(
          'id',            c.id,
          'name',          c.name,
          'channel',       coalesce(lower(c.channels[1]), 'shop'),
          'origin',        c.origin,
          'kind',          c.kind,
          'discountType',  c.discount_type,
          'value',         c.value,
          'active',        c.active,
          'pausedAt',      c.paused_at,
          'startsAt',      c.starts_at,
          'endsAt',        c.ends_at,
          'budgetMax',     c.budget_max,
          'weekdays',      c.weekdays,
          'timeFrom',      c.time_from,
          'timeTo',        c.time_to,
          'reason',        c.omnibus_ref_note,
          'brandNames',    coalesce(br.names, array[]::text[]),
          'locationNames', coalesce(lo.names, array[]::text[]),
          'gift', (case when c.kind = 'free_item' then (
            select jsonb_build_object('name', mi.name, 'min', c.min_subtotal, 'value', mi.price)
            from campaign_scope sc
            join menu_item mi on mi.id = sc.menu_item_id
            where sc.coupon_id = c.id and sc.menu_item_id is not null
            order by mi.price desc
            limit 1
          ) else null end),
          'jobsTotal',     coalesce(jb.total, 0),
          'jobsDone',      coalesce(jb.done, 0),
          'jobsPending',   coalesce(jb.pending, 0),
          'jobsError',     coalesce(jb.error, 0),
          'lastError',     jb.last_error,
          'redemptions',   coalesce(rd.n, 0),
          'discounted',    coalesce(rd.sum_disc, 0),
          'roi',           case when rd.margin_total is not null and coalesce(rd.sum_disc, 0) > 0
                                then round(rd.margin_total / rd.sum_disc, 2) else null end,
          'publishMode',   case coalesce(lower(c.channels[1]), 'shop')
                             when 'shop'  then 'auto'
                             when 'glovo' then 'robot'
                             when 'uber'  then 'robot'
                             else 'manual' end,
          'status', (case
            when c.ends_at is not null and c.ends_at <= now() then 'finalizada'
            when c.paused_at is not null then 'pausada'
            when not c.active then (case when c.origin = 'agent' then 'propuesta' else 'borrador' end)
            when c.starts_at is not null and c.starts_at > now() then 'programada'
            when c.budget_max is not null and coalesce(rd.sum_disc, 0) >= c.budget_max then 'agotada'
            when coalesce(lower(c.channels[1]), 'shop') = 'shop' then 'publicada'
            when coalesce(jb.total, 0) > 0 and coalesce(jb.done, 0) = jb.total then 'publicada'
            else 'pendiente'
          end)
        ) as o,
        c.created_at as o_created
      from coupon c
      left join lateral (
        select array_agg(b.name order by b.name) as names
        from jsonb_array_elements_text(
               case when jsonb_typeof(c.scope->'brand_ids') = 'array'
                    then c.scope->'brand_ids' else '[]'::jsonb end) as x(bid)
        join brand b on b.id = x.bid::uuid
      ) br on true
      left join lateral (
        select array_agg(l.name order by l.name) as names
        from jsonb_array_elements_text(
               case when jsonb_typeof(c.scope->'location_ids') = 'array'
                    then c.scope->'location_ids' else '[]'::jsonb end) as x(lid)
        join locations l on l.id = x.lid::uuid
      ) lo on true
      left join lateral (
        select
          count(*)                                               as total,
          count(*) filter (where j.status = 'done')              as done,
          count(*) filter (where j.status in ('pending','sent')) as pending,
          count(*) filter (where j.status = 'error')             as error,
          (array_agg(j.last_error) filter (where j.status = 'error' and j.last_error is not null))[1] as last_error
        from promo_push_job j
        where j.coupon_id = c.id
      ) jb on true
      left join lateral (
        select
          count(*)                                                        as n,
          sum(cr.discount_amount)                                         as sum_disc,
          sum(cr.margin_after) filter (where cr.margin_after is not null) as margin_total
        from coupon_redemption cr
        join sale s on s.id = cr.sale_id
        where cr.coupon_id = c.id and coalesce(s.status, '') <> 'cancelled'
      ) rd on true
      where c.account_id = p_account
        and (
          c.origin = 'agent'
          or coalesce(lower(c.channels[1]), 'shop') <> 'shop'
          or c.kind in ('item_percent','bogo','free_delivery','free_item')
        )
    ) src
  ), '[]'::jsonb);
end;
$function$;
