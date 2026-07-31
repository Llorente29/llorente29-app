-- 20260731T1110_availability_sales_profile.sql
-- ============================================================================
-- DISPONIBILIDAD · C3a — PERFIL DE VENTA MEDIA POR FRANJA (§2), en EUROS
-- NETOS (no unidades). Mismo espíritu que team_demand_profile
-- (20260709T2120: dow×hora, Europe/Madrid) pero sin filtrar por
-- demand_kind — aquí interesa TODA la venta, no solo la carga de cocina.
--
-- Neto:
--   · scope='location'|'brand' -> a nivel SALE: total - refund_amount - discount_amount.
--   · scope='product'          -> a nivel LÍNEA: sale_line.line_total, con
--     line_type='product'. target_key = coalesce(mi.external_id,
--     mi.recipe_item_id::text) — la MISMA identidad de "producto físico" que
--     usa availability_event.target_ext (C1), así un 86 de producto empareja
--     con la venta de TODAS las marcas que comparten ese físico.
--
-- Filtro de venta real (RECON 31/07, sale/sale_line en vivo vía database.ts —
-- el cuerpo de sales_dashboard NO está en el repo, no se depende de él):
--   is_active, status <> 'cancelled', order_status NOT IN
--   ('cancelled','rejected','delivery_failed') — order_status es NULLABLE
--   (la mayoría del histórico no lo trae): NULL se trata como "sin
--   incidencia conocida", CUENTA (no se excluye).
--
-- MEDIA POR OCURRENCIA (§2): Σneto de esa franja ÷ Nº DE ESE DÍA-DE-SEMANA EN
-- LA VENTANA (no ÷ nº de días con venta en esa franja — así una franja con
-- ventas esporádicas da una media baja de verdad, no inflada por solo contar
-- los días en que hubo algo). El divisor sale del CALENDARIO (generate_series
-- de fechas), independiente de si hubo venta.
--
-- Ventana: [p_to - p_weeks semanas, p_to). p_weeks default 8 (tunable, según
-- diseño aprobado). NOTA de precisión: si p_to no cae justo a medianoche, el
-- recuento de días por dow puede desviarse en como mucho 1 día en el borde —
-- aceptable (esto es una ESTIMACIÓN, no contabilidad exacta).
--
-- SECURITY INVOKER (RLS de `sale`/`sale_line` ya exige cuenta propia).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.availability_sales_profile(
  p_account_id uuid,
  p_scope      text,        -- 'location' | 'brand' | 'product'
  p_to         timestamptz,
  p_weeks      int default 8
)
returns table (
  target_key text,
  dow        int,           -- 0=lunes .. 6=domingo (extract(isodow)-1, igual que team_demand_profile)
  hour       int,           -- 0-23, Europe/Madrid
  avg_net    numeric
)
language sql
stable
as $function$
  with bounds as (
    select (p_to - (p_weeks || ' weeks')::interval) as p_from, p_to as p_to
  ),
  days as (
    select d::date as day
    from bounds, generate_series(
      (p_from at time zone 'Europe/Madrid')::date,
      (p_to   at time zone 'Europe/Madrid')::date - interval '1 day',
      interval '1 day'
    ) d
  ),
  dow_count as (
    select (extract(isodow from day)::int - 1) as dow, count(*)::numeric as n_days
    from days
    group by 1
  ),
  sales as (
    select s.id, s.location_id, s.brand_id, s.total, s.refund_amount, s.discount_amount, s.sold_at
    from public.sale s, bounds
    where s.account_id = p_account_id
      and coalesce(s.is_active, true)
      and s.status <> 'cancelled'
      and (s.order_status is null or s.order_status not in ('cancelled', 'rejected', 'delivery_failed'))
      and s.sold_at >= bounds.p_from and s.sold_at < bounds.p_to
  ),
  net_by_location as (
    select
      location_id::text as target_key,
      (extract(isodow from (sold_at at time zone 'Europe/Madrid'))::int - 1) as dow,
      extract(hour from (sold_at at time zone 'Europe/Madrid'))::int as hour,
      sum(total - coalesce(refund_amount, 0) - coalesce(discount_amount, 0)) as net_sum
    from sales
    where location_id is not null
    group by 1, 2, 3
  ),
  net_by_brand as (
    select
      brand_id::text as target_key,
      (extract(isodow from (sold_at at time zone 'Europe/Madrid'))::int - 1) as dow,
      extract(hour from (sold_at at time zone 'Europe/Madrid'))::int as hour,
      sum(total - coalesce(refund_amount, 0) - coalesce(discount_amount, 0)) as net_sum
    from sales
    where brand_id is not null
    group by 1, 2, 3
  ),
  net_by_product as (
    select
      coalesce(mi.external_id, mi.recipe_item_id::text) as target_key,
      (extract(isodow from (s.sold_at at time zone 'Europe/Madrid'))::int - 1) as dow,
      extract(hour from (s.sold_at at time zone 'Europe/Madrid'))::int as hour,
      sum(sl.line_total) as net_sum
    from public.sale s, bounds
    join public.sale_line sl on sl.sale_id = s.id and sl.line_type = 'product'
    join public.menu_item mi on mi.id = sl.menu_item_id
    where s.account_id = p_account_id
      and coalesce(s.is_active, true)
      and s.status <> 'cancelled'
      and (s.order_status is null or s.order_status not in ('cancelled', 'rejected', 'delivery_failed'))
      and s.sold_at >= bounds.p_from and s.sold_at < bounds.p_to
      and (mi.external_id is not null or mi.recipe_item_id is not null)
    group by 1, 2, 3
  ),
  chosen as (
    select * from net_by_location where p_scope = 'location'
    union all
    select * from net_by_brand where p_scope = 'brand'
    union all
    select * from net_by_product where p_scope = 'product'
  )
  select c.target_key, c.dow, c.hour,
         round((coalesce(c.net_sum, 0) / dc.n_days)::numeric, 2) as avg_net
  from chosen c
  join dow_count dc on dc.dow = c.dow
$function$;

grant execute on function public.availability_sales_profile(uuid, text, timestamptz, int) to authenticated;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.availability_sales_profile(uuid, text, timestamptz, int)') is null then
    raise exception 'availability_sales_profile no quedó creada con la firma esperada';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- 1) Perfil de un local real, últimas 8 semanas:
-- select * from availability_sales_profile('<<ACCOUNT_ID>>', 'location', now())
-- order by dow, hour;
--
-- 2) Sanity a mano: coger un dow/hour con venta conocida y comparar avg_net
-- contra Σneto manual (select sum(total-refund_amount-discount_amount) from sale
-- where ... sold_at en esa franja en las 8 semanas) ÷ nº de esa franja en la ventana.
--
-- 3) Confirmar que una franja de madrugada sin histórico devuelve 0, no NULL
-- ni excepción (coalesce(net_sum,0) lo cubre).
