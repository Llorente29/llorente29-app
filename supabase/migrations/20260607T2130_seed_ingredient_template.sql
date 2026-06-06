-- 20260607T2130_seed_ingredient_template.sql
--
-- SIEMBRA Fase 1 — esqueleto curado del master de ingredientes.
-- ~55 ingredientes esenciales de la hostelería española, organizados por las
-- 16 familias (family_code: meat, produce, dairy_eggs...).
--
-- QUÉ LLEVA cada ingrediente (datos que NO requieren inventar cifras):
--   · code estable, name_es, name_en (para casar luego con USDA), aliases
--   · family_code, default_base_dimension (weight|volume|unit), conservation
--   · alérgenos CIERTOS (trigo->gluten, leche->milk...), no especulativos
--
-- QUÉ NO LLEVA (se rellena en Fase 2, con dato real, nunca tecleado):
--   · nutrition  -> pase de enriquecimiento USDA FoodData Central (dominio púb.)
--   · density_g_per_ml, default_waste_pct -> copiloto IA de ficha
--   · photo_url -> IA / banco libre
--
-- source='manual' (curado por Folvy). Idempotente: ON CONFLICT (code) DO
-- NOTHING -> re-ejecutar no duplica. Escribe en la tabla GLOBAL (sin
-- account_id): NO toca Folvy Interno ni Llorente29.
--
-- DML puro, sin BEGIN/COMMIT (SQL Editor). Se ejecuta con permisos de servicio
-- del editor (la RLS escritura-admin no estorba aquí).

-- ── 1. Ingredientes (tabla base) ────────────────────────────────────────────
insert into ingredient_template
  (code, name_es, name_en, aliases, family_code, default_base_dimension, conservation_type, source)
