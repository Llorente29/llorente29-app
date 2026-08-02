-- menu_item_link_health contaba TODO combo como 'roto_sin_escandallo': un
-- combo nunca lleva recipe_item_id propio (su coste sale de combo_slot/
-- componentes — mismo criterio que ya usa KitchenMenuPage.tsx, que pinta
-- "coste por componentes" en vez del sello). Sin este filtro, el banner-resumen
-- y la pantalla de barrido se llenan de "problemas" que no son problemas.
-- No se edita 20260802T1030_menu_item_link_rpcs.sql (ya aplicada) — CREATE OR
-- REPLACE en migración nueva, tal como manda la regla del proyecto.
--
-- coalesce(mi.product_type, 'item') en vez de mi.product_type a secas: si
-- algún registro tuviera product_type NULL, coalesce lo trata como 'item' →
-- SE AUDITA (lado seguro), no se excluye en silencio. Solo se excluye lo
-- explícitamente 'combo'. Mismo patrón que ya usa el proyecto en otros sitios
-- (coalesce(sl.line_type,'product'), coalesce(mi.is_available,...)).
--
-- Aplicar por SQL Editor a mano. Verificar con:
--   select count(*) from menu_item_link_health(p_account_id) — antes/después
--   del filtro, el nº de filas con status='roto_sin_escandallo' debe bajar
--   exactamente en el nº de combos activos de la cuenta.

create or replace function public.menu_item_link_health(
  p_account_id uuid, p_brand_id uuid default null
) returns table(
  menu_item_id uuid, item_name text, brand_id uuid, brand_name text,
  recipe_item_id uuid, recipe_name text, cost numeric,
  needs_review boolean, link_approved_at timestamptz,
  status text, shared_with integer
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'menu_item_link_health: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with share_counts as (
    select m2.recipe_item_id, count(*)::int as n
    from menu_item m2
    where m2.account_id = p_account_id
      and m2.archived_at is null
      and m2.recipe_item_id is not null
    group by m2.recipe_item_id
  )
  select
    mi.id, mi.name, mi.brand_id, b.name,
    ri.id, ri.name,
    round(coalesce(ri.computed_cost, ri.fixed_cost), 4),
    coalesce(ri.needs_review, false),
    mi.link_approved_at,
    case
      when mi.recipe_item_id is null                                   then 'roto_sin_escandallo'
      when ri.id is null                                               then 'roto_enlace'
      when coalesce(ri.computed_cost, ri.fixed_cost) is null           then 'roto_coste_null'
      when coalesce(ri.needs_review, false)                            then 'roto_needs_review'
      when coalesce(ri.computed_cost, ri.fixed_cost) < 0.50            then 'roto_coste_imposible'
      when mi.link_approved_at is null                                 then 'sin_aprobar'
      else 'aprobado'
    end as status,
    coalesce(sc.n, 0) as shared_with
  from menu_item mi
  left join recipe_item ri on ri.id = mi.recipe_item_id
  left join brand b on b.id = mi.brand_id
  left join share_counts sc on sc.recipe_item_id = mi.recipe_item_id
  where mi.account_id = p_account_id
    and mi.archived_at is null
    and coalesce(mi.product_type, 'item') <> 'combo'
    and (p_brand_id is null or mi.brand_id = p_brand_id)
  order by
    case
      when mi.recipe_item_id is null then 0
      when coalesce(ri.computed_cost, ri.fixed_cost) is null then 1
      when coalesce(ri.needs_review, false) then 2
      when coalesce(ri.computed_cost, ri.fixed_cost) < 0.50 then 3
      when mi.link_approved_at is null then 4
      else 5
    end,
    b.name, mi.name;
end;
$function$;

notify pgrst, 'reload schema';
