-- =====================================================================
-- Migración: Catálogo de Marca — A6-schema (preparación importador)
-- Fecha: 2026-06-05
-- Descripción: Ajustes de esquema previos al importador de catálogo Last.app.
--   1. menu_item.channel_id → nullable (el canal es variante, no base)
--   2. menu_item.recipe_item_id → nullable (los combos no tienen escandallo)
--   3. external_id + external_source en tablas de catálogo (idempotencia)
--   4. índices únicos parciales para upsert por ID externo (catalog:updated)
-- Depende de: 20260605T0100_catalog_brand_phase_a.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1+2+3 — ALTER de columnas
-- ---------------------------------------------------------------------

-- menu_item: el canal es una variante (menu_item_override), no atributo base.
-- recipe_item_id nullable: un combo es composición de platos, no un plato.
ALTER TABLE menu_item
  ALTER COLUMN channel_id DROP NOT NULL,
  ALTER COLUMN recipe_item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

ALTER TABLE modifier_group
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

ALTER TABLE modifier_option
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

ALTER TABLE combo_slot
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

ALTER TABLE combo_slot_option
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

ALTER TABLE menu_category
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text;

-- ---------------------------------------------------------------------
-- 4 — Índices únicos parciales (idempotencia por ID externo)
--   Clave: (account_id, external_source, external_id)
--   WHERE external_id IS NOT NULL → no afecta a registros manuales
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_item_external
  ON menu_item (account_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_modifier_group_external
  ON modifier_group (account_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_modifier_option_external
  ON modifier_option (account_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_slot_external
  ON combo_slot (account_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_slot_option_external
  ON combo_slot_option (account_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_category_external
  ON menu_category (account_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- =====================================================================
-- FIN A6-schema — verificar:
--   menu_item.channel_id / recipe_item_id → is_nullable = YES
--   external_id en 6 tablas
--   6 índices uq_*_external
-- =====================================================================
