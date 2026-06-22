-- ============================================================================
-- Folvy — Hueco 1 (packaging): retirar el CHECK duplicado recipe_item_type_valid
--
-- La capa1 (20260526_folvy_kitchen_capa1.sql) creó recipe_item_type_valid
--   CHECK (type IN ('raw','recipe','tool','dish'))
-- que NO admite 'packaging'. El tramo 1 (20260622T1127) añadió
-- recipe_item_type_check con 'packaging' incluido, pero el constraint viejo
-- seguía vivo y rechazaba los envases. Este DROP retira el duplicado y deja
-- UN solo CHECK, el bueno (con 'packaging').
--
-- Ya aplicado en BD (por eso los envases funcionan); esto solo lo VERSIONA para
-- cerrar el drift entre BBDD y repo. Idempotente.
-- ============================================================================

ALTER TABLE recipe_item DROP CONSTRAINT IF EXISTS recipe_item_type_valid;
ALTER TABLE recipe_item DROP CONSTRAINT IF EXISTS recipe_item_type_check;
ALTER TABLE recipe_item ADD CONSTRAINT recipe_item_type_check
  CHECK (type = ANY (ARRAY['raw'::text,'recipe'::text,'tool'::text,'dish'::text,'packaging'::text]));
