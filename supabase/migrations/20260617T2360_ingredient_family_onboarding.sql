-- ============================================================================
-- 20260617T2360_ingredient_family_onboarding.sql
-- Onboarding de familias de ingrediente: ninguna cuenta vuelve a nacer vacía.
--
-- Replica el patrón de las familias de PLATO (dish_family_template -> siembra por
-- cuenta), pero para INGREDIENTES, con árbol AECOC de 2 niveles (sección -> subfamilia).
--
-- Piezas:
--   1) ingredient_family_template  : plantilla GLOBAL versionable (árbol AECOC).
--   2) seed_ingredient_families_for_account(account) : siembra idempotente en
--      recipe_family (scope='ingredient'), resuelve jerarquía por parent_code.
--   3) trigger AFTER INSERT en accounts : toda cuenta nueva nace con el árbol.
--
-- ENLACE plantilla<->cuenta = por `code` (NO por template_id: su FK apunta a
--   dish_family_template). `code` es además la clave que usa ingredient_template.family_code
--   -> al sembrar con estos códigos, el master queda enganchado automáticamente.
--
-- Reglas: DDL idempotente. Sin BEGIN/COMMIT (SQL Editor). NO se invoca el seed
--   (SECURITY DEFINER) en esta misma transacción -> el backfill va en consulta aparte.
--   Tras correr: regenerar src/types/database.ts (tabla nueva).
-- ============================================================================


-- ── 1) Plantilla global del árbol de familias de ingrediente ─────────────────
CREATE TABLE IF NOT EXISTS public.ingredient_family_template (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  parent_code         text REFERENCES public.ingredient_family_template(code),
  name_es             text NOT NULL,
  name_en             text,
  icon                text,
  position            integer NOT NULL DEFAULT 0,
  accounting_category text,
  gpc_brick_code      text,   -- alineación GS1 GPC (futuro), hoy NULL
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ingredient_family_template ENABLE ROW LEVEL SECURITY;

-- Catálogo de referencia: lectura para cualquier usuario autenticado; la escritura
-- la hace el seed (SECURITY DEFINER) / service_role. Sin política de escritura para
-- usuarios normales => denegada (service_role la salta).
DROP POLICY IF EXISTS ingredient_family_template_read ON public.ingredient_family_template;
CREATE POLICY ingredient_family_template_read ON public.ingredient_family_template
  FOR SELECT USING (true);


-- ── 2) Semilla del árbol AECOC (idempotente por code) ────────────────────────
-- 2.a) Secciones raíz (16).
INSERT INTO public.ingredient_family_template (code, parent_code, name_es, name_en, position) VALUES
  ('meat',            NULL, 'Carnes y aves',                 'Meat & poultry',          1),
  ('fish_seafood',    NULL, 'Pescados y mariscos',           'Fish & seafood',          2),
  ('produce',         NULL, 'Frutas y hortalizas',           'Produce',                 3),
  ('dairy_eggs',      NULL, 'Lácteos y huevos',              'Dairy & eggs',            4),
  ('deli_cheese',     NULL, 'Charcutería y quesos',          'Deli & cheese',           5),
  ('bakery',          NULL, 'Panadería y pastelería',        'Bakery & pastry',         6),
  ('grains_legumes',  NULL, 'Cereales, pasta y legumbres',   'Grains, pasta & legumes', 7),
  ('oils_sauces',     NULL, 'Aceites, salsas y condimentos', 'Oils, sauces & condiments',8),
  ('preserves',       NULL, 'Conservas y encurtidos',        'Preserves & pickles',     9),
  ('frozen',          NULL, 'Congelados',                    'Frozen',                  10),
  ('beverages',       NULL, 'Bebidas sin alcohol',           'Soft drinks',             11),
  ('alcohol',         NULL, 'Vinos y bebidas alcohólicas',   'Wines & spirits',         12),
  ('coffee_tea',      NULL, 'Café, infusiones y solubles',   'Coffee, tea & soluble',   13),
  ('spices',          NULL, 'Especias',                      'Spices',                  14),
  ('packaging',       NULL, 'Envases y packaging',           'Packaging',               15),
  ('cleaning',        NULL, 'Droguería y limpieza',          'Cleaning & drugstore',    16)
ON CONFLICT (code) DO UPDATE
  SET name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
      parent_code = EXCLUDED.parent_code, position = EXCLUDED.position, updated_at = now();

