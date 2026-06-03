-- supabase/migrations/20260603T1800_recipe_family_scope.sql
--
-- Paso 3a del frente coste: familias de INGREDIENTE (taxonomía AECOC CEP).
--
-- Contexto (recon 03/06): dish_family tiene 55 familias de PLATO (de plantilla),
-- 0 items clasificados, y su ÚNICA dependencia es el FK recipe_item.family_id.
-- Raws y dishes son ambos recipe_item → una sola tabla de familias sirve a los
-- dos si distinguimos el ÁMBITO. Renombrar la tabla a un nombre neutro deja de
-- mentir (deuda 0 real, viable por la baja dependencia).
--
-- Qué hace:
--   1) RENOMBRA dish_family -> recipe_family (PK y FK se renombran solos en PG).
--   2) Añade scope ('dish'|'ingredient') con CHECK. Las 55 filas actuales = 'dish'.
--   3) Siembra 15 familias de INGREDIENTE para Llorente29, alineadas con el nivel
--      "familia" de AECOC CEP (lenguaje de proveedores/distribuidores ES → casarán
--      con códigos de proveedor en el paso 4 factura->coste y el catálogo estándar).
--
-- Un ingrediente SIN clasificar queda con family_id NULL (= "sin clasificar",
-- honesto) — no hay familia cajón "Otros".
--
-- Sin BEGIN/COMMIT (regla 03/06: el editor descarta el bloque y miente "Success").
-- Ejecutar y VERIFICAR con information_schema después. No hay SECURITY DEFINER aquí.

-- 1) Renombrar la tabla. El índice PK y el FK recipe_item_family_id_fkey siguen
--    apuntando solos (PG actualiza la referencia interna; el nombre del FK no cambia
--    pero su destino sí es la tabla renombrada).
ALTER TABLE public.dish_family RENAME TO recipe_family;

-- 2) Ámbito. Default 'dish' para no romper las 55 filas; luego lo dejamos sin default
--    para forzar decisión consciente en altas futuras (la UI siempre lo pondrá).
ALTER TABLE public.recipe_family
  ADD COLUMN scope text NOT NULL DEFAULT 'dish';

ALTER TABLE public.recipe_family
  ADD CONSTRAINT recipe_family_scope_valid
  CHECK (scope IN ('dish', 'ingredient'));

ALTER TABLE public.recipe_family
  ALTER COLUMN scope DROP DEFAULT;

COMMENT ON COLUMN public.recipe_family.scope IS 'Ámbito de la familia: dish (familia de plato) | ingredient (familia de materia prima, alineada con AECOC CEP).';

-- 3) Sembrar las 15 familias de ingrediente para Llorente29.
--    position arranca en 100 para no chocar con el orden de las de plato (1..55).
--    color/icon: tono neutro de momento; la UI de familias los podrá ajustar.
INSERT INTO public.recipe_family (account_id, name, scope, position, is_active)
SELECT '51ad1792-6629-4ef7-833a-b57b09a86710', f.name, 'ingredient', f.pos, true
FROM (VALUES
  ('Carnes y aves',                    100),
  ('Pescados y mariscos',              101),
  ('Frutas y hortalizas',              102),
  ('Lácteos y huevos',                 103),
  ('Charcutería y quesos',             104),
  ('Panadería y pastelería',           105),
  ('Cereales, pasta y legumbres',      106),
  ('Aceites, salsas y condimentos',    107),
  ('Conservas y encurtidos',           108),
  ('Congelados',                       109),
  ('Bebidas sin alcohol',              110),
  ('Vinos y bebidas alcohólicas',      111),
  ('Café, infusiones y solubles',      112),
  ('Envases y packaging',              113),
  ('Droguería y limpieza',             114)
) AS f(name, pos)
WHERE NOT EXISTS (
  SELECT 1 FROM public.recipe_family rf
  WHERE rf.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    AND rf.scope = 'ingredient'
    AND rf.name = f.name
);
