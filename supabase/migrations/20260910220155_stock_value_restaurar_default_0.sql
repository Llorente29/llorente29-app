-- 20260910220155_stock_value_restaurar_default_0.sql
--
-- Deshace el DROP DEFAULT de la migración anterior: sobraba. Una fila creada sin
-- valor explícito (qty 0) sigue naciendo con 0. Solo se quería quitar el NOT NULL.
ALTER TABLE public.recipe_item_location_stock ALTER COLUMN stock_value SET DEFAULT 0;