-- 2.b) Subfamilias (67).
INSERT INTO public.ingredient_family_template (code, parent_code, name_es, name_en, position) VALUES
  -- Carnes y aves
  ('meat_beef',        'meat', 'Vacuno',                  'Beef',                 1),
  ('meat_pork',        'meat', 'Porcino',                 'Pork',                 2),
  ('meat_poultry',     'meat', 'Aves',                    'Poultry',              3),
  ('meat_lamb',        'meat', 'Ovino y caprino',         'Lamb & goat',          4),
  ('meat_processed',   'meat', 'Picados y elaborados',    'Minced & processed',   5),
  ('meat_offal',       'meat', 'Casquería',               'Offal',                6),
  -- Pescados y mariscos
  ('fish_white',       'fish_seafood', 'Pescado blanco',       'White fish',           1),
  ('fish_blue',        'fish_seafood', 'Pescado azul',         'Oily fish',            2),
  ('seafood_shellfish','fish_seafood', 'Mariscos y moluscos',  'Shellfish & molluscs', 3),
  ('fish_processed',   'fish_seafood', 'Ahumados y elaborados','Smoked & processed',   4),
  -- Frutas y hortalizas
  ('produce_veg',      'produce', 'Verduras y hortalizas', 'Vegetables',          1),
  ('produce_fruit',    'produce', 'Frutas',                'Fruit',               2),
  ('produce_leafy',    'produce', 'Hojas y ensaladas',     'Leafy & salads',      3),
  ('produce_herbs',    'produce', 'Hierbas frescas',       'Fresh herbs',         4),
  ('produce_mushrooms','produce', 'Setas',                 'Mushrooms',           5),
  ('produce_tubers',   'produce', 'Patatas y tubérculos',  'Potatoes & tubers',   6),
  -- Lácteos y huevos
  ('dairy_milk',       'dairy_eggs', 'Leche y nata',              'Milk & cream',         1),
  ('dairy_yogurt',     'dairy_eggs', 'Yogures y postres lácteos', 'Yogurt & dairy desserts',2),
  ('dairy_butter',     'dairy_eggs', 'Mantequilla y margarina',   'Butter & margarine',   3),
  ('dairy_eggs_eggs',  'dairy_eggs', 'Huevos',                    'Eggs',                 4),
  -- Charcutería y quesos
  ('deli_cured',       'deli_cheese', 'Embutidos y curados',  'Cured meats',         1),
  ('deli_cooked',      'deli_cheese', 'Fiambres y cocidos',   'Cooked meats',        2),
  ('cheese',           'deli_cheese', 'Quesos',               'Cheese',              3),
  ('deli_pate',        'deli_cheese', 'Patés y foie',         'Pâté & foie',         4),
  -- Panadería y pastelería
  ('bakery_bread',     'bakery', 'Pan',                    'Bread',               1),
  ('bakery_pastry',    'bakery', 'Bollería y repostería',  'Pastry & bakery',     2),
  ('bakery_flour',     'bakery', 'Harinas y masas',        'Flour & dough',       3),
  ('bakery_baking',    'bakery', 'Ingredientes de horno',  'Baking ingredients',  4),
  -- Cereales, pasta y legumbres
  ('grains_rice',       'grains_legumes', 'Arroz',             'Rice',             1),
  ('grains_pasta',      'grains_legumes', 'Pasta',             'Pasta',            2),
  ('grains_legumes_dry','grains_legumes', 'Legumbres',         'Legumes',          3),
  ('grains_cereals',    'grains_legumes', 'Cereales y granos', 'Cereals & grains', 4),
  -- Aceites, salsas y condimentos
  ('oils_oil',         'oils_sauces', 'Aceites',                'Oils',            1),
  ('oils_vinegar',     'oils_sauces', 'Vinagres',               'Vinegars',        2),
  ('sauces',           'oils_sauces', 'Salsas',                 'Sauces',          3),
  ('condiments',       'oils_sauces', 'Condimentos y aderezos', 'Condiments',      4),
  -- Conservas y encurtidos
  ('preserves_veg',    'preserves', 'Conservas vegetales',         'Canned vegetables', 1),
  ('preserves_fish',   'preserves', 'Conservas de pescado',        'Canned fish',       2),
  ('preserves_pickles','preserves', 'Encurtidos',                  'Pickles',           3),
  ('preserves_legumes','preserves', 'Legumbre cocida en conserva', 'Canned legumes',    4),
  -- Congelados
  ('frozen_veg',       'frozen', 'Verdura congelada',        'Frozen vegetables',     1),
  ('frozen_fish',      'frozen', 'Pescado/marisco congelado','Frozen fish & seafood', 2),
  ('frozen_meat',      'frozen', 'Carne congelada',          'Frozen meat',           3),
  ('frozen_prepared',  'frozen', 'Precocinados y masas',     'Prepared & frozen dough',4),
  ('frozen_dessert',   'frozen', 'Helados y postres',        'Ice cream & desserts',  5),
  -- Bebidas sin alcohol
  ('bev_water',        'beverages', 'Aguas',                  'Water',            1),
  ('bev_soft',         'beverages', 'Refrescos',              'Soft drinks',      2),
  ('bev_juice',        'beverages', 'Zumos y néctares',       'Juices & nectars', 3),
  ('bev_other',        'beverages', 'Isotónicas y energéticas','Sports & energy', 4),
  -- Vinos y bebidas alcohólicas
  ('alcohol_wine',     'alcohol', 'Vinos',                  'Wine',              1),
  ('alcohol_sparkling','alcohol', 'Espumosos y cava',       'Sparkling & cava',  2),
  ('alcohol_beer',     'alcohol', 'Cervezas',               'Beer',              3),
  ('alcohol_spirits',  'alcohol', 'Destilados y licores',   'Spirits & liqueurs',4),
  -- Café, infusiones y solubles
  ('coffee',           'coffee_tea', 'Café',                 'Coffee',            1),
  ('tea_infusions',    'coffee_tea', 'Tés e infusiones',     'Tea & infusions',   2),
  ('coffee_soluble',   'coffee_tea', 'Solubles y cacao',     'Soluble & cocoa',   3),
  -- Especias
  ('spices_spice',     'spices', 'Especias',                'Spices',             1),
  ('spices_herbs_dry', 'spices', 'Hierbas secas',           'Dried herbs',        2),
  ('spices_blends',    'spices', 'Mezclas y sazonadores',   'Blends & seasonings',3),
  -- Envases y packaging
  ('packaging_takeaway',   'packaging', 'Envases para llevar',  'Takeaway containers',  1),
  ('packaging_bags',       'packaging', 'Bolsas y papel',       'Bags & paper',         2),
  ('packaging_disposables','packaging', 'Menaje desechable',    'Disposable tableware', 3),
  ('packaging_film',       'packaging', 'Film y aluminio',      'Film & foil',          4),
  -- Droguería y limpieza
  ('cleaning_kitchen', 'cleaning', 'Limpieza de cocina', 'Kitchen cleaning', 1),
  ('cleaning_dishwash','cleaning', 'Lavavajillas',       'Dishwashing',      2),
  ('cleaning_hand',    'cleaning', 'Higiene de manos',   'Hand hygiene',     3),
  ('cleaning_paper',   'cleaning', 'Papel y celulosa',   'Paper & tissue',   4)
