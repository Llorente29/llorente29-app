-- supabase/migrations/20260617T1200_al1_storage_zones_rpcs.sql
--
-- AL1 — Cuerpo de gestión de almacén/zonas. Backend.
--
-- 4 RPC nuevas que dan de comer a la pantalla de AL1 (status de cobertura,
-- zonas vivas con preview, huérfanos por valor, asignación en bloque multi-zona):
--
--   1) storage_coverage(account, location)
--        → KPIs (raw activos, colocados, huérfanos, € en stock, € huérfanos)
--          + zonas: nº de artículos y € imputados a su ZONA PRINCIPAL, con los
--          5 top por valor para el preview.
--   2) storage_orphans(account, location, search, family, limit, offset)
--        → huérfanos (raw activos SIN zona en este local), por valor desc, paginado.
--   3) storage_zone_items(account, area, search, limit, offset)
--        → artículos de una zona, por valor desc, paginado (lista completa + buscador).
--          `position` 0 = zona principal del artículo (el resto = secundarias).
--   4) assign_items_to_zones(account, item_ids[], zone_ids[], primary_zone_id, mode)
--        → asignación EN BLOQUE + multi-zona. La principal recibe position 0
--          (la de menor position = la que lleva el €); las demás 10,20,…
--          mode 'add' = mantiene las zonas que ya tenga; 'replace' = fija solo estas
--          (quita el artículo de las OTRAS zonas DE ESTE LOCAL).
--
-- Decisiones cerradas que esto materializa:
--   - Stock por LOCAL; la zona organiza. El € por zona es una VISTA: SUM(stock_value)
--     de los artículos cuya zona principal es esa (sin doble conteo).
--   - Multi-zona: el € cuenta en la PRINCIPAL (position mínima); las secundarias 0/gris.
--   - Universo honesto = recipe_item type='raw' AND is_active (igual que el conteo).
--
-- SECURITY INVOKER a propósito: la RLS de estas tablas (la misma que ya usa la app
-- al asignar zonas) escopa por cuenta. No hay auth.uid() dentro → verificable.
-- Idempotente (CREATE OR REPLACE). NO se ejecuta ninguna función dentro del script.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cobertura del local + zonas (con preview top-5 por valor)
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
  -- raw activos del local + su valor de stock en este local
  select ri.id,
         ri.name,
         coalesce(ril.stock_value, 0) as value_eur,
         coalesce(ril.qty_on_hand, 0) as qty,
         ku.abbreviation as unit_abbr
  from recipe_item ri
  left join recipe_item_location_stock ril
    on ril.recipe_item_id = ri.id
   and ril.location_id = p_location
   and ril.account_id = p_account
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  where ri.account_id = p_account
    and ri.type = 'raw'
    and ri.is_active = true
),
primary_area as (
  -- zona PRINCIPAL de cada artículo en este local = la de menor position
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
  select u.id, u.name, u.value_eur, u.qty, u.unit_abbr, pa.area_id
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
                    'value_eur', t.value_eur, 'qty', t.qty, 'unit_abbr', t.unit_abbr))
           from (
             select ia2.id, ia2.name, ia2.value_eur, ia2.qty, ia2.unit_abbr
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
-- 2) Huérfanos del local (raw activos sin zona), por valor desc, paginado
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
         ku.abbreviation as unit_abbr
  from recipe_item ri
  left join recipe_item_location_stock ril
    on ril.recipe_item_id = ri.id
   and ril.location_id = p_location
   and ril.account_id = p_account
  left join recipe_family rf on rf.id = ri.family_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
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
             'value_eur', o.value_eur, 'qty', o.qty, 'unit_abbr', o.unit_abbr))
    from (
      select * from orphans
      order by value_eur desc nulls last, name asc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) o
  ), '[]'::jsonb)
);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Artículos de una zona, por valor desc, paginado (lista completa + buscador)
--    position 0 = principal; >0 = secundaria (la UI pinta su € en gris).
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
         rsa.position
  from recipe_item_storage_area rsa
  join storage_area sa on sa.id = rsa.storage_area_id
  join recipe_item ri on ri.id = rsa.recipe_item_id and ri.is_active = true
  left join recipe_item_location_stock ril
    on ril.recipe_item_id = ri.id
   and ril.location_id = sa.location_id
   and ril.account_id = p_account
  left join kitchen_unit ku on ku.id = ri.base_unit_id
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
             'is_primary', (x.position = 0)))
    from (
      select * from items
      order by value_eur desc nulls last, name asc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) x
  ), '[]'::jsonb)
);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Asignación EN BLOQUE + multi-zona. principal = position 0; resto 10,20,…
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_items_to_zones(
  p_account uuid,
  p_item_ids uuid[],
  p_zone_ids uuid[],
  p_primary_zone_id uuid,
  p_mode text default 'add'   -- 'add' | 'replace'
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_loc uuid;
  v_item uuid;
  v_zone uuid;
  v_pos int;
  v_assigned int := 0;
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return jsonb_build_object('assigned', 0);
  end if;
  if p_zone_ids is null or array_length(p_zone_ids, 1) is null then
    raise exception 'Hay que elegir al menos una zona';
  end if;
  if not (p_primary_zone_id = any (p_zone_ids)) then
    raise exception 'La zona principal debe estar entre las elegidas';
  end if;

  -- local de la operación = el de la zona principal (acota el 'replace')
  select location_id into v_loc
  from storage_area
  where id = p_primary_zone_id and account_id = p_account;
  if v_loc is null then
    raise exception 'Zona principal no válida';
  end if;

  foreach v_item in array p_item_ids loop
    if p_mode = 'replace' then
      -- quita el artículo de las OTRAS zonas de ESTE local (no toca otros locales)
      delete from recipe_item_storage_area rsa
      using storage_area sa
      where rsa.recipe_item_id = v_item
        and rsa.account_id = p_account
        and sa.id = rsa.storage_area_id
        and sa.location_id = v_loc;
    end if;

    v_pos := 10;
    foreach v_zone in array p_zone_ids loop
      insert into recipe_item_storage_area (account_id, recipe_item_id, storage_area_id, position)
      values (
        p_account, v_item, v_zone,
        case when v_zone = p_primary_zone_id then 0 else v_pos end
      )
      on conflict (recipe_item_id, storage_area_id)
      do update set position = excluded.position;
      if v_zone <> p_primary_zone_id then
        v_pos := v_pos + 10;
      end if;
    end loop;

    v_assigned := v_assigned + 1;
  end loop;

  return jsonb_build_object('assigned', v_assigned);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de ejecución (RLS hace el escopado por cuenta)
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.storage_coverage(uuid, uuid) to authenticated;
grant execute on function public.storage_orphans(uuid, uuid, text, uuid, int, int) to authenticated;
grant execute on function public.storage_zone_items(uuid, uuid, text, int, int) to authenticated;
grant execute on function public.assign_items_to_zones(uuid, uuid[], uuid[], uuid, text) to authenticated;
