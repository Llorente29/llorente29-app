-- scripts/demo/catalogos-globales-volcar.sql
--
-- DM1 · 2b-2 (02/11) · SOLO LEE. Devuelve, como texto, la semilla de los
-- catálogos GLOBALES de Folvy (los que no son de ninguna cuenta) tal y como
-- están en producción, con sus mismos id. La corre volcar-catalogos-globales.yml
-- con conta_lectura y la guarda en supabase/seeds/folvy/.
--
-- Por qué: en local y en staging esas tablas están vacías. Sin ellas, el alta
-- de una cuenta (onboard_account) no siembra nada, los lotes de Casa Lola no
-- pueden correr en local y la foto de la demo no cargaría en staging, porque
-- apunta a ellas (unidades, familias plantilla, planes, cursos…).
--
-- Solo catálogos: kitchen_unit, course y training_path tienen account_id, y de
-- ellas van SOLO las filas sin cuenta. course se lee por la vista
-- public.catalogo_curso_global (la 1218): conta_lectura no lee la tabla, que
-- tiene cursos de cuentas. Si una de esas filas apunta a algo de una
-- cuenta (un curso adoptado o hecho de una receta, un paso de un itinerario de
-- una cuenta), PARA: no sería un catálogo.
--
-- Cada tabla va en un INSERT … ON CONFLICT DO NOTHING (se puede pasar dos
-- veces), en orden de sus claves ajenas, con su número de filas y la huella
-- (md5 del JSON) en el comentario, para comprobarla en el destino.

do $guarda$
begin
  if exists (select 1 from public.catalogo_curso_global
              where adopted_from_course_id is not null or source_recipe_item_id is not null) then
    raise exception 'Un curso global apunta a algo de una cuenta: no es un catálogo. No se vuelca nada.';
  end if;
  if exists (select 1 from public.training_path_item i
               join public.training_path p on p.id = i.path_id
              where p.account_id is null
                and not exists (select 1 from public.catalogo_curso_global c where c.id = i.course_id)) then
    raise exception 'Un itinerario global usa un curso que no es global: no es un catálogo. No se vuelca nada.';
  end if;
end $guarda$;

with recursive fam(code, nivel) as (
  select code, 0 from public.ingredient_family_template where parent_code is null
  union all
  select f.code, fam.nivel + 1 from public.ingredient_family_template f join fam on f.parent_code = fam.code
),
tablas(orden, t, j) as (
  select 1, 'kitchen_unit', (select jsonb_agg(to_jsonb(x) order by x.id) from public.kitchen_unit x where x.account_id is null) union all
  select 2, 'allergen', (select jsonb_agg(to_jsonb(x) order by x.code) from public.allergen x) union all
  select 3, 'modules', (select jsonb_agg(to_jsonb(x) order by x.id) from public.modules x) union all
  select 4, 'submodules', (select jsonb_agg(to_jsonb(x) order by x.id) from public.submodules x) union all
  select 5, 'billing_plans', (select jsonb_agg(to_jsonb(x) order by x.id) from public.billing_plans x) union all
  select 6, 'dish_family_template', (select jsonb_agg(to_jsonb(x) order by x.id) from public.dish_family_template x) union all
  select 7, 'ingredient_family_template', (select jsonb_agg(to_jsonb(x) order by fam.nivel, x.code)
                                             from public.ingredient_family_template x left join fam on fam.code = x.code) union all
  select 8, 'ingredient_template', (select jsonb_agg(to_jsonb(x) order by x.id) from public.ingredient_template x) union all
  select 9, 'ingredient_template_allergen', (select jsonb_agg(to_jsonb(x) order by x.template_id, x.allergen_code) from public.ingredient_template_allergen x) union all
  select 10, 'course', (select jsonb_agg(to_jsonb(x) order by x.id) from public.catalogo_curso_global x) union all
  select 11, 'training_path', (select jsonb_agg(to_jsonb(x) order by x.id) from public.training_path x where x.account_id is null) union all
  select 12, 'training_path_item', (select jsonb_agg(to_jsonb(i) order by i.id) from public.training_path_item i
                                      join public.training_path p on p.id = i.path_id where p.account_id is null) union all
  select 13, 'appcc_plans', (select jsonb_agg(to_jsonb(x) order by x.id) from public.appcc_plans x) union all
  select 14, 'tag_template', (select jsonb_agg(to_jsonb(x) order by x.id) from public.tag_template x) union all
  select 15, 'kitchen_cut_type_template', (select jsonb_agg(to_jsonb(x) order by x.id) from public.kitchen_cut_type_template x) union all
  select 16, 'shop_cuisine', (select jsonb_agg(to_jsonb(x) order by x.code) from public.shop_cuisine x)
)
select string_agg(
  format(E'-- %s: %s filas · huella %s\ninsert into public.%I select * from jsonb_populate_recordset(null::public.%I, $catalogo$%s$catalogo$::jsonb) on conflict do nothing;\n',
         t, coalesce(jsonb_array_length(j), 0), left(md5(coalesce(j, '[]'::jsonb)::text), 12), t, t, coalesce(j, '[]'::jsonb)::text),
  E'\n' order by orden)
from tablas;