ON CONFLICT (code) DO UPDATE
  SET name_es = EXCLUDED.name_es, name_en = EXCLUDED.name_en,
      parent_code = EXCLUDED.parent_code, position = EXCLUDED.position, updated_at = now();


-- ── 3) Seed idempotente por cuenta ───────────────────────────────────────────
-- Crea en recipe_family (scope='ingredient') las familias que falten para la
-- cuenta, resolviendo parent_family_id por parent_code. Si ya existe una familia
-- con ese code (p.ej. las 16 planas de Folvy Interno), la NORMALIZA: nombre,
-- posición y jerarquía. No duplica. No borra nada (familias extra heredadas, como
-- "Pollo", se conservan; su limpieza/fusión es operación aparte y guardada).
CREATE OR REPLACE FUNCTION public.seed_ingredient_families_for_account(p_account_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tpl    record;
  v_id     uuid;
  v_parent uuid;
  v_count  integer := 0;
BEGIN
  -- Paso 1: secciones raíz.
  FOR v_tpl IN
    SELECT * FROM ingredient_family_template WHERE parent_code IS NULL ORDER BY position
  LOOP
    SELECT id INTO v_id FROM recipe_family
    WHERE account_id = p_account_id AND scope = 'ingredient' AND code = v_tpl.code
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO recipe_family
        (account_id, scope, code, name, icon, position, accounting_category, parent_family_id, is_active)
      VALUES
        (p_account_id, 'ingredient', v_tpl.code, v_tpl.name_es, v_tpl.icon, v_tpl.position,
         v_tpl.accounting_category, NULL, true);
      v_count := v_count + 1;
    ELSE
      UPDATE recipe_family
        SET name = v_tpl.name_es,
            position = v_tpl.position,
            parent_family_id = NULL,                                   -- raíz
            accounting_category = COALESCE(accounting_category, v_tpl.accounting_category)
      WHERE id = v_id;
    END IF;
  END LOOP;

  -- Paso 2: subfamilias (el padre ya existe por el paso 1).
  FOR v_tpl IN
    SELECT * FROM ingredient_family_template WHERE parent_code IS NOT NULL ORDER BY parent_code, position
  LOOP
    SELECT id INTO v_parent FROM recipe_family
    WHERE account_id = p_account_id AND scope = 'ingredient' AND code = v_tpl.parent_code
    LIMIT 1;
    IF v_parent IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_id FROM recipe_family
    WHERE account_id = p_account_id AND scope = 'ingredient' AND code = v_tpl.code
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO recipe_family
        (account_id, scope, code, name, icon, position, accounting_category, parent_family_id, is_active)
      VALUES
        (p_account_id, 'ingredient', v_tpl.code, v_tpl.name_es, v_tpl.icon, v_tpl.position,
         v_tpl.accounting_category, v_parent, true);
      v_count := v_count + 1;
    ELSE
      UPDATE recipe_family
        SET name = v_tpl.name_es,
            position = v_tpl.position,
            parent_family_id = v_parent
      WHERE id = v_id;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;


-- ── 4) Trigger al alta de cuenta (como APPCC) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_seed_ingredient_families_on_account_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.seed_ingredient_families_for_account(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_ingredient_families_after_insert_accounts ON public.accounts;
CREATE TRIGGER seed_ingredient_families_after_insert_accounts
  AFTER INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_ingredient_families_on_account_insert();
