-- =====================================================================
-- MIGRATION: Folvy Kitchen — Capa 1.1 (ficha técnica completa + nativo-IA)
-- Amplía recipe_item y crea kitchen_settings (ajustes de cocina por cuenta).
-- =====================================================================

BEGIN;

ALTER TABLE public.recipe_item
  DROP CONSTRAINT recipe_item_cost_strategy_valid;
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_cost_strategy_valid
  CHECK (cost_strategy IN ('fixed', 'last_purchase', 'average_weighted', 'average_window'));

ALTER TABLE public.recipe_item
  ADD COLUMN cost_window_days integer DEFAULT 30;
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_cost_window_positive
  CHECK (cost_window_days IS NULL OR cost_window_days > 0);

ALTER TABLE public.recipe_item
  ADD COLUMN indirect_cost_pct numeric;
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_indirect_pct_range
  CHECK (indirect_cost_pct IS NULL OR (indirect_cost_pct >= 0 AND indirect_cost_pct <= 100));

ALTER TABLE public.recipe_item ADD COLUMN prep_time_minutes  integer;
ALTER TABLE public.recipe_item ADD COLUMN cook_time_minutes  integer;
ALTER TABLE public.recipe_item ADD COLUMN procedure_text     text;
ALTER TABLE public.recipe_item ADD COLUMN plating_notes      text;
ALTER TABLE public.recipe_item ADD COLUMN kitchen_photo_url  text;
ALTER TABLE public.recipe_item ADD COLUMN yield_portions     numeric;
ALTER TABLE public.recipe_item ADD COLUMN conservation_type  text;
ALTER TABLE public.recipe_item ADD COLUMN service_temp_c     numeric;

ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_prep_time_nonneg
  CHECK (prep_time_minutes IS NULL OR prep_time_minutes >= 0);
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_cook_time_nonneg
  CHECK (cook_time_minutes IS NULL OR cook_time_minutes >= 0);
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_yield_positive
  CHECK (yield_portions IS NULL OR yield_portions > 0);
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_conservation_valid
  CHECK (conservation_type IS NULL OR conservation_type IN ('fridge', 'freezer', 'dry', 'hot'));

ALTER TABLE public.recipe_item
  ADD COLUMN source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_source_valid
  CHECK (source IN ('manual', 'ai_recipe', 'ocr_invoice', 'import'));

ALTER TABLE public.recipe_item
  ADD COLUMN ai_confidence numeric;
ALTER TABLE public.recipe_item
  ADD CONSTRAINT recipe_item_ai_confidence_range
  CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1));

ALTER TABLE public.recipe_item
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX idx_recipe_item_needs_review
  ON public.recipe_item(account_id) WHERE needs_review = true;

CREATE TABLE public.kitchen_settings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  indirect_cost_pct_default numeric NOT NULL DEFAULT 0,
  target_food_cost_pct      numeric,
  currency                  text NOT NULL DEFAULT 'EUR',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid,
  created_by_name           text,
  CONSTRAINT kitchen_settings_indirect_range
    CHECK (indirect_cost_pct_default >= 0 AND indirect_cost_pct_default <= 100),
  CONSTRAINT kitchen_settings_target_range
    CHECK (target_food_cost_pct IS NULL OR (target_food_cost_pct > 0 AND target_food_cost_pct <= 100))
);

CREATE INDEX idx_kitchen_settings_account ON public.kitchen_settings(account_id);

CREATE TRIGGER trg_kitchen_settings_updated_at
  BEFORE UPDATE ON public.kitchen_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.kitchen_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY kitchen_settings_select ON public.kitchen_settings
  FOR SELECT USING ( public.belongs_to_account(account_id) );
CREATE POLICY kitchen_settings_insert ON public.kitchen_settings
  FOR INSERT WITH CHECK ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY kitchen_settings_update ON public.kitchen_settings
  FOR UPDATE USING ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY kitchen_settings_delete ON public.kitchen_settings
  FOR DELETE USING ( public.current_user_is_admin_or_manager_of(account_id) );

COMMIT;
