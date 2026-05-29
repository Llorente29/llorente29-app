-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — COLUMNA ECONÓMICA: estructura base (Capa 1 Compras + Capa 2 coste/local)
-- EJECUTADO EN PRODUCCIÓN el 2026-05-29 (Success, COMMIT ok, verificado: 4 tablas RLS + 4 policies c/u)
-- Crea: supplier, purchase, purchase_line, recipe_item_location_cost
-- Altera: kitchen_settings (labor_target_pct, cost_strategy_default)
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- CAPA 1.1 — PROVEEDORES
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.supplier (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL,
  name            text NOT NULL,
  tax_id          text,
  email           text,
  phone           text,
  address         text,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  created_by_name text
);

-- ─────────────────────────────────────────────────────────────────────
-- CAPA 1.2 — ALBARÁN / FACTURA  (location_id = clave del coste por local)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.purchase (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL,
  location_id      uuid NOT NULL REFERENCES public.locations(id),
  supplier_id      uuid REFERENCES public.supplier(id) ON DELETE SET NULL,
  document_number  text,
  document_date    date,
  received_at      timestamptz,
  subtotal         numeric,
  tax              numeric,
  total            numeric,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','confirmed')),
  source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('ocr_invoice','manual')),
  raw_document_url text,
  ai_confidence    numeric,
  needs_review     boolean NOT NULL DEFAULT false,
  notes            text,
  is_active        boolean NOT NULL DEFAULT true,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  created_by_name  text
);

-- ─────────────────────────────────────────────────────────────────────
-- CAPA 1.3 — LÍNEA DE COMPRA  (gemela de sale_line)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.purchase_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL,
  purchase_id      uuid NOT NULL REFERENCES public.purchase(id) ON DELETE CASCADE,
  recipe_item_id   uuid REFERENCES public.recipe_item(id) ON DELETE SET NULL,
  raw_text         text,
  product_name     text,
  quantity         numeric NOT NULL,
  purchase_unit_id uuid REFERENCES public.kitchen_unit(id) ON DELETE SET NULL,
  unit_price       numeric NOT NULL,
  line_total       numeric,
  map_source       text,
  map_confidence   numeric,
  map_needs_review boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- CAPA 2 — COSTE DEL INGREDIENTE POR LOCAL  (derivado de purchase_line)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.recipe_item_location_cost (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL,
  recipe_item_id   uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  location_id      uuid NOT NULL REFERENCES public.locations(id),
  unit_cost        numeric NOT NULL,
  cost_strategy    text NOT NULL DEFAULT 'avg_window'
                     CHECK (cost_strategy IN ('avg_window','last_purchase','fixed')),
  cost_window_days integer,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  source           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_item_id, location_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- AJUSTES — labor target + estrategia de coste por defecto
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.kitchen_settings
  ADD COLUMN labor_target_pct      numeric,
  ADD COLUMN cost_strategy_default text NOT NULL DEFAULT 'avg_window'
    CHECK (cost_strategy_default IN ('avg_window','last_purchase','fixed'));

-- ─────────────────────────────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX idx_supplier_account           ON public.supplier(account_id);
CREATE INDEX idx_supplier_account_active    ON public.supplier(account_id, is_active);
CREATE INDEX idx_purchase_account           ON public.purchase(account_id);
CREATE INDEX idx_purchase_location          ON public.purchase(location_id);
CREATE INDEX idx_purchase_supplier          ON public.purchase(supplier_id);
CREATE INDEX idx_purchase_account_status    ON public.purchase(account_id, status);
CREATE INDEX idx_purchase_needs_review      ON public.purchase(account_id, needs_review);
CREATE INDEX idx_purchase_document_date     ON public.purchase(document_date);
CREATE INDEX idx_purchase_line_purchase     ON public.purchase_line(purchase_id);
CREATE INDEX idx_purchase_line_recipe_item  ON public.purchase_line(recipe_item_id);
CREATE INDEX idx_purchase_line_needs_review ON public.purchase_line(account_id, map_needs_review);
CREATE INDEX idx_ril_cost_account           ON public.recipe_item_location_cost(account_id);
CREATE INDEX idx_ril_cost_location          ON public.recipe_item_location_cost(location_id);

-- ─────────────────────────────────────────────────────────────────────
-- RLS  (patrón clonado de recipe_item)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.supplier                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_line             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_item_location_cost ENABLE ROW LEVEL SECURITY;

-- supplier
CREATE POLICY supplier_select ON public.supplier
  FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY supplier_insert ON public.supplier
  FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY supplier_update ON public.supplier
  FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY supplier_delete ON public.supplier
  FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

-- purchase
CREATE POLICY purchase_select ON public.purchase
  FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY purchase_insert ON public.purchase
  FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY purchase_update ON public.purchase
  FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY purchase_delete ON public.purchase
  FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

-- purchase_line
CREATE POLICY purchase_line_select ON public.purchase_line
  FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY purchase_line_insert ON public.purchase_line
  FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY purchase_line_update ON public.purchase_line
  FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY purchase_line_delete ON public.purchase_line
  FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

-- recipe_item_location_cost
CREATE POLICY ril_cost_select ON public.recipe_item_location_cost
  FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY ril_cost_insert ON public.recipe_item_location_cost
  FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY ril_cost_update ON public.recipe_item_location_cost
  FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY ril_cost_delete ON public.recipe_item_location_cost
  FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

-- ─────────────────────────────────────────────────────────────────────
-- TRIGGERS updated_at
-- ─────────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_supplier_updated_at
  BEFORE UPDATE ON public.supplier
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_purchase_updated_at
  BEFORE UPDATE ON public.purchase
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_purchase_line_updated_at
  BEFORE UPDATE ON public.purchase_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_recipe_item_location_cost_updated_at
  BEFORE UPDATE ON public.recipe_item_location_cost
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
