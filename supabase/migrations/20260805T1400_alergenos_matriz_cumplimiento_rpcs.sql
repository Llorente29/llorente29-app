-- Alérgenos Capa 2 — RPCs de lectura para la matriz de cumplimiento (Fase 3).
--
-- Consumidas por la pantalla nueva src/modules/appcc/pages/AllergensCompliancePage.tsx
-- (Fase 4). Las 4 son de solo lectura, mismo guard que menu_item_link_health
-- (admin() OR admin_or_manager_of(cuenta)) — no llevan el revoke de PUBLIC
-- que sí llevan compute_recipe_item_allergens/_recompute_recipe_item_allergens
-- (Fase 1): estas SÍ son la puerta de entrada de cliente, con guard propio.
--
-- Aplicar por SQL Editor a mano. Verificar cada función con una query aparte
-- (no fiarse del "Success").

-- ─────────────────────────────────────────────────────────────────────
-- 1) allergen_compliance_matrix — una fila por plato A LA VENTA (deduplicado
-- por recipe_item_id, decisión de Julio), con las marcas donde vive y el
-- mapa de sus 14 alérgenos. "A la venta" = mismo criterio ya aprobado en
-- menu_item_link_health (mi.archived_at is null, no combo, ri.type in
-- ('dish','raw')) — no se reinventa la definición.
-- allergens es un jsonb {codigo: {state, source}}; un código AUSENTE del
-- mapa es "sin declarar" (el UI-only 5º estado) — el cliente no debe
-- inferir 'free' de una ausencia.
-- ─────────────────────────────────────────────────────────────────────
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
    where ria.recipe_item_id in (select recipe_item_id from sellable)
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

-- ─────────────────────────────────────────────────────────────────────
-- 2) allergen_blocking_ingredients — ingredientes con dato incompleto
-- (menos de 14 filas) o algún 'unknown' explícito, contando en cuántos
-- platos A LA VENTA influyen (vía explode_recipe_to_raws de cada plato,
-- mismo filtro tool/packaging que el motor de herencia), ordenado por
-- impacto descendente.
-- ─────────────────────────────────────────────────────────────────────
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
  order by dish_count desc, b.ingredient_name;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) allergen_data_health — conteo por source, separado por scope
-- ('ingrediente' = raw, 'plato' = dish/recipe) para no mezclar los ~800
-- de ingrediente con los ~7.500 heredados de plato. ai_enrich sin
-- confirmar NO tiene el mismo valor legal que manual/ficha técnica — el
-- cliente lo remarca, esta función solo cuenta.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.allergen_data_health(
  p_account_id uuid
) returns table(
  scope text,
  source text,
  row_count integer
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'allergen_data_health: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  select
    case when ri.type = 'raw' then 'ingrediente' else 'plato' end as scope,
    ria.source,
    count(*)::int as row_count
  from recipe_item_allergen ria
  join recipe_item ri on ri.id = ria.recipe_item_id
  where ri.account_id = p_account_id
    and ri.type in ('raw', 'dish', 'recipe')
  group by 1, 2
  order by 1, 2;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) allergen_discrepancies — cruza declaraciones source='manual' de
-- platos/recetas contra lo que compute_recipe_item_allergens calcularía
-- (reutilizada, no se reimplementa la tabla de precedencia) donde el
-- resultado difiere. Discrepancia real: alguien declaró a mano algo que
-- ya no coincide con lo que dicen hoy los ingredientes.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.allergen_discrepancies(
  p_account_id uuid
) returns table(
  recipe_item_id uuid,
  recipe_name text,
  allergen_code text,
  declared_state text,
  would_inherit text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'allergen_discrepancies: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  select
    ri.id,
    ri.name,
    ria.allergen_code,
    ria.state,
    c.computed_state
  from recipe_item ri
  join recipe_item_allergen ria
    on ria.recipe_item_id = ri.id and ria.source = 'manual'
  cross join lateral public.compute_recipe_item_allergens(ri.id) c
  where ri.account_id = p_account_id
    and ri.type in ('dish', 'recipe')
    and c.allergen_code = ria.allergen_code
    and c.computed_state <> ria.state
  order by ri.name, ria.allergen_code;
end;
$function$;

notify pgrst, 'reload schema';

-- Guard: aborta si alguna de las 4 no quedó creada.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'allergen_compliance_matrix') then
    raise exception 'MIGRACIÓN FALLIDA: falta allergen_compliance_matrix';
  end if;
  if not exists (select 1 from pg_proc where proname = 'allergen_blocking_ingredients') then
    raise exception 'MIGRACIÓN FALLIDA: falta allergen_blocking_ingredients';
  end if;
  if not exists (select 1 from pg_proc where proname = 'allergen_data_health') then
    raise exception 'MIGRACIÓN FALLIDA: falta allergen_data_health';
  end if;
  if not exists (select 1 from pg_proc where proname = 'allergen_discrepancies') then
    raise exception 'MIGRACIÓN FALLIDA: falta allergen_discrepancies';
  end if;
end $$;
