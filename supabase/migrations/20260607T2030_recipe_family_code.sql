-- 20260607T2030_recipe_family_code.sql
--
-- Da a recipe_family un CÓDIGO ESTABLE (code), para que el master global de
-- ingredientes (ingredient_template.family_code) pueda casar la familia de
-- forma robusta: renombrar una familia NO rompe el enlace (el code no cambia).
-- Alinea las familias con el patrón de plantilla del proyecto (que usa code).
--
-- code es:
--   · nullable  -> aditivo, no rompe filas/lecturas existentes.
--   · slug en inglés-neutro (meat, fish_seafood...) -> mismo criterio que los
--     códigos de alérgeno; estable si Folvy sale de España.
--   · único POR cuenta+scope -> dos cuentas pueden tener cada una su 'meat',
--     pero dentro de una cuenta+scope no se duplica.
--
-- Además: corrige el dato de la familia 'Pollo' (era una RAÍZ hermana de
-- 'Carnes y aves', cuando es una variedad). Está vacía (0 ingredientes,
-- verificado), así que se DESACTIVA (is_active=false), no se borra físicamente
-- (convención del proyecto: archivar, no DELETE).
--
-- DDL + DML idempotente, SIN BEGIN/COMMIT (SQL Editor). Solo toca la cuenta
-- Folvy Interno (00000000-...-0001); otras cuentas no se ven afectadas.

-- ── 1. Columna code (aditiva, nullable) ────────────────────────────────────
alter table recipe_family
  add column if not exists code text;

-- Unicidad por cuenta+scope, solo donde hay code (índice parcial).
create unique index if not exists recipe_family_code_account_scope_uniq
  on recipe_family (account_id, scope, code)
  where code is not null;

-- ── 2. Rellenar los códigos de las 16 familias de ingrediente reales ────────
--      (match por name dentro de scope='ingredient' + cuenta Folvy Interno).
update recipe_family set code = c.code
from (values
  ('Carnes y aves',                 'meat'),
  ('Pescados y mariscos',           'fish_seafood'),
  ('Frutas y hortalizas',           'produce'),
  ('Lácteos y huevos',              'dairy_eggs'),
  ('Charcutería y quesos',          'deli_cheese'),
  ('Panadería y pastelería',        'bakery'),
  ('Cereales, pasta y legumbres',   'grains_legumes'),
  ('Aceites, salsas y condimentos', 'oils_sauces'),
  ('Conservas y encurtidos',        'preserves'),
  ('Congelados',                    'frozen'),
  ('Bebidas sin alcohol',           'beverages'),
  ('Vinos y bebidas alcohólicas',   'alcohol'),
  ('Café, infusiones y solubles',   'coffee_tea'),
  ('Envases y packaging',           'packaging'),
  ('Droguería y limpieza',          'cleaning'),
  ('Especias',                      'spices')
) as c(name, code)
where recipe_family.name = c.name
  and recipe_family.scope = 'ingredient'
  and recipe_family.account_id = '00000000-0000-0000-0000-000000000001'
  and recipe_family.code is null;  -- idempotente: no repisa si ya tiene code

-- ── 3. Corregir 'Pollo' (familia raíz huérfana, 0 ingredientes) ─────────────
--      Se desactiva. No se le pone code (no es una familia canónica).
update recipe_family
set is_active = false
where name = 'Pollo'
  and scope = 'ingredient'
  and account_id = '00000000-0000-0000-0000-000000000001';
