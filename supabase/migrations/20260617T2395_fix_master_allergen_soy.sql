-- ============================================================================
-- 20260617T2395_fix_master_allergen_soy.sql
-- Sanea el master de ingredientes: el código de alérgeno 'soybeans' no existe
-- en el catálogo `allergen` (que usa 'soy', el de la UE) -> rompía la FK
-- recipe_item_allergen_allergen_code_fkey al sembrar ingredientes en el alta.
--
-- Arreglo correcto (fuente = master): normalizar 'soybeans' -> 'soy'. NO se
-- añade un código duplicado al catálogo (sería dos códigos para la misma soja).
--
-- Idempotente: si ya no hay 'soybeans', el UPDATE afecta 0 filas.
-- (Ejecutado suelto en producción el 17/06; esta migración lo versiona.)
-- ============================================================================

UPDATE public.ingredient_template_allergen
SET allergen_code = 'soy'
WHERE allergen_code = 'soybeans';
