-- 20260708T1200_agent_offers_unified.sql
-- Aplicada: 2026-07-08
--
-- Pantalla unificada de "Ofertas del agente" (los 4 canales juntos). Lectura ÚNICA
-- server-side que sustituye el doble origen de datos (kitchen/platformOffersService
-- leía coupon crudo glovo/uber; shop/campaignService leía list_campaigns). Una fila
-- por oferta con forma IDÉNTICA para glovo/uber/justeat/shop:
--   - canal, kind, valor, tipo, origin, ventana (weekdays/franja/fechas)
--   - el PORQUÉ del agente (omnibus_ref_note, crudo; el parseo es del cliente)
--   - alcance resuelto a NOMBRES (marca + local) desde coupon.scope jsonb
--   - estado unificado y publishMode (auto/robot/manual) calculados en SQL
--   - agregado de promo_push_job (glovo/uber) + canjes/ROI (shop)
--
-- Universo (decisión de Julio 08/07): ofertas del agente en cualquier canal +
-- campañas de plataforma + promos de Shop (item/bogo/envío/regalo). EXCLUYE
-- bienvenida/fidelidad/código de Shop (viven en su pantalla del Shop).
--
-- El MARGEN real NO se calcula aquí (no está persistido; recalcularlo x126 por carga
-- es caro): el listado muestra canal·marca·valor·porqué·estado, y el margen se pide
-- al abrir la tarjeta vía preview_platform_promo_impact (ya existe). Deuda declarada
-- con disparador: si se quiere el margen impreso en cada fila del listado, el agente
-- debe escribirlo al proponer (offers-agent/index.ts) — frente aparte.
--
-- SECURITY DEFINER + guard de cuenta. NO ejecutar la función dentro de esta tx
-- (auth.uid() null en SQL Editor → EXCEPTION). Verificar desde la app.

begin;

drop function if exists public.agent_offers_unified(uuid);

create function public.agent_offers_unified(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        from jsonb_array_elements_text(coalesce(c.scope->'brand_ids', '[]'::jsonb)) as x(bid)
        join brand b on b.id = x.bid::uuid
      ) br on true
      left join lateral (
        select array_agg(l.name order by l.name) as names
        from jsonb_array_elements_text(coalesce(c.scope->'location_ids', '[]'::jsonb)) as x(lid)
        join locations l on l.id = x.lid::uuid
      ) lo on true
      left join lateral (
        select
          count(*)                                              as total,
          count(*) filter (where j.status = 'done')             as done,
          count(*) filter (where j.status in ('pending','sent')) as pending,
          count(*) filter (where j.status = 'error')            as error,
          (array_agg(j.last_error) filter (where j.status = 'error' and j.last_error is not null))[1] as last_error
        from promo_push_job j
        where j.coupon_id = c.id
      ) jb on true
      left join lateral (
        select
          count(*)                                                             as n,
          sum(cr.discount_amount)                                              as sum_disc,
          sum(cr.margin_after) filter (where cr.margin_after is not null)      as margin_total
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

grant execute on function public.agent_offers_unified(uuid) to authenticated;

commit;
