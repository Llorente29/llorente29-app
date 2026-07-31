-- 20260731T1140_availability_report.sql
-- ============================================================================
-- DISPONIBILIDAD · C3a — RPC PRINCIPAL DEL PANEL DE INFORMES (§5). Devuelve
-- TODO el payload de una vez (patrón sales_dashboard): kpis (+ prev),
-- heatmap, trend, ranking, by_origin, by_reason, log. Consume:
--   · availability_intervals   (1100, §1 — cierres emparejados)
--   · availability_sales_profile (1110, §2 — venta media dow×hora)
--   · availability_location_open_minutes (1120, §4 — horas de apertura)
--   · availability_kpis        (1130, §3/§4 — factoriza el cálculo, se llama
--     dos veces: periodo actual + periodo anterior de igual duración)
--
-- HUECO DECLARADO — p_channel_id: la firma del encargo (§5, "aprox.") lo
-- incluye para que el filtro de la maqueta no tenga que cambiar cuando
-- exista, pero HOY es un NO-OP: availability_event no lleva canal (columna
-- `channels` reservada, sin escritor todavía — ver 20260731T1000). El
-- parámetro se acepta y se IGNORA. Avisar a Julio: si C3b pinta el selector
-- de canal, debe quedar claro que hoy no filtra nada (o esconderlo hasta que
-- exista el escritor).
--
-- lost_revenue_est / heatmap / trend / ranking / log se calculan sobre el
-- MISMO decompuesto en franjas de 1h (slice_loss) — una sola pasada, sin
-- duplicar la lógica de pérdidas entre bloques del payload.
--
-- FIX (antes de aplicar, mismo que en availability_kpis): `slices` recorta
-- cada intervalo a eff_start/eff_end = intersección con [p_from,p_to] ANTES
-- de generate_series — un cierre todavía abierto (ended_at=now()) podía
-- trocear semanas de más y colar pérdida/heatmap/trend fuera de la ventana
-- del informe. started_at/ended_at/duration_min ORIGINALES (sin recortar) se
-- conservan en la fila para el log y el ranking.
--
-- log: tope 500 filas (más recientes primero) para el panel — el export
-- completo (CSV/Excel) es cosa de C3b, que puede paginar sobre
-- availability_intervals directamente si hace falta más de 500.
--
-- SECURITY DEFINER + guard admin/manager de la cuenta (mismo patrón que
-- closed_brands/anomalous_brand_closures). Solo LECTURA — no escribe nada.
--
-- CUIDADO FIRMAS (lección de 20260731T1050): esta es function NUEVA, no hay
-- overload previo que limpiar. Si en el futuro se le cambian argumentos,
-- DROP de la firma vieja antes del create or replace.
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.availability_report(
  p_account_id  uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_location_id uuid default null,
  p_brand_id    uuid default null,
  p_channel_id  uuid default null,  -- NO-OP hoy, ver cabecera
  p_origin      text default null,
  p_scope       text default null,
  p_weeks       int  default 8
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result    jsonb;
  v_kpis      jsonb;
  v_kpis_prev jsonb;
  v_prev_from timestamptz;
  v_prev_to   timestamptz;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'availability_report: sin acceso a la cuenta %', p_account_id;
  end if;

  if p_scope is not null and p_scope not in ('product', 'brand', 'location') then
    raise exception 'availability_report: scope no válido %', p_scope;
  end if;

  v_prev_to   := p_from;
  v_prev_from := p_from - (p_to - p_from);

  v_kpis      := public.availability_kpis(p_account_id, p_from, p_to, p_weeks, p_location_id, p_brand_id, p_origin, p_scope);
  v_kpis_prev := public.availability_kpis(p_account_id, v_prev_from, v_prev_to, p_weeks, p_location_id, p_brand_id, p_origin, p_scope);

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
  clipped as (
    select iv.*,
      greatest(iv.started_at, p_from) as eff_start,
      least(iv.ended_at,      p_to)   as eff_end
    from intervals iv
  ),
  slices as (
    select
      c.scope, c.target_key, c.target_id, c.target_label, c.location_id,
      c.origin, c.reason_code, c.actor_id, c.started_at, c.ended_at, c.duration_min,
      bucket,
      (extract(isodow from (bucket at time zone 'Europe/Madrid'))::int - 1) as dow,
      extract(hour from (bucket at time zone 'Europe/Madrid'))::int as hour,
      (bucket at time zone 'Europe/Madrid')::date as local_day,
      greatest(0::numeric, (extract(epoch from (
        least(c.eff_end, bucket + interval '1 hour') - greatest(c.eff_start, bucket)
      )) / 60)::numeric) as closed_min
    from clipped c
    cross join lateral generate_series(
      date_trunc('hour', c.eff_start at time zone 'Europe/Madrid') at time zone 'Europe/Madrid',
      c.eff_end - interval '1 microsecond',
      interval '1 hour'
    ) as bucket
    where c.eff_end > c.eff_start
  ),
  slice_loss as (
    select sl.*, coalesce(p.avg_net, 0) * (sl.closed_min / 60.0) as loss
    from slices sl
    left join profile p
      on p.scope = sl.scope and p.target_key = sl.target_key and p.dow = sl.dow and p.hour = sl.hour
  ),
  interval_loss as (
    select
      scope, target_key, target_id, target_label, location_id, origin, reason_code, actor_id,
      started_at, ended_at, duration_min,
      sum(loss) as lost_revenue_est
    from slice_loss
    group by scope, target_key, target_id, target_label, location_id, origin, reason_code, actor_id,
             started_at, ended_at, duration_min
  ),
  heatmap_rows as (
    select dow, hour, sum(closed_min) as downtime_min
    from slices
    group by dow, hour
  ),
  trend_rows as (
    select local_day, sum(loss) as day_loss
    from slice_loss
    group by local_day
  ),
  ranking_rows as (
    select scope, target_key, coalesce(max(target_label), max(target_key)) as target_label,
           sum(lost_revenue_est) as rev
    from interval_loss
    group by scope, target_key
    order by sum(lost_revenue_est) desc
    limit 20
  ),
  origin_rows as (
    select origin, count(*) as closures, sum(duration_min) as downtime_min
    from intervals
    group by origin
  ),
  reason_rows as (
    select reason_code, count(*) as closures, sum(duration_min) as downtime_min
    from intervals
    group by reason_code
  ),
  log_rows as (
    select il.*, up.display_name as actor_name
    from interval_loss il
    left join user_profiles up on up.id = il.actor_id
    order by il.started_at desc
    limit 500
  )
  select jsonb_build_object(
    'kpis', coalesce(v_kpis, '{}'::jsonb) || jsonb_build_object('prev', coalesce(v_kpis_prev, '{}'::jsonb)),
    'heatmap', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'downtime_min', round(downtime_min::numeric, 1)) order by dow, hour)
      from heatmap_rows
    ), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object('day', local_day, 'lost_revenue_est', round(day_loss::numeric, 2)) order by local_day)
      from trend_rows
    ), '[]'::jsonb),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('scope', scope, 'target_label', target_label, 'lost_revenue_est', round(rev::numeric, 2)) order by rev desc)
      from ranking_rows
    ), '[]'::jsonb),
    'by_origin', coalesce((
      select jsonb_agg(jsonb_build_object('origin', origin, 'closures', closures, 'downtime_min', round(downtime_min::numeric, 1)))
      from origin_rows
    ), '[]'::jsonb),
    'by_reason', coalesce((
      select jsonb_agg(jsonb_build_object('reason_code', reason_code, 'closures', closures, 'downtime_min', round(downtime_min::numeric, 1)))
      from reason_rows
    ), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object(
        'scope', scope, 'target_label', target_label, 'origin', origin, 'reason_code', reason_code,
        'started_at', started_at, 'duration_min', round(duration_min::numeric, 1),
        'lost_revenue_est', round(lost_revenue_est::numeric, 2),
        'actor', actor_name
      ) order by started_at desc)
      from log_rows
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

