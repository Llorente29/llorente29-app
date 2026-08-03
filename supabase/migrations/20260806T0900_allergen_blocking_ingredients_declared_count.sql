-- Alérgenos Capa 2 — allergen_blocking_ingredients gana declared_count.
--
-- Encargo del informe PDF rediseñado: la página "qué falta" tiene que decir
-- POR QUÉ bloquea cada ingrediente, no solo cuántos platos afecta.
-- declared_count = cuántos de los 14 códigos tiene el ingrediente en
-- recipe_item_allergen (con cualquier estado). El cliente distingue:
--   declared_count = 0  -> "pendiente de ficha técnica del proveedor"
--                          (nadie lo ha mirado nunca)
--   declared_count > 0  -> "sin declarar (dato parcial)"
--                          (alguien empezó, falta terminar o hay un unknown)
--
-- Cambia la firma de retorno (columna nueva) -> DROP FUNCTION antes del
-- CREATE (Postgres no permite CREATE OR REPLACE si cambia el RETURNS TABLE).
-- Aplicar por SQL Editor a mano. Verificar con una llamada real aparte.

drop function if exists public.allergen_blocking_ingredients(uuid);

create or replace function public.allergen_blocking_ingredients(
  p_account_id uuid
) returns table(
  ingredient_id uuid,
  ingredient_name text,
  dish_count integer,
  declared_count integer
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'allergen_blocking_ingredients: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with sellable_dishes as (
    select distinct mi.recipe_item_id
    from menu_item mi
    join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.account_id = p_account_id
      and mi.archived_at is null
      and coalesce(mi.product_type, 'item') <> 'combo'
      and ri.type = 'dish'
  ),
  dish_raws as (
    select distinct sd.recipe_item_id as dish_id, e.raw_item_id
    from sellable_dishes sd
    cross join lateral public.explode_recipe_to_raws(sd.recipe_item_id, 1) e
    join recipe_item ri2 on ri2.id = e.raw_item_id
    where ri2.type not in ('tool', 'packaging')
  ),
  blocking as (
    select
      ri3.id as ingredient_id,
      ri3.name as ingredient_name,
      (select count(*) from recipe_item_allergen ria where ria.recipe_item_id = ri3.id)::int as declared_n
    from recipe_item ri3
    where ri3.account_id = p_account_id
      and (
        (select count(*) from recipe_item_allergen ria where ria.recipe_item_id = ri3.id) < 14
        or exists (
          select 1 from recipe_item_allergen ria2
          where ria2.recipe_item_id = ri3.id and ria2.state = 'unknown'
        )
      )
  )
  select
    b.ingredient_id,
    b.ingredient_name,
    count(distinct dr.dish_id)::int as dish_count,
    b.declared_n as declared_count
  from blocking b
  join dish_raws dr on dr.raw_item_id = b.ingredient_id
  group by b.ingredient_id, b.ingredient_name, b.declared_n
  order by count(distinct dr.dish_id) desc, b.ingredient_name;
end;
$function$;

notify pgrst, 'reload schema';

-- Guard: aborta si la columna nueva no quedó en la firma de retorno.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allergen_blocking_ingredients'
      and pg_get_function_result(p.oid) like '%declared_count integer%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: allergen_blocking_ingredients no devuelve declared_count';
  end if;
end $$;
