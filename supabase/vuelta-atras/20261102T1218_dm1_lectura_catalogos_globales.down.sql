-- supabase/vuelta-atras/20261102T1218_dm1_lectura_catalogos_globales.down.sql
-- Vuelta atrás de la 1218 (DM1 · 2b-2): conta_lectura deja de leer los 15
-- catálogos globales y la vista de cursos globales, y la vista se va. Antes de
-- la 1218 no tenía SELECT en ninguna (medido el 02/11), así que quitarlo deja
-- todo como estaba.
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'DM1 1218 vuelta atrás: no existe el rol conta_lectura: no hay permisos que quitar.';
    return;
  end if;
  foreach t in array array['allergen', 'appcc_plans', 'billing_plans', 'dish_family_template',
                           'ingredient_family_template', 'ingredient_template', 'ingredient_template_allergen',
                           'kitchen_cut_type_template', 'kitchen_unit', 'modules', 'shop_cuisine', 'submodules',
                           'tag_template', 'training_path', 'training_path_item'] loop
    execute format('revoke select on table public.%I from conta_lectura', t);
  end loop;
end $$;
drop view if exists public.catalogo_curso_global;
