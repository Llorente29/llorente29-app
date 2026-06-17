-- supabase/migrations/20260617T1300_al1_buy_format_in_reads.sql
--
-- AL1 — Cantidad en formato de compra. Backend.
--
-- Reescribe las 3 RPC de lectura (storage_coverage, storage_orphans,
-- storage_zone_items) para que cada artículo traiga su FORMATO DE COMPRA DE
-- REFERENCIA = el nodo RAÍZ de su árbol de empaquetado (parent_format_id IS NULL,
-- el de mayor qty_in_base si hubiera varios). Devuelve, por artículo:
--   buy_format_name        (p.ej. "Caja")
--   buy_format_qty_in_base (cuánto vale ese formato en la unidad base: 4000 g)
--   buy_format_is_piece    (formato por pieza)
-- Si el artículo no tiene formato montado → los tres null (la UI cae a base).
--
-- Mismas firmas que antes (nombre + args) → NO hace falta regenerar database.ts.
-- SECURITY INVOKER, idempotente, sin ejecuciones dentro.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) storage_coverage  (KPIs + zonas con preview top-5)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.storage_coverage(
  p_account uuid,
  p_location uuid
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with universe as (
  select ri.id,
         ri.name,
         coalesce(ril.stock_value, 0) as value_eur,
         coalesce(ril.qty_on_hand, 0) as qty,
         ku.abbreviation as unit_abbr,
         bf.name as bf_name,
         bf.qty_in_base as bf_qib,
         bf.is_piece as bf_piece
  from recipe_item ri
  left join recipe_item_location_stock ril
    on ril.recipe_item_id = ri.id
   and ril.location_id = p_location
   and ril.account_id = p_account
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join lateral (
    select pf.name, pf.qty_in_base, pf.is_piece
    from recipe_item_purchase_format pf
    where pf.item_id = ri.id
      and pf.account_id = p_account
      and pf.parent_format_id is null
      and pf.is_active = true
      and pf.archived_at is null
    order by pf.qty_in_base desc
    limit 1
  ) bf on true
  where ri.account_id = p_account
    and ri.type = 'raw'
    and ri.is_active = true
),
primary_area as (
  select distinct on (rsa.recipe_item_id)
         rsa.recipe_item_id,
         sa.id as area_id
  from recipe_item_storage_area rsa
  join storage_area sa on sa.id = rsa.storage_area_id
  where rsa.account_id = p_account
    and sa.location_id = p_location
    and sa.active = true
  order by rsa.recipe_item_id, rsa.position asc, sa.position asc
),
item_area as (
  select u.id, u.name, u.value_eur, u.qty, u.unit_abbr,
         u.bf_name, u.bf_qib, u.bf_piece, pa.area_id
  from universe u
  left join primary_area pa on pa.recipe_item_id = u.id
),
zone_rows as (
  select sa.id, sa.name, sa.parent_id, sa.position,
         count(ia.id) as item_count,
         coalesce(sum(ia.value_eur), 0) as value_eur,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'recipe_item_id', t.id, 'name', t.name,
                    'value_eur', t.value_eur, 'qty', t.qty, 'unit_abbr', t.unit_abbr,
                    'buy_format_name', t.bf_name,
                    'buy_format_qty_in_base', t.bf_qib,
                    'buy_format_is_piece', t.bf_piece))
           from (
             select ia2.id, ia2.name, ia2.value_eur, ia2.qty, ia2.unit_abbr,
                    ia2.bf_name, ia2.bf_qib, ia2.bf_piece
             from item_area ia2
             where ia2.area_id = sa.id
             order by ia2.value_eur desc nulls last, ia2.name asc
             limit 5
           ) t
         ), '[]'::jsonb) as top_items
  from storage_area sa
  left join item_area ia on ia.area_id = sa.id
  where sa.account_id = p_account
    and sa.location_id = p_location
    and sa.active = true
  group by sa.id, sa.name, sa.parent_id, sa.position
)
select jsonb_build_object(
  'kpis', jsonb_build_object(
    'raw_active',   (select count(*) from universe),
    'placed',       (select count(*) from item_area where area_id is not null),
    'orphans',      (select count(*) from item_area where area_id is null),
    'total_value',  (select coalesce(sum(value_eur), 0) from universe),
    'orphan_value', (select coalesce(sum(value_eur), 0) from item_area where area_id is null)
  ),
  'zones', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', id, 'name', name, 'parent_id', parent_id, 'position', position,
             'item_count', item_count, 'value_eur', value_eur, 'top_items', top_items
           ) order by position asc, name asc)
    from zone_rows
  ), '[]'::jsonb)
);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) storage_orphans  (huérfanos por valor, paginado)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.storage_orphans(
  p_account uuid,
  p_location uuid,
  p_search text default null,
  p_family uuid default null,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with placed as (
  select distinct rsa.recipe_item_id
  from recipe_item_storage_area rsa
  join storage_area sa on sa.id = rsa.storage_area_id
  where rsa.account_id = p_account
    and sa.location_id = p_location
    and sa.active = true
),
orphans as (
  select ri.id, ri.name, ri.family_id, rf.name as family_name,
         coalesce(ril.stock_value, 0) as value_eur,
         coalesce(ril.qty_on_hand, 0) as qty,
         ku.abbreviation as unit_abbr,
         bf.name as bf_name, bf.qty_in_base as bf_qib, bf.is_piece as bf_piece
  from recipe_item ri
  left join recipe_item_location_stock ril
    on ril.recipe_item_id = ri.id
   and ril.location_id = p_location
   and ril.account_id = p_account
  left join recipe_family rf on rf.id = ri.family_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join lateral (
    select pf.name, pf.qty_in_base, pf.is_piece
    from recipe_item_purchase_format pf
    where pf.item_id = ri.id
      and pf.account_id = p_account
      and pf.parent_format_id is null
      and pf.is_active = true
      and pf.archived_at is null
    order by pf.qty_in_base desc
    limit 1
  ) bf on true
  where ri.account_id = p_account
    and ri.type = 'raw'
    and ri.is_active = true
    and ri.id not in (select recipe_item_id from placed)
    and (p_search is null or ri.name ilike '%' || p_search || '%')
    and (p_family is null or ri.family_id = p_family)
)
select jsonb_build_object(
  'total', (select count(*) from orphans),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'recipe_item_id', o.id, 'name', o.name,
             'family_id', o.family_id, 'family_name', o.family_name,
             'value_eur', o.value_eur, 'qty', o.qty, 'unit_abbr', o.unit_abbr,
             'buy_format_name', o.bf_name,
             'buy_format_qty_in_base', o.bf_qib,
             'buy_format_is_piece', o.bf_piece))
    from (
      select * from orphans
      order by value_eur desc nulls last, name asc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) o
  ), '[]'::jsonb)
);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) storage_zone_items  (artículos de una zona, paginado)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.storage_zone_items(
  p_account uuid,
  p_area uuid,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with items as (
  select ri.id, ri.name,
         coalesce(ril.stock_value, 0) as value_eur,
         coalesce(ril.qty_on_hand, 0) as qty,
         ku.abbreviation as unit_abbr,
         rsa.position,
         bf.name as bf_name, bf.qty_in_base as bf_qib, bf.is_piece as bf_piece
  from recipe_item_storage_area rsa
  join storage_area sa on sa.id = rsa.storage_area_id
  join recipe_item ri on ri.id = rsa.recipe_item_id and ri.is_active = true
  left join recipe_item_location_stock ril
    on ril.recipe_item_id = ri.id
   and ril.location_id = sa.location_id
   and ril.account_id = p_account
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join lateral (
    select pf.name, pf.qty_in_base, pf.is_piece
    from recipe_item_purchase_format pf
    where pf.item_id = ri.id
      and pf.account_id = p_account
      and pf.parent_format_id is null
      and pf.is_active = true
      and pf.archived_at is null
    order by pf.qty_in_base desc
    limit 1
  ) bf on true
  where rsa.account_id = p_account
    and rsa.storage_area_id = p_area
    and (p_search is null or ri.name ilike '%' || p_search || '%')
)
select jsonb_build_object(
  'total', (select count(*) from items),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'recipe_item_id', x.id, 'name', x.name,
             'value_eur', x.value_eur, 'qty', x.qty, 'unit_abbr', x.unit_abbr,
             'is_primary', (x.position = 0),
             'buy_format_name', x.bf_name,
             'buy_format_qty_in_base', x.bf_qib,
             'buy_format_is_piece', x.bf_piece))
    from (
      select * from items
      order by value_eur desc nulls last, name asc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) x
  ), '[]'::jsonb)
);
$$;

grant execute on function public.storage_coverage(uuid, uuid) to authenticated;
grant execute on function public.storage_orphans(uuid, uuid, text, uuid, int, int) to authenticated;
grant execute on function public.storage_zone_items(uuid, uuid, text, int, int) to authenticated;
