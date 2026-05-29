-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — FIX DE RAÍZ: sale_line.unit_price era el TOTAL de línea
-- ════════════════════════════════════════════════════════════════════
-- PROBLEMA: la importación de Last.app guardó en sale_line.unit_price el
-- TOTAL de la línea (precio × cantidad), no el precio unitario. El nombre
-- mentía → cualquier cálculo quantity×unit_price inflaba las ventas.
-- Verificado: patrón sistemático en las 20.750 líneas (fuente 'lastapp').
--
-- SOLUCIÓN (B3, dos columnas explícitas, sin ambigüedad para el futuro):
--   · line_total (NUEVA) = total de la línea (lo que hoy hay en unit_price)
--   · unit_price (CORREGIDA) = precio unitario real = line_total / quantity
--
-- Seguro: verificado quantity ∈ [1,10], sin nulos ni ceros → división limpia.
-- No rompe la app: git grep confirma que NINGÚN código lee sale_line.unit_price
-- (solo las funciones SQL de esta sesión, que se corrigen aparte).
--
-- IMPORTANTE — WEBHOOK LAST (pendiente de producción): cuando se conecte,
-- debe rellenar AMBAS columnas explícitamente: line_total = total de línea,
-- unit_price = precio unitario. Queda documentado como requisito.
--
-- SQL Editor autocommit por query → BEGIN/COMMIT explícito.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Nueva columna para el total de línea
ALTER TABLE public.sale_line
  ADD COLUMN line_total numeric;

-- 2) Backfill: el valor ACTUAL de unit_price ES el total → va a line_total
UPDATE public.sale_line
SET line_total = unit_price;

-- 3) Corregir unit_price para que sea el precio UNITARIO real
--    (line_total / quantity; quantity garantizado >= 1, sin nulos)
UPDATE public.sale_line
SET unit_price = ROUND(line_total / quantity, 4)
WHERE quantity > 0;

-- 4) Comentarios para que el nombre no vuelva a engañar a nadie
COMMENT ON COLUMN public.sale_line.unit_price IS
  'Precio UNITARIO real (por unidad). Corregido 2026-05-29: antes contenía el total de línea.';
COMMENT ON COLUMN public.sale_line.line_total IS
  'Total de la línea (precio unitario × quantity). Fuente original de Last.app.';

COMMIT;