values
  -- Aceites, salsas y condimentos (oils_sauces)
  ('aceite_oliva_virgen_extra','Aceite de oliva virgen extra','Extra virgin olive oil','{AOVE,"aceite de oliva"}','oils_sauces','volume','dry','manual'),
  ('aceite_girasol','Aceite de girasol','Sunflower oil','{}','oils_sauces','volume','dry','manual'),
  ('vinagre_vino','Vinagre de vino','Wine vinegar','{vinagre}','oils_sauces','volume','dry','manual'),
  ('mayonesa','Mayonesa','Mayonnaise','{mahonesa}','oils_sauces','volume','fridge','manual'),
  ('salsa_soja','Salsa de soja','Soy sauce','{soja}','oils_sauces','volume','dry','manual'),
  ('ketchup','Ketchup','Ketchup','{catsup}','oils_sauces','volume','dry','manual'),
  ('mostaza','Mostaza','Mustard','{}','oils_sauces','volume','fridge','manual'),

  -- Especias (spices)
  ('sal','Sal','Salt','{"sal común","sal fina"}','spices','weight','dry','manual'),
  ('pimienta_negra','Pimienta negra','Black pepper','{pimienta}','spices','weight','dry','manual'),
  ('pimenton','Pimentón','Paprika','{"pimentón dulce"}','spices','weight','dry','manual'),
  ('oregano','Orégano','Oregano','{}','spices','weight','dry','manual'),
  ('comino','Comino','Cumin','{}','spices','weight','dry','manual'),

  -- Frutas y hortalizas (produce)
  ('cebolla','Cebolla','Onion','{}','produce','weight','dry','manual'),
  ('ajo','Ajo','Garlic','{"diente de ajo"}','produce','weight','dry','manual'),
  ('tomate','Tomate','Tomato','{}','produce','weight','fridge','manual'),
  ('patata','Patata','Potato','{papa}','produce','weight','dry','manual'),
  ('pimiento','Pimiento','Bell pepper','{}','produce','weight','fridge','manual'),
  ('zanahoria','Zanahoria','Carrot','{}','produce','weight','fridge','manual'),
  ('lechuga','Lechuga','Lettuce','{}','produce','weight','fridge','manual'),
  ('limon','Limón','Lemon','{}','produce','weight','fridge','manual'),
  ('albahaca_fresca','Albahaca fresca','Fresh basil','{albahaca,alhábega,basil}','produce','weight','fridge','manual'),

  -- Carnes y aves (meat)
  ('pollo_pechuga','Pechuga de pollo','Chicken breast','{pollo}','meat','weight','fridge','manual'),
  ('pollo_entero','Pollo entero','Whole chicken','{}','meat','weight','fridge','manual'),
  ('ternera_picada','Carne picada de ternera','Ground beef','{"carne picada"}','meat','weight','fridge','manual'),
  ('cerdo_lomo','Lomo de cerdo','Pork loin','{}','meat','weight','fridge','manual'),
  ('bacon','Bacon','Bacon','{beicon,panceta}','meat','weight','fridge','manual'),

  -- Pescados y mariscos (fish_seafood)
  ('salmon','Salmón','Salmon','{}','fish_seafood','weight','fridge','manual'),
  ('merluza','Merluza','Hake','{}','fish_seafood','weight','fridge','manual'),
  ('gamba','Gamba','Prawn','{langostino}','fish_seafood','weight','fridge','manual'),
  ('atun','Atún','Tuna','{}','fish_seafood','weight','fridge','manual'),

  -- Lácteos y huevos (dairy_eggs)
  ('leche_entera','Leche entera','Whole milk','{leche}','dairy_eggs','volume','fridge','manual'),
  ('huevo','Huevo','Egg','{huevos}','dairy_eggs','unit','fridge','manual'),
  ('mantequilla','Mantequilla','Butter','{}','dairy_eggs','weight','fridge','manual'),
  ('nata','Nata para cocinar','Cooking cream','{crema}','dairy_eggs','volume','fridge','manual'),
  ('yogur_natural','Yogur natural','Plain yogurt','{yogurt}','dairy_eggs','weight','fridge','manual'),

  -- Charcutería y quesos (deli_cheese)
  ('queso_curado','Queso curado','Cured cheese','{queso}','deli_cheese','weight','fridge','manual'),
  ('queso_mozzarella','Mozzarella','Mozzarella','{}','deli_cheese','weight','fridge','manual'),
  ('jamon_serrano','Jamón serrano','Serrano ham','{jamón}','deli_cheese','weight','fridge','manual'),
  ('chorizo','Chorizo','Chorizo','{}','deli_cheese','weight','fridge','manual'),

  -- Panadería y pastelería (bakery)
  ('pan_hamburguesa','Pan de hamburguesa','Burger bun','{bollo}','bakery','unit','dry','manual'),
  ('pan_rustico','Pan rústico','Rustic bread','{pan}','bakery','weight','dry','manual'),

  -- Cereales, pasta y legumbres (grains_legumes)
  ('arroz','Arroz','Rice','{}','grains_legumes','weight','dry','manual'),
  ('pasta_espagueti','Espagueti','Spaghetti','{pasta,espaguetis}','grains_legumes','weight','dry','manual'),
  ('harina_trigo','Harina de trigo','Wheat flour','{harina}','grains_legumes','weight','dry','manual'),
  ('garbanzo','Garbanzos','Chickpeas','{}','grains_legumes','weight','dry','manual'),
  ('lenteja','Lentejas','Lentils','{}','grains_legumes','weight','dry','manual'),

  -- Conservas y encurtidos (preserves)
  ('tomate_triturado','Tomate triturado','Crushed tomato','{"tomate frito"}','preserves','weight','dry','manual'),
  ('aceituna','Aceitunas','Olives','{olivas}','preserves','weight','dry','manual'),
  ('maiz_dulce','Maíz dulce','Sweet corn','{maíz}','preserves','weight','dry','manual'),

  -- Congelados (frozen)
  ('patata_congelada','Patatas fritas congeladas','Frozen french fries','{"patatas fritas"}','frozen','weight','freezer','manual'),
  ('guisante_congelado','Guisantes congelados','Frozen peas','{guisantes}','frozen','weight','freezer','manual'),

  -- Bebidas sin alcohol (beverages)
  ('agua','Agua','Water','{"agua mineral"}','beverages','volume','dry','manual'),
  ('refresco_cola','Refresco de cola','Cola soft drink','{cola}','beverages','volume','dry','manual'),

  -- Vinos y bebidas alcohólicas (alcohol)
  ('vino_tinto','Vino tinto','Red wine','{vino}','alcohol','volume','dry','manual'),
  ('cerveza','Cerveza','Beer','{}','alcohol','volume','dry','manual'),

  -- Café, infusiones y solubles (coffee_tea)
  ('cafe_grano','Café en grano','Coffee beans','{café}','coffee_tea','weight','dry','manual')
on conflict (code) do nothing;

-- ── 2. Alérgenos CIERTOS (satélite) ─────────────────────────────────────────
--      Solo los indiscutibles por la naturaleza del ingrediente. state='contains'.
--      Lo dudoso (trazas, "puede contener") se deja para revisión, no se asume.
insert into ingredient_template_allergen (template_id, allergen_code, state, source)
select it.id, a.allergen_code, 'contains', 'manual'
from ingredient_template it
join (values
  ('mayonesa',          'eggs'),
  ('salsa_soja',        'soybeans'),
  ('salsa_soja',        'gluten'),       -- soja fermentada con trigo (estándar)
  ('mostaza',           'mustard'),
  ('salmon',            'fish'),
  ('merluza',           'fish'),
  ('atun',              'fish'),
  ('gamba',             'crustaceans'),
  ('leche_entera',      'milk'),
  ('huevo',             'eggs'),
  ('mantequilla',       'milk'),
  ('nata',              'milk'),
  ('yogur_natural',     'milk'),
  ('queso_curado',      'milk'),
  ('queso_mozzarella',  'milk'),
  ('pan_hamburguesa',   'gluten'),
  ('pan_rustico',       'gluten'),
  ('pasta_espagueti',   'gluten'),
  ('harina_trigo',      'gluten'),
  ('vino_tinto',        'sulphites'),    -- vino comercial: declara sulfitos
  ('cerveza',           'gluten')        -- cebada/trigo
) as a(code, allergen_code) on a.code = it.code
on conflict (template_id, allergen_code) do nothing;
