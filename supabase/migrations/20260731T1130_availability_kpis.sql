-- 20260731T1130_availability_kpis.sql
-- ============================================================================
-- DISPONIBILIDAD · C3a — KPIs de un periodo (helper interno de
-- availability_report, §5). Se llama DOS veces desde la RPC principal (periodo
-- actual + periodo anterior para la comparativa) — factorizado aquí para no
-- duplicar la lógica ni arriesgar que las dos mitades diverjan.
--
-- uptime_pct / downtime_hours: SIEMPRE a nivel LOCAL (scope='location'),
-- filtrado SOLO por p_location_id — nunca por p_scope/p_brand_id/p_origin.
-- Decisión de alcance (misma nota que 20260731T1120): el uptime es "¿está
-- abierta la puerta de delivery?", no una métrica por marca/producto. Si
-- Julio quiere uptime por marca, es una iteración futura (helper de horario
-- por marca aparte, ver 1120).
--
-- lost_revenue_est / closures_count / avoidable_pct: SÍ respetan TODOS los
-- filtros (p_scope/p_location_id/p_brand_id/p_origin) — son agregados sobre
-- TODOS los intervalos que matchean, de cualquier scope.
--
-- Pérdida estimada: decompone cada intervalo cerrado en franjas de 1h
-- (Europe/Madrid), prorratea la franja parcial por minutos cerrados, y
-- multiplica por el perfil de venta media de esa franja (§2/§3). Franja sin
-- histórico (avg_net=0 por LEFT JOIN + coalesce) -> suma 0, autocorrige.
--
-- avoidable_pct: evitable = reason_code in (sin_stock,incidencia); planificado
-- = reason_code in (fin_servicio,mantenimiento,promocion); reason_code NULL
-- (histórico previo a C3b) = sin clasificar, NO cuenta como evitable.
-- % = minutos evitables / minutos totales cerrados (el resto, incl. sin
-- clasificar y planificado, diluye el % sin subirlo).
--
-- SECURITY INVOKER (RLS de las tablas subyacentes ya exige manager/admin).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.availability_kpis(
  p_account_id  uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_weeks       int  default 8,
  p_location_id uuid default null,
  p_brand_id    uuid default null,
  p_origin      text default null,
  p_scope       text default null
)
returns jsonb
language sql
stable
as $function$
  with intervals as (
    select * from public.availability_intervals(p_account_id, p_from, p_to, p_scope, p_location_id, p_brand_id, p_origin)
  ),
  profile as (
    select 'location'::text as scope, * from public.availability_sales_profile(p_account_id, 'location', p_to, p_weeks)
    union all
    select 'brand'::text as scope, * from public.availability_sales_profile(p_account_id, 'brand', p_to, p_weeks)
    union all
    select 'product'::text as scope, * from public.availability_sales_profile(p_account_id, 'product', p_to, p_weeks)
  ),
  slices as (
    select
      iv.scope, iv.target_key, iv.started_at, iv.ended_at, bucket,
      (extract(isodow from (bucket at time zone 'Europe/Madrid'))::int - 1) as dow,
      extract(hour from (bucket at time zone 'Europe/Madrid'))::int as hour,
      greatest(0::numeric, (extract(epoch from (
        least(iv.ended_at, bucket + interval '1 hour') - greatest(iv.started_at, bucket)
      )) / 60)::numeric) as closed_min
    from intervals iv
    cross join lateral generate_series(
      date_trunc('hour', iv.started_at at time zone 'Europe/Madrid') at time zone 'Europe/Madrid',
      iv.ended_at - interval '1 microsecond',
      interval '1 hour'
    ) as bucket
  ),
  loss_total as (
    select coalesce(sum(coalesce(p.avg_net, 0) * (s.closed_min / 60.0)), 0) as lost_revenue_est
    from slices s
    left join profile p on p.scope = s.scope and p.target_key = s.target_key and p.dow = s.dow and p.hour = s.hour
  ),
  closures as (
    select
      count(*) as closures_count,
      coalesce(sum(duration_min), 0) as total_downtime_min,
      coalesce(sum(duration_min) filter (where reason_code in ('sin_stock', 'incidencia')), 0) as avoidable_min
    from intervals
  ),
  location_intervals as (
    select * from public.availability_intervals(p_account_id, p_from, p_to, 'location', p_location_id, null, null)
  ),
  target_locations as (
    select id as location_id from public.locations
    where account_id = p_account_id and coalesce(active, true)
      and (p_location_id is null or id = p_location_id)
  ),
  open_minutes as (
    select tl.location_id, om.opened_from, om.opened_until
    from target_locations tl
    cross join lateral public.availability_location_open_minutes(tl.location_id, p_from, p_to) om
  ),
  total_open as (
    select coalesce(sum(extract(epoch from (opened_until - opened_from)) / 60), 0) as total_open_min
    from open_minutes
  ),
  downtime_in_hours as (
    select coalesce(sum(
      greatest(0, extract(epoch from (
        least(li.ended_at, om.opened_until) - greatest(li.started_at, om.opened_from)
      )) / 60)
    ), 0) as downtime_open_min
    from location_intervals li
    join open_minutes om
      on om.location_id = li.target_id
      and li.started_at < om.opened_until and li.ended_at > om.opened_from
  )
  select jsonb_build_object(
    'uptime_pct', case when total_open.total_open_min > 0
      then round((1 - least(1, dh.downtime_open_min / total_open.total_open_min))::numeric * 100, 1)
      else null end,
    'downtime_hours', round((dh.downtime_open_min / 60.0)::numeric, 1),
    'lost_revenue_est', round(lt.lost_revenue_est::numeric, 2),
    'closures_count', cl.closures_count,
    'avoidable_pct', case when cl.total_downtime_min > 0
      then round((cl.avoidable_min / cl.total_downtime_min)::numeric * 100, 1)
      else null end
  )
  from loss_total lt, closures cl, total_open, downtime_in_hours dh
$function$;

grant execute on function public.availability_kpis(uuid, timestamptz, timestamptz, int, uuid, uuid, text, text) to authenticated;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.availability_kpis(uuid, timestamptz, timestamptz, int, uuid, uuid, text, text)') is null then
    raise exception 'availability_kpis no quedó creada con la firma esperada';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select availability_kpis('<<ACCOUNT_ID>>', now() - interval '7 days', now());
--
-- Sanity de pérdidas: con un cierre real conocido, calcular a mano 1-2 franjas
-- (perfil de esa franja × fracción de hora cerrada) y comparar contra
-- lost_revenue_est del jsonb.
--
-- Sanity de uptime: forzar (en datos de prueba) un cierre EN HORARIO y otro de
-- MADRUGADA (fuera de business_hours) -> solo el primero debe bajar uptime_pct.
