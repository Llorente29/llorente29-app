-- scripts/conta/produccion/cuentas/dm1-lectura-catalogos-globales.sql
--
-- DM1 · 2b-2 (02/11) · LO QUE CUENTA LA TANDA (1218), antes y después. SOLO
-- LEE, y solo el catálogo de la base (permisos y vistas): nada crece solo.
-- Antes: conta_lectura lee 0 de las 16 y la vista no existe. Tras la tanda: 15
-- (course sigue sin leerse) y la vista, sí. Tras la vuelta atrás: como antes.
select clave, valor from (
  select 1 o, 'tablas de las 16 que conta_lectura puede leer (antes 0, después 15; course, nunca)' clave,
    (select count(*) from unnest(array['allergen','appcc_plans','billing_plans','dish_family_template','ingredient_family_template',
       'ingredient_template','ingredient_template_allergen','kitchen_cut_type_template','kitchen_unit','modules','shop_cuisine',
       'submodules','tag_template','training_path','training_path_item','course']) t
      where exists (select 1 from pg_roles where rolname = 'conta_lectura')
        and has_table_privilege('conta_lectura', ('public.' || t)::regclass, 'select'))::text valor union all
  select 2, 'conta_lectura puede leer course (siempre false)',
    (exists (select 1 from pg_roles where rolname = 'conta_lectura')
       and has_table_privilege('conta_lectura', 'public.course'::regclass, 'select'))::text union all
  select 3, 'la vista catalogo_curso_global existe (antes false, después true)',
    (to_regclass('public.catalogo_curso_global') is not null)::text
) t order by o;
