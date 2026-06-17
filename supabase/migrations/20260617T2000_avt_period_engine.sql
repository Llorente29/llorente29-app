-- supabase/migrations/20260617T2000_avt_period_engine.sql
--
-- AvT capa 3+4 — MOTOR DE AVT POR PERIODO (consolidado).
--
-- Por cada artículo × local mide la merma ACUMULADA del periodo:
--   inicial + compras − consumo = teórico final ;  merma = teórico final − real final
-- donde:
--   inicial = último conteo aprobado ANTES del periodo (counted_qty); si no hay,
--             el movimiento 'apertura' del ledger (marcado initial_source='apertura');
--             si tampoco, sin inicial → no medible.
--   compras = Σ qty_base del ledger dentro del periodo de tipos que SUMAN stock
--             (recepcion, traspaso_entrada, y ajustes/aperturas positivos NO: el
--              inicial ya es el ancla; contamos solo entradas reales de mercancía).
--   consumo = −Σ qty_base del ledger tipo 'consumo' dentro del periodo (valor positivo).
--   real final = último conteo aprobado DENTRO del periodo (counted_qty); si no hay,
--                sin cierre → no medible.
-- Valoración en € con avg_unit_cost del stock (o computed_cost como respaldo).
-- Devuelve fila por artículo medible o no, con almacén/familia y estado del dato;
-- el front agrupa por local/almacén/familia/artículo. SECURITY INVOKER (RLS aplica).
--
-- NOTA sobre "compras": para no doblar el ancla, el inicial ES el punto de partida
-- y a partir de ahí solo sumamos ENTRADAS de mercancía (recepcion, traspaso_entrada)
-- y restamos consumo. Ajustes y mermas DENTRO del periodo no se suman al teórico:
-- son justamente lo que el conteo final revelará como desviación. (Si un ajuste ya
-- corrigió el stock a mitad de periodo, el conteo final lo recoge igual.)

