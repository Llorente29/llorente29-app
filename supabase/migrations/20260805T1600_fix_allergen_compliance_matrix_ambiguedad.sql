-- Alérgenos Capa 2 — fix de "column reference recipe_item_id is ambiguous"
-- en allergen_compliance_matrix (Fase 3, 20260805T1400, ya aplicada).
--
-- Causa: RETURNS TABLE(recipe_item_id uuid, ...) declara recipe_item_id
-- como variable implícita de PL/pgSQL dentro del cuerpo de la función. La
-- línea `where ria.recipe_item_id in (select recipe_item_id from sellable)`
-- tenía el lado izquierdo cualificado (ria.) pero el subselect no —
-- `recipe_item_id` a secas ahí choca con esa variable implícita. Todo el
-- resto de la función ya iba cualificado (s.recipe_item_id, ria.recipe_item_id,
-- am.recipe_item_id); se coló justo en ese subselect. Cazado en vivo por
-- Julio al probar la Fase 4.
--
-- De paso, mismo blindaje preventivo en allergen_blocking_ingredients:
-- `order by dish_count desc` referenciaba el alias de salida a secas
-- (dish_count es también uno de sus RETURNS TABLE) — no daba error (un
-- ORDER BY sobre alias de SELECT no compite con la variable implícita de
-- la misma forma que un subselect), pero se sustituye por la expresión
-- completa para no depender de esa distinción.
--
-- Mismas firmas que antes (mismos parámetros/tipos de retorno) → CREATE OR
-- REPLACE basta, sin DROP FUNCTION previo.
--
-- Aplicar por SQL Editor a mano. Verificar con una llamada real aparte (no
-- fiarse del "Success" de un CREATE — el bug anterior NO dio error al
-- crear la función, solo al ejecutarla).

create or replace function public.allergen_compliance_matrix(
  p_account_id uuid
) returns table(
  recipe_item_id uuid,
  recipe_name text,
  recipe_type text,
  brands text[],
  allergens jsonb
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'allergen_compliance_matrix: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with sellable as (
    select
      mi.recipe_item_id,
      array_agg(distinct b.name order by b.name) filter (where b.name is not null) as brand_names
    from menu_item mi
    join recipe_item ri on ri.id = mi.recipe_item_id
    left join brand b on b.id = mi.brand_id
    where mi.account_id = p_account_id
      and mi.archived_at is null
      and coalesce(mi.product_type, 'item') <> 'combo'
      and ri.type in ('dish', 'raw')
    group by mi.recipe_item_id
  ),
  allergen_map as (
    select
      ria.recipe_item_id,
      jsonb_object_agg(
        ria.allergen_code,
        jsonb_build_object('state', ria.state, 'source', ria.source)
      ) as allergens
    from recipe_item_allergen ria
    where ria.recipe_item_id in (select s.recipe_item_id from sellable s)
    group by ria.recipe_item_id
  )
  select
    s.recipe_item_id,
    ri.name,
    ri.type,
    coalesce(s.brand_names, array[]::text[]),
    coalesce(am.allergens, '{}'::jsonb)
  from sellable s
  join recipe_item ri on ri.id = s.recipe_item_id
  left join allergen_map am on am.recipe_item_id = s.recipe_item_id
  order by ri.name;
end;
$function$;

create or replace function public.allergen_blocking_ingredients(
  p_account_id uuid
) returns table(
  ingredient_id uuid,
  ingredient_name text,
  dish_count integer
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
    select ri3.id as ingredient_id, ri3.name as ingredient_name
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
    count(distinct dr.dish_id)::int as dish_count
  from blocking b
  join dish_raws dr on dr.raw_item_id = b.ingredient_id
  group by b.ingredient_id, b.ingredient_name
  order by count(distinct dr.dish_id) desc, b.ingredient_name;
end;
$function$;

notify pgrst, 'reload schema';

-- Guard: aborta si alguna quedó con firma distinta a la esperada.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allergen_compliance_matrix'
      and pg_get_function_result(p.oid) like '%recipe_item_id uuid%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: allergen_compliance_matrix no quedó con la firma esperada';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allergen_blocking_ingredients'
      and pg_get_function_result(p.oid) like '%dish_count integer%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: allergen_blocking_ingredients no quedó con la firma esperada';
  end if;
end $$;
