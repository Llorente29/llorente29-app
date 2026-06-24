-- supabase/migrations/20260624T0600_kitchen_unit_length.sql
-- Aplicada: 2026-06-24
--
-- Añade la dimensión de LONGITUD a kitchen_unit, con centímetro (base) y metro.
-- Necesaria para artículos que se miden en longitud (papel de horno, film,
-- papel de aluminio…): permite formatos amigables tipo "1 rollo de 50 m".
--
-- (1) Amplía el CHECK de dimensión para admitir 'length'.
-- (2) Siembra cm (base, factor 1) y m (factor 100), globales (account_id NULL).
-- Idempotente: el constraint se recrea; el insert no duplica.

-- (1) Constraint: añadir 'length' a las dimensiones válidas.
ALTER TABLE kitchen_unit DROP CONSTRAINT IF EXISTS kitchen_unit_dimension_valid;
ALTER TABLE kitchen_unit ADD CONSTRAINT kitchen_unit_dimension_valid
  CHECK (dimension = ANY (ARRAY['weight'::text, 'volume'::text, 'unit'::text, 'length'::text]));

-- (2) Unidades de longitud globales (centímetro base, metro = 100 cm).
INSERT INTO kitchen_unit (id, account_id, name, abbreviation, dimension, factor_to_base, is_base, is_seed, is_active)
SELECT gen_random_uuid(), NULL, 'Centímetro', 'cm', 'length', 1, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM kitchen_unit WHERE account_id IS NULL AND dimension='length' AND abbreviation='cm'
);

INSERT INTO kitchen_unit (id, account_id, name, abbreviation, dimension, factor_to_base, is_base, is_seed, is_active)
SELECT gen_random_uuid(), NULL, 'Metro', 'm', 'length', 100, false, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM kitchen_unit WHERE account_id IS NULL AND dimension='length' AND abbreviation='m'
);
