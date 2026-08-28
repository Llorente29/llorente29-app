-- 20260828T1210_product_availability_fila_huerfana.sql
-- ============================================================================
-- La unica fila de product_availability sin local
-- ============================================================================
-- Es el rastro del camino que este encargo cierra: `set_product_availability`
-- acepta `p_location_id` con DEFAULT NULL, y una llamada que se olvide del
-- parametro escribe un 86 SIN LOCAL, que availability-dispatch empuja a todos
-- los catalogos de todos los locales. Con un solo local no dolia. Con Alcala y
-- Camichi abiertos, agota en los dos.
--
-- La fila esta doblemente muerta, comprobado antes de borrar:
--   · no hay menu_item con ese recipe_item_id      -> false
--   · no hay menu_item con ese external_id (null)  -> false
--   · el propio recipe_item YA NO EXISTE           -> false
--
-- Contenido literal, por si hubiera que reponerla:
--   id             4c76d2d1-54a5-441b-bde1-33caadabdcd2
--   account_id     51ad1792-6629-4ef7-833a-b57b09a86710
--   external_id    NULL
--   recipe_item_id 3184b7d2-9f73-4c14-b860-f7ab5f817fd9
--   location_id    NULL
--   is_available   false
--   reason         manual
--   set_by         673fca49-f6b5-40ed-a8f7-558390acce10
--   set_at         2026-07-03 12:55:52.685675+00
--
-- Acotado por id, no por `location_id is null`: si mañana alguien crea a
-- proposito un 86 global, este fichero no debe barrerlo de paso.
-- ============================================================================

delete from public.product_availability
where id = '4c76d2d1-54a5-441b-bde1-33caadabdcd2'
  and location_id is null
  and not exists (select 1 from public.recipe_item ri where ri.id = product_availability.recipe_item_id);