create or replace function public.avt_period(
  p_account uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_location uuid default null   -- null = todos los locales de la cuenta
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with locs as (
  select id, name from locations
  where account_id = p_account and (p_location is null or id = p_location)
),
-- Universo: artículos que tienen ALGÚN conteo aprobado (inicial o final) en juego,
-- por local. Partimos de las líneas de conteos aprobados del local en el rango ampliado.
approved as (
  select ic.id as count_id, ic.location_id, ic.closed_at,
         il.recipe_item_id, il.counted_qty
  from inventory_count ic
  join inventory_count_line il on il.inventory_count_id = ic.id
  where ic.account_id = p_account
    and ic.status = 'aprobado'
    and ic.closed_at is not null
    and il.counted_qty is not null
    and (p_location is null or ic.location_id = p_location)
),
-- Conteo FINAL: el más reciente DENTRO del periodo, por artículo×local.
final_count as (
  select distinct on (location_id, recipe_item_id)
         location_id, recipe_item_id, counted_qty as real_final, closed_at as final_at
  from approved
  where closed_at >= p_from and closed_at < p_to
  order by location_id, recipe_item_id, closed_at desc
),
-- Conteo INICIAL real: el más reciente ANTES del periodo, por artículo×local.
initial_count as (
  select distinct on (location_id, recipe_item_id)
         location_id, recipe_item_id, counted_qty as init_count, closed_at as init_at
  from approved
  where closed_at < p_from
  order by location_id, recipe_item_id, closed_at desc
),
-- Apertura del ledger (respaldo de inicial): el movimiento 'apertura' por artículo×local.
opening_mv as (
  select location_id, recipe_item_id, sum(qty_base) as opening_qty
  from stock_movement
  where account_id = p_account
    and movement_type = 'apertura'
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
-- Compras (entradas de mercancía) dentro del periodo.
buys as (
  select location_id, recipe_item_id, sum(qty_base) as buys_qty
  from stock_movement
  where account_id = p_account
    and movement_type in ('recepcion','traspaso_entrada')
    and occurred_at >= p_from and occurred_at < p_to
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
-- Consumo teórico dentro del periodo (positivo).
cons as (
  select location_id, recipe_item_id, -sum(qty_base) as consumo_qty
  from stock_movement
  where account_id = p_account
    and movement_type = 'consumo'
    and occurred_at >= p_from and occurred_at < p_to
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
-- Universo de pares artículo×local medibles: los que tienen conteo final en el periodo.
universe as (
  select fc.location_id, fc.recipe_item_id, fc.real_final, fc.final_at
  from final_count fc
),
joined as (
  select u.location_id, u.recipe_item_id, u.real_final,
         ic.init_count, om.opening_qty,
         coalesce(b.buys_qty, 0) as buys_qty,
         coalesce(c.consumo_qty, 0) as consumo_qty,
         -- inicial efectivo + su origen
         case
           when ic.init_count is not null then ic.init_count
           when om.opening_qty is not null then om.opening_qty
           else null
         end as init_qty,
         case
           when ic.init_count is not null then 'conteo'
           when om.opening_qty is not null then 'apertura'
           else null
         end as init_source
  from universe u
  left join initial_count ic on ic.location_id = u.location_id and ic.recipe_item_id = u.recipe_item_id
  left join opening_mv om on om.location_id = u.location_id and om.recipe_item_id = u.recipe_item_id
  left join buys b on b.location_id = u.location_id and b.recipe_item_id = u.recipe_item_id
  left join cons c on c.location_id = u.location_id and c.recipe_item_id = u.recipe_item_id
),
enriched as (
  select j.*,
         ri.name as item_name,
         ri.needs_review,
         ri.family_id,
         rf.name as family_name,
         ku.abbreviation as unit_abbr,
         coalesce(rls.avg_unit_cost, ri.computed_cost, 0) as unit_cost,
         l.name as location_name,
         sa.name as area_name,
         -- teórico final y merma (solo si hay inicial)
         case when j.init_qty is not null
              then j.init_qty + j.buys_qty - j.consumo_qty else null end as theo_final,
         case when j.init_qty is not null
              then (j.init_qty + j.buys_qty - j.consumo_qty) - j.real_final else null end as merma_qty
  from joined j
  join recipe_item ri on ri.id = j.recipe_item_id
  left join recipe_family rf on rf.id = ri.family_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join recipe_item_location_stock rls
         on rls.recipe_item_id = j.recipe_item_id and rls.location_id = j.location_id and rls.account_id = p_account
  join locs l on l.id = j.location_id
  left join lateral (
    select sa.name
    from recipe_item_storage_area risa
    join storage_area sa on sa.id = risa.storage_area_id
    where risa.recipe_item_id = j.recipe_item_id and sa.location_id = j.location_id
    order by risa.position asc nulls last
    limit 1
  ) sa on true
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'recipe_item_id', e.recipe_item_id,
      'item_name', e.item_name,
      'location_id', e.location_id,
      'location_name', e.location_name,
      'area_name', e.area_name,
      'family_id', e.family_id,
      'family_name', e.family_name,
      'unit_abbr', e.unit_abbr,
      'init_qty', e.init_qty,
      'init_source', e.init_source,
      'buys_qty', e.buys_qty,
      'consumo_qty', e.consumo_qty,
      'theo_final', e.theo_final,
      'real_final', e.real_final,
      'merma_qty', e.merma_qty,
      'merma_eur', case when e.merma_qty is not null then round(e.merma_qty * e.unit_cost, 2) else null end,
      'status', case
        when e.init_qty is null then 'sin_apertura'
        when e.theo_final is not null and e.theo_final < 0 then 'dato_incompleto'
        when e.needs_review or e.unit_cost = 0 then 'escandallo_no_fiable'
        else 'medible'
      end,
      'init_estimated', (e.init_source = 'apertura')
    ) order by abs(coalesce(e.merma_qty * e.unit_cost, 0)) desc)
    from enriched e
  ), '[]'::jsonb)
);
$$;

grant execute on function public.avt_period(uuid, timestamptz, timestamptz, uuid) to authenticated;
