-- 20260910220147_stock_value_admite_null_cierre_de_pedidos.sql
--
-- URGENTE 10/09 noche: los pedidos no se podían cerrar desde las 12:00 UTC.
-- La p8 (coste medio perpetuo) deja avg_unit_cost en NULL cuando no hay coste
-- fiable («NULL, nunca 0»), y recompute_location_stock_core escribe
-- stock_value = qty * avg = NULL. La columna era NOT NULL: el cierre de venta
-- (close_sale -> generate_sale_consumption -> recompute_location_stock_core)
-- abortaba con 23502 y el pedido se quedaba sin cerrar.
-- Coherente con la p8: valor desconocido es NULL, no 0.
ALTER TABLE public.recipe_item_location_stock ALTER COLUMN stock_value DROP NOT NULL;
ALTER TABLE public.recipe_item_location_stock ALTER COLUMN stock_value DROP DEFAULT;
COMMENT ON COLUMN public.recipe_item_location_stock.stock_value IS
  'Valor del stock = qty_on_hand * avg_unit_cost. NULL cuando no hay coste medio fiable (p8): desconocido, no cero.';
