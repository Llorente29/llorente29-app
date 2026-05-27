-- ============================================================================
-- 20260527_folvy_kitchen_capa2_menu_item.sql
-- Folvy Kitchen — Capa 2: ítem de carta por marca (menu_item)
-- El PVP vive AQUÍ (nunca en recipe_item). Cuelga de brand y recipe_item.
-- Diferenciador: misma receta a N precios en N marcas virtuales.
-- ============================================================================

BEGIN;

CREATE TABLE public.menu_item (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL,
  brand_id           uuid NOT NULL,
  recipe_item_id     uuid NOT NULL,

  name               text NOT NULL,
  description        text,
  category           text,
  photo_url          text,
  position           integer NOT NULL DEFAULT 0,

  price              numeric NOT NULL,              -- PVP SIN IVA (base imponible)
  vat_rate           numeric NOT NULL DEFAULT 10,   -- tipo IVA % por ítem

  is_active          boolean NOT NULL DEFAULT true,
  is_available       boolean NOT NULL DEFAULT true,
  archived_at        timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  created_by_name    text,

  source             text NOT NULL DEFAULT 'manual',
  ai_confidence      numeric,
  needs_review       boolean NOT NULL DEFAULT false,
  ai_suggested_price numeric,

  CONSTRAINT menu_item_brand_fk
    FOREIGN KEY (brand_id) REFERENCES public.brand (id) ON DELETE RESTRICT,
  CONSTRAINT menu_item_recipe_item_fk
    FOREIGN KEY (recipe_item_id) REFERENCES public.recipe_item (id) ON DELETE RESTRICT,
  CONSTRAINT menu_item_brand_recipe_unique UNIQUE (brand_id, recipe_item_id),
  CONSTRAINT menu_item_price_positive    CHECK (price >= 0),
  CONSTRAINT menu_item_vat_rate_range    CHECK (vat_rate >= 0 AND vat_rate <= 100),
  CONSTRAINT menu_item_ai_suggested_positive
    CHECK (ai_suggested_price IS NULL OR ai_suggested_price >= 0),
  CONSTRAINT menu_item_source_valid
    CHECK (source IN ('manual', 'ai_suggested', 'import'))
);

CREATE INDEX idx_menu_item_account     ON public.menu_item (account_id);
CREATE INDEX idx_menu_item_brand       ON public.menu_item (brand_id);
CREATE INDEX idx_menu_item_recipe_item ON public.menu_item (recipe_item_id);
CREATE INDEX idx_menu_item_active      ON public.menu_item (account_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER set_menu_item_updated_at
  BEFORE UPDATE ON public.menu_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.menu_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_item_read ON public.menu_item
  FOR SELECT TO authenticated
  USING (account_id = ANY (current_user_account_ids()));

CREATE POLICY menu_item_write ON public.menu_item
  FOR ALL TO authenticated
  USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

COMMIT;
