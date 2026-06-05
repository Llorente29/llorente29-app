-- Ficha de producto v2: columnas nuevas para notas, target FC, tags, packaging
ALTER TABLE menu_item
  ADD COLUMN IF NOT EXISTS notes_internal text,
  ADD COLUMN IF NOT EXISTS target_food_cost_pct numeric,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS packaging_description text,
  ADD COLUMN IF NOT EXISTS packaging_cost numeric;

COMMENT ON COLUMN menu_item.notes_internal IS 'Notas internas del equipo (no visibles al cliente)';
COMMENT ON COLUMN menu_item.target_food_cost_pct IS 'Objetivo de food cost % para este producto (ej: 30)';
COMMENT ON COLUMN menu_item.tags IS 'Etiquetas: best-seller, nuevo, temporada, promocional, etc.';
COMMENT ON COLUMN menu_item.packaging_description IS 'Descripción del packaging delivery (envase, bolsa, etc.)';
COMMENT ON COLUMN menu_item.packaging_cost IS 'Coste total del packaging por unidad en euros';