grant execute on function public.availability_report(uuid, timestamptz, timestamptz, uuid, uuid, uuid, text, text, int) to authenticated;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.availability_report(uuid, timestamptz, timestamptz, uuid, uuid, uuid, text, text, int)') is null then
    raise exception 'availability_report no quedó creada con la firma esperada';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar, regla §1.bis — NO fiarse del "Success") ──
-- 1) select availability_report('<<ACCOUNT_ID>>', now() - interval '14 days', now());
-- Revisar a mano: kpis.prev existe y tiene los mismos 5 campos que kpis;
-- heatmap trae como mucho 7×24=168 filas; log ordenado started_at desc.
--
-- 2) Multi-tenant: repetir con un account_id DISTINTO y confirmar que los
-- números no se cruzan (no aparecen cierres de la cuenta 1 en el informe de la 2).
--
-- 3) Sin acceso: llamar con un account_id del que el usuario NO es
-- manager/admin -> debe lanzar excepción, no devolver datos.
--
-- 4) Sanity de pérdidas (§6): coger 1-2 cierres reales de availability_event,
-- calcular a mano la pérdida esperada con availability_sales_profile y
-- comparar contra el ranking/log de esta RPC.
--
-- 5) Uptime: comparar kpis.uptime_pct contra un cálculo a mano con
-- availability_location_open_minutes + availability_intervals(scope='location')
-- para el mismo local y periodo.
