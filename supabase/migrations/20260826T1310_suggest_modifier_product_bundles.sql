-- 20260826T1310_suggest_modifier_product_bundles.sql
-- APLICADA en produccion el 26-08-2026.
--
-- Sugiere, para la solapa "Modificadores", que opciones son en realidad un
-- PRODUCTO ENTERO y no un ajuste de receta.
--
-- Criterio, el mismo que ya usa el automap de ventas y el unico que no inventa:
-- nombre normalizado que casa con UN solo menu_item vivo de la MISMA marca, y
-- ese menu_item tiene escandallo. Si hay ambiguedad, no se sugiere nada.
--
-- La marca de la opcion se deduce por su cadena real:
--   modifier_option -> modifier_group -> modifier_group_assignment -> menu_item -> brand
--
-- No decide: propone. El humano confirma en la solapa y solo entonces el motor
-- lo usa (status='confirmed'). Y como se calcula en vivo, una opcion nueva que
-- se llame igual que un producto aparece sugerida sola, sin que nadie mantenga
-- una lista: hoy da 18 sugerencias, dos mas que las 16 que ya se aplicaron
-- (Bocadillo Cesar, Patatas Harisa, Scandal Burger Trufada de Pollo... opciones
-- que aun no habian vendido).
CREATE OR REPLACE FUNCTION public.suggest_modifier_product_bundles(p_account_id uuid)
 RETURNS TABLE(modifier_option_id uuid, option_name text, brand_name text,
               target_recipe_item_id uuid, target_menu_item_id uuid, target_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'suggest_modifier_product_bundles: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with opcion_marca as (
    -- Una opcion puede colgar de varias marcas; se propone por cada una y luego
    -- se exige unicidad global de la opcion.
    select distinct mo.id as opt_id, mo.name as opt_name,
           public.sales_product_norm(mo.name) as norm,
           mi.brand_id
    from modifier_option mo
    join modifier_group mg on mg.id = mo.modifier_group_id
    join modifier_group_assignment mga on mga.modifier_group_id = mg.id
    join menu_item mi on mi.id = mga.menu_item_id and mi.archived_at is null
    where mo.account_id = p_account_id
      and mo.is_active is not false
      and coalesce(btrim(mo.name),'') <> ''
      -- solo las que aun no tienen impacto definido
      and not exists (select 1 from modifier_recipe_impact mri
                       where mri.modifier_option_id = mo.id)
  ),
  candidatos as (
    select om.opt_id, om.opt_name, b.name as marca,
           mi.recipe_item_id, mi.id as menu_item_id, mi.name as destino,
           count(*) over (partition by om.opt_id) as n_global
    from opcion_marca om
    join menu_item mi on mi.account_id = p_account_id
      and mi.archived_at is null
      and mi.brand_id = om.brand_id
      and mi.recipe_item_id is not null
      and public.sales_product_norm(mi.name) = om.norm
    left join brand b on b.id = om.brand_id
  )
  select c.opt_id, c.opt_name, c.marca, c.recipe_item_id, c.menu_item_id, c.destino
    from candidatos c
   where c.n_global = 1
   order by c.opt_name;
end;
$function$;

REVOKE ALL ON FUNCTION public.suggest_modifier_product_bundles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_modifier_product_bundles(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
