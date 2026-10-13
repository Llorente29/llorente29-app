-- ============================================================================
-- C04b · Respuesta 5 · Un resumen por UNIDAD, no por día (va con la 0100)
-- ----------------------------------------------------------------------------
-- ux_sales_day_summary dejaba un solo resumen por empresa, local y día. Con la
-- regla por plataforma hay uno por unidad (Uber; Just Eat; Glovo · marca):
--   · los del día entero (unit_key nulo, la regla de antes) siguen siendo
--     únicos por empresa, local y día;
--   · los de una unidad, por empresa, local, día y unidad.
-- Ninguna fila de hoy cambia: todas tienen unit_key nulo (columna de la 0100)
-- y siguen cumpliendo el índice nuevo.
--
-- Las dos se crean ANTES de quitar la vieja, dentro de la misma transacción:
-- no hay un instante sin unicidad. Tabla pequeña (144 filas el 13/10) y fuera
-- del camino del pedido: el cierre exclusivo dura milisegundos.
-- Quita un índice: pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261020T0110_ventas_por_plataforma_indice.down.sql
-- (vuelve a crear la de antes; PARA si ya hay dos unidades el mismo día).
-- ============================================================================

create unique index if not exists ux_sales_day_summary_dia on public.sales_day_summary (company_id, location_id, sales_day) where unit_key is null;
create unique index if not exists ux_sales_day_summary_unidad on public.sales_day_summary (company_id, location_id, sales_day, unit_key) where unit_key is not null;
drop index if exists public.ux_sales_day_summary;
