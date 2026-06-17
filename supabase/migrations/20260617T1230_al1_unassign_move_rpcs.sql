-- supabase/migrations/20260617T1230_al1_unassign_move_rpcs.sql
--
-- AL1 — Quitar y mover artículos de zonas. Backend (2/2).
--
--   5) unassign_items_from_zones(account, location, item_ids[], zone_ids[])
--        Quita asignaciones. Semántica unificada:
--          - item_ids null  → todos los artículos de las zonas dadas (= vaciar zona)
--          - zone_ids null  → de TODAS las zonas del local (= mandar a huérfano)
--          - ambos dados     → esos artículos en esas zonas
--        Tras quitar, re-normaliza la principal de cada artículo tocado.
--
--   6) move_items_to_zone(account, item_ids[], from_zone_id, to_zone_id)
--        Mueve de una zona a otra CONSERVANDO el resto de zonas del artículo.
--        El destino HEREDA el rol del origen (si el origen era la principal, el
--        destino pasa a principal). from_zone_id null = mover desde huérfanos (= add).
--
-- Complementan a assign_items_to_zones (asignar / multi-zona / replace).
-- Re-normalización: las zonas restantes del artículo EN ESE LOCAL se reordenan
-- 0,10,20… por position → la de menor position queda como principal (position 0).
-- Se reordena por la clave natural (recipe_item_id, storage_area_id) — no se asume
-- ninguna PK surrogada.
--
-- SECURITY INVOKER: la RLS escopa por cuenta. Idempotente. Sin ejecuciones dentro.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Quitar / vaciar
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.unassign_items_from_zones(
  p_account uuid,
  p_location uuid,
  p_item_ids uuid[] default null,
  p_zone_ids uuid[] default null
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_affected uuid[];
  v_removed int;
begin
  if p_location is null then
    raise exception 'Falta el local';
  end if;

  -- borra las asignaciones objetivo y recoge los artículos tocados
  with del as (
    delete from recipe_item_storage_area rsa
    using storage_area sa
    where rsa.storage_area_id = sa.id
      and rsa.account_id = p_account
      and sa.location_id = p_location
      and (p_zone_ids is null or rsa.storage_area_id = any (p_zone_ids))
      and (p_item_ids is null or rsa.recipe_item_id = any (p_item_ids))
    returning rsa.recipe_item_id
  )
  select array_agg(distinct recipe_item_id), count(*)
  into v_affected, v_removed
  from del;

  -- re-normaliza la principal de los artículos que aún conservan zonas en el local
  if v_affected is not null then
    with ranked as (
      select rsa.recipe_item_id,
             rsa.storage_area_id,
             (row_number() over (
                partition by rsa.recipe_item_id
                order by rsa.position asc, sa.position asc
             ) - 1) * 10 as new_pos
      from recipe_item_storage_area rsa
      join storage_area sa on sa.id = rsa.storage_area_id
      where rsa.account_id = p_account
        and sa.location_id = p_location
        and rsa.recipe_item_id = any (v_affected)
    )
    update recipe_item_storage_area t
    set position = ranked.new_pos
    from ranked
    where t.recipe_item_id = ranked.recipe_item_id
      and t.storage_area_id = ranked.storage_area_id
      and t.position <> ranked.new_pos;
  end if;

  return jsonb_build_object('removed', coalesce(v_removed, 0));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Mover de una zona a otra (conserva el resto; el destino hereda el rol)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.move_items_to_zone(
  p_account uuid,
  p_item_ids uuid[],
  p_from_zone_id uuid,
  p_to_zone_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_loc uuid;
  v_item uuid;
  v_from_pos int;
  v_moved int := 0;
begin
  if p_to_zone_id is null then
    raise exception 'Falta la zona de destino';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return jsonb_build_object('moved', 0);
  end if;

  select location_id into v_loc
  from storage_area
  where id = p_to_zone_id and account_id = p_account;
  if v_loc is null then
    raise exception 'Zona de destino no válida';
  end if;

  foreach v_item in array p_item_ids loop
    v_from_pos := null;

    if p_from_zone_id is not null then
      select position into v_from_pos
      from recipe_item_storage_area
      where recipe_item_id = v_item
        and storage_area_id = p_from_zone_id
        and account_id = p_account;

      delete from recipe_item_storage_area
      where recipe_item_id = v_item
        and storage_area_id = p_from_zone_id
        and account_id = p_account;
    end if;

    -- añade (o reposiciona) en la zona destino heredando la position del origen
    insert into recipe_item_storage_area (account_id, recipe_item_id, storage_area_id, position)
    values (p_account, v_item, p_to_zone_id, coalesce(v_from_pos, 0))
    on conflict (recipe_item_id, storage_area_id)
    do update set position = excluded.position;

    -- re-normaliza el orden/principal del artículo en el local destino
    with ranked as (
      select rsa.recipe_item_id,
             rsa.storage_area_id,
             (row_number() over (
                order by rsa.position asc, sa.position asc
             ) - 1) * 10 as new_pos
      from recipe_item_storage_area rsa
      join storage_area sa on sa.id = rsa.storage_area_id
      where rsa.account_id = p_account
        and sa.location_id = v_loc
        and rsa.recipe_item_id = v_item
    )
    update recipe_item_storage_area t
    set position = ranked.new_pos
    from ranked
    where t.recipe_item_id = ranked.recipe_item_id
      and t.storage_area_id = ranked.storage_area_id
      and t.position <> ranked.new_pos;

    v_moved := v_moved + 1;
  end loop;

  return jsonb_build_object('moved', v_moved);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.unassign_items_from_zones(uuid, uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.move_items_to_zone(uuid, uuid[], uuid, uuid) to authenticated;
