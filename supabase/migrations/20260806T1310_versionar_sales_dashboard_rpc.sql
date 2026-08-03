-- ============================================================================
-- Folvy · VERSIONAR DRIFT: sales_dashboard (RPC del dashboard de ventas)
-- ----------------------------------------------------------------------------
-- RPC que alimenta el dashboard de ventas (kpis + by_channel/brand/ownership/
-- location/hour + periodo anterior para el "vs"). Vive en producción y se llama
-- desde el cliente; su cuerpo solo estaba en la BBDD, nunca en el repo (drift
-- conocido, listado en folvy_estado.md). Hallado/confirmado en el RECON de hoy.
--
-- Volcado VERBATIM de pg_get_functiondef de lo vivo. Se incluye el GRANT a
-- authenticated (es una RPC de cliente vía PostgREST: sin él la app daría 403;
-- ya está concedido en producción) y el reload de PostgREST, para que el fichero
-- sea replayable en una BBDD limpia.
--
-- ⚠️ YA ESTÁ APLICADA EN PRODUCCIÓN. Registro para el repo; NO se re-ejecuta en
--    el SQL Editor. Reaplicarla sería inocuo (CREATE OR REPLACE idéntico).
--
-- Aplicada: (ya viva en producción; versionada como registro)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sales_dashboard(p_account_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_ownership text DEFAULT NULL::text, p_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_result jsonb;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_prev jsonb;
begin
  if not (p_account_id = any(current_user_account_ids())) then
    raise exception 'Sin acceso a la cuenta %', p_account_id;
  end if;

  select coalesce(timezone, 'Europe/Madrid') into v_tz
  from accounts where id = p_account_id;

  -- Periodo anterior de igual duración (para el "vs ayer / vs periodo").
  if p_from is not null and p_to is not null then
    v_prev_from := p_from - (p_to - p_from);
    v_prev_to   := p_from;
  end if;

  with base as (
    select
      s.id,
      (s.sold_at at time zone v_tz) as sold_local,
      coalesce(s.total,0) - coalesce(s.refund_amount,0) - coalesce(s.discount_amount,0) as net,
      s.brand_id, s.location_id,
      lower(coalesce(s.external_channel_text,'desconocido')) as canal,
      b.name as brand_name, b.ownership_type, l.name as local_name
    from sale s
    left join brand b on b.id = s.brand_id
    left join locations l on l.id = s.location_id
    where s.account_id = p_account_id
      and s.is_active = true
      and (p_from is null or s.sold_at >= p_from)
      and (p_to   is null or s.sold_at <  p_to)
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_brand_id    is null or s.brand_id = p_brand_id)
      and (p_ownership is null or b.ownership_type = p_ownership)
      and (p_channel   is null or lower(s.external_channel_text) = p_channel)
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'net', coalesce(round(sum(net),2),0),
        'orders', count(*),
        'aov', case when count(*)>0 then round(sum(net)/count(*),2) else 0 end
      ) from base
    ),
    'by_channel', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select canal as name, round(sum(net),2) as net, count(*) as orders
        from base group by canal) x
    ),
    'by_brand', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select brand_name as name, ownership_type, round(sum(net),2) as net, count(*) as orders
        from base where brand_id is not null group by brand_name, ownership_type) x
    ),
    'by_ownership', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select coalesce(ownership_type,'desconocido') as ownership,
               round(sum(net),2) as net, count(*) as orders
        from base group by ownership_type) x
    ),
    'by_location', (
      select coalesce(jsonb_agg(x order by x.net desc),'[]'::jsonb) from (
        select local_name as name, round(sum(net),2) as net, count(*) as orders
        from base where location_id is not null group by local_name) x
    ),
    'by_hour', (
      select coalesce(jsonb_agg(x order by x.hour),'[]'::jsonb) from (
        select extract(hour from sold_local)::int as hour,
               round(sum(net),2) as net, count(*) as orders
        from base group by extract(hour from sold_local)) x
    )
  ) into v_result;

  -- Bloque del periodo anterior (solo net + pedidos, para la comparación).
  if v_prev_from is not null then
    select jsonb_build_object(
      'net', coalesce(round(sum(
        coalesce(s.total,0)-coalesce(s.refund_amount,0)-coalesce(s.discount_amount,0)
      ),2),0),
      'orders', count(*)
    ) into v_prev
    from sale s
    left join brand b on b.id = s.brand_id
    where s.account_id = p_account_id
      and s.is_active = true
      and s.sold_at >= v_prev_from and s.sold_at < v_prev_to
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_brand_id    is null or s.brand_id = p_brand_id)
      and (p_ownership is null or b.ownership_type = p_ownership)
      and (p_channel   is null or lower(s.external_channel_text) = p_channel);
  else
    v_prev := jsonb_build_object('net', 0, 'orders', 0);
  end if;

  v_result := v_result || jsonb_build_object('prev', v_prev);
  return v_result;
end;
$function$;

grant execute on function public.sales_dashboard(uuid, timestamp with time zone, timestamp with time zone, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
