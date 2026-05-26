-- =====================================================================
-- MIGRATION: Folvy Kitchen — Capa 1.2 (conversiones por ingrediente)
-- Tabla recipe_item_unit_conversion: varias conversiones pieza↔peso/vol
-- por ingrediente, nativo-IA. Conversiones NO universales (1 ud huevo = 60g).
-- =====================================================================

BEGIN;

CREATE TABLE public.recipe_item_unit_conversion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  from_unit_id    uuid NOT NULL REFERENCES public.kitchen_unit(id) ON DELETE RESTRICT,
  qty_in_base     numeric NOT NULL,
  source          text NOT NULL DEFAULT 'manual',
  ai_confidence   numeric,
  needs_review    boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text,
  CONSTRAINT riuc_qty_positive
    CHECK (qty_in_base > 0),
  CONSTRAINT riuc_source_valid
    CHECK (source IN ('manual', 'ai_suggested', 'import')),
  CONSTRAINT riuc_ai_confidence_range
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1))
);

CREATE UNIQUE INDEX uq_riuc_item_unit
  ON public.recipe_item_unit_conversion(item_id, from_unit_id);

CREATE INDEX idx_riuc_account ON public.recipe_item_unit_conversion(account_id);
CREATE INDEX idx_riuc_item    ON public.recipe_item_unit_conversion(item_id);
CREATE INDEX idx_riuc_needs_review
  ON public.recipe_item_unit_conversion(account_id) WHERE needs_review = true;

CREATE TRIGGER trg_riuc_updated_at
  BEFORE UPDATE ON public.recipe_item_unit_conversion
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.recipe_item_unit_conversion ENABLE ROW LEVEL SECURITY;

CREATE POLICY riuc_select ON public.recipe_item_unit_conversion
  FOR SELECT USING ( public.belongs_to_account(account_id) );
CREATE POLICY riuc_insert ON public.recipe_item_unit_conversion
  FOR INSERT WITH CHECK ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY riuc_update ON public.recipe_item_unit_conversion
  FOR UPDATE USING ( public.current_user_is_admin_or_manager_of(account_id) );
CREATE POLICY riuc_delete ON public.recipe_item_unit_conversion
  FOR DELETE USING ( public.current_user_is_admin_or_manager_of(account_id) );

COMMIT;
