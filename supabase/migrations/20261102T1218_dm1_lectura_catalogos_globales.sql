-- ============================================================================
-- DM1 · 2b-2 · LECTURA de los catálogos globales para conta_lectura (02/11)
-- ----------------------------------------------------------------------------
-- El volcado de los catálogos globales (volcar-catalogos-globales.yml, #443)
-- falló: conta_lectura no tiene SELECT en ninguna de las 16 tablas que lee
-- (medido en producción con has_table_privilege: las 16, false). Decisión de
-- Julio (02/11): SELECT solo en las que son catálogo, sin datos de ninguna
-- cuenta.
--
-- Medido en producción el 02/11 a las 11:14 UTC:
--   · 13 no tienen account_id: allergen, appcc_plans, billing_plans,
--     dish_family_template, ingredient_family_template (su «accounting_category»
--     es la categoría contable, no una cuenta), ingredient_template,
--     ingredient_template_allergen, kitchen_cut_type_template, modules,
--     shop_cuisine, submodules, tag_template y training_path_item.
--   · kitchen_unit (7 filas) y training_path (3) tienen account_id, pero
--     ninguna fila con valor: entran. Se vuelve a mirar al aplicar, tabla a
--     tabla: si una tiene alguna fila de cuenta, no entra y se dice (en staging,
--     kitchen_unit tiene unidades de las cuentas de prueba).
--   · course tiene 23 de 42 filas de cuentas: la TABLA NO ENTRA. Lo que lee
--     conta_lectura es la vista public.catalogo_curso_global, solo con las filas
--     sin cuenta. Hace falta porque training_path_item apunta a course y las
--     cuentas (Casa Lola) usan los cursos globales.
--
-- Como la 0185 del C02: en staging no existe el rol conta_lectura, y entonces
-- se dice y no se da ningún permiso (la vista se crea igual, sin permisos más
-- que para su dueño). Solo SELECT, nada de escritura. Fuera del camino del
-- pedido: un GRANT y una vista nueva no toman cierre sobre tablas del pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261102T1218_dm1_lectura_catalogos_globales.down.sql
-- ============================================================================


-- Los cursos globales, y nada más de course. La vista corre con los permisos de
-- su dueño: quien la lee no necesita permiso sobre course, y solo ve las filas
-- sin cuenta.
create or replace view public.catalogo_curso_global as
  select * from public.course where account_id is null;
comment on view public.catalogo_curso_global is
  'DM1 2b-2 (02/11/2026). Los cursos globales (sin cuenta) de course, para leerlos sin permiso sobre course (que tiene cursos de cuentas). La lee conta_lectura para volcar los catálogos globales.';
revoke all on public.catalogo_curso_global from public, anon, authenticated;

do $$
declare t text; v_con_cuenta boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'DM1 1218: no existe el rol conta_lectura (normal en staging): no se da ningún permiso.';
    return;
  end if;
  foreach t in array array['allergen', 'appcc_plans', 'billing_plans', 'dish_family_template',
                           'ingredient_family_template', 'ingredient_template', 'ingredient_template_allergen',
                           'kitchen_cut_type_template', 'kitchen_unit', 'modules', 'shop_cuisine', 'submodules',
                           'tag_template', 'training_path', 'training_path_item', 'catalogo_curso_global'] loop
    -- Regla de Julio (02/11): una tabla con alguna fila de una cuenta no entra.
    -- Solo kitchen_unit y training_path tienen account_id; en producción, sin
    -- ninguna fila de cuenta (medido). Si un día la tienen, se dice y no entra.
    if exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'account_id' and not attisdropped) then
      execute format('select exists (select 1 from public.%I where account_id is not null)', t) into v_con_cuenta;
      if v_con_cuenta then
        raise notice 'DM1 1218: % tiene filas de alguna cuenta: no entra, conta_lectura no la lee.', t;
        continue;
      end if;
    end if;
    execute format('grant select on table public.%I to conta_lectura', t);
  end loop;
  raise notice 'DM1 1218: conta_lectura puede leer los catálogos globales sin filas de cuentas y la vista de cursos globales.';
end $$;
