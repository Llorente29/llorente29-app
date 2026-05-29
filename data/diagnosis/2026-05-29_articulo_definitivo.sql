-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — MODELO DE ARTÍCULO DEFINITIVO DE FOLVY
-- ════════════════════════════════════════════════════════════════════
-- Transforma recipe_item (heredado de tspoon) en el artículo genérico de
-- Folvy: válido para toda la hostelería (dark kitchen, obrador, restaurante,
-- bar, catering), con identidad propia, papeles combinables, unidades
-- múltiples y proveedores múltiples. Cimiento del motor de mapeo, OCR de
-- compras, inventario y venta directa.
--
-- DECISIONES (tomadas con criterio sobre toda la info de la sesión):
--   · folvy_code = prefijo por tipo + correlativo por cuenta (RAW/REC/DSH/TOO).
--     Estable (no atado a familia, que puede cambiar). code tspoon → external_codes.
--   · Papeles combinables (is_purchasable/is_sellable; is_stockable ya existe;
--     producible se deriva de tener recipe_line). Modelo agnóstico al tipo de negocio.
--   · 3 unidades: purchase_unit_id + stock_unit_id (base_unit_id ya existe).
--   · article_supplier: proveedores MÚLTIPLES por artículo (match OCR por código proveedor).
--   · nutrition/media: huecos jsonb (estructura sí, UI después).
--   · type real en BBDD = raw/recipe/dish/tool (NO 'preparation').
--
-- SEGURO: todo aditivo (ADD COLUMN con default, tabla nueva). NO toca columnas
-- que la app lee. NO borra 'code'. recipe_item en producción no se rompe.
-- SQL Editor autocommit → BEGIN/COMMIT explícito.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) NUEVAS COLUMNAS — identidad, papeles, unidades, huecos
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.recipe_item
  ADD COLUMN folvy_code       text,                              -- código propio Folvy
  ADD COLUMN external_codes   jsonb NOT NULL DEFAULT '{}'::jsonb, -- {tspoon, proveedorX, plu...}
  ADD COLUMN alt_names        text[] NOT NULL DEFAULT '{}',       -- sinónimos para el mapeo
  ADD COLUMN purchase_unit_id uuid REFERENCES public.kitchen_unit(id), -- unidad de compra
  ADD COLUMN stock_unit_id    uuid REFERENCES public.kitchen_unit(id), -- unidad de inventario
  ADD COLUMN is_purchasable   boolean NOT NULL DEFAULT false,     -- se compra a proveedor
  ADD COLUMN is_sellable      boolean NOT NULL DEFAULT false,     -- se vende directamente
  ADD COLUMN nutrition        jsonb,                              -- hueco: kcal, macros...
  ADD COLUMN media            jsonb;                              -- hueco: vídeos, fichas

-- ─────────────────────────────────────────────────────────────────────
-- 2) GENERADOR DE folvy_code (prefijo por tipo + correlativo por cuenta)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.folvy_code_prefix(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'raw'    THEN 'RAW'
    WHEN 'recipe' THEN 'REC'
    WHEN 'dish'   THEN 'DSH'
    WHEN 'tool'   THEN 'TOO'
    ELSE 'ART' END;
$$;

CREATE OR REPLACE FUNCTION public.next_folvy_code(p_account_id uuid, p_type text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_prefix text := public.folvy_code_prefix(p_type);
  v_next   int;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(folvy_code FROM '[0-9]+$')::int), 0) + 1
    INTO v_next
    FROM public.recipe_item
    WHERE account_id = p_account_id
      AND folvy_code LIKE v_prefix || '-%';
  RETURN v_prefix || '-' || LPAD(v_next::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_folvy_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folvy_code IS NULL THEN
    NEW.folvy_code := public.next_folvy_code(NEW.account_id, NEW.type);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recipe_item_folvy_code
  BEFORE INSERT ON public.recipe_item
  FOR EACH ROW EXECUTE FUNCTION public.set_folvy_code();

-- ─────────────────────────────────────────────────────────────────────
-- 3) BACKFILL de los artículos existentes
-- ─────────────────────────────────────────────────────────────────────
-- 3a) Migrar el code heredado de tspoon a external_codes (no se borra 'code')
UPDATE public.recipe_item
SET external_codes = jsonb_build_object('tspoon', code)
WHERE code IS NOT NULL AND code <> '';

-- 3b) Generar folvy_code correlativo por (cuenta, tipo), en orden de creación
WITH numbered AS (
  SELECT id, type,
         ROW_NUMBER() OVER (PARTITION BY account_id, type
                            ORDER BY created_at, id) AS rn
  FROM public.recipe_item
  WHERE folvy_code IS NULL
)
UPDATE public.recipe_item ri
SET folvy_code = public.folvy_code_prefix(n.type) || '-' || LPAD(n.rn::text, 5, '0')
FROM numbered n
WHERE ri.id = n.id;

-- 3c) Papeles iniciales sensatos: raws se compran; lo que tiene menu_item se vende
UPDATE public.recipe_item SET is_purchasable = true WHERE type = 'raw';
UPDATE public.recipe_item ri SET is_sellable = true
WHERE EXISTS (SELECT 1 FROM public.menu_item mi
              WHERE mi.recipe_item_id = ri.id AND mi.archived_at IS NULL);

-- ─────────────────────────────────────────────────────────────────────
-- 4) UNIQUE de folvy_code por cuenta (tras backfill, ya sin nulos)
-- ─────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX uq_recipe_item_folvy_code
  ON public.recipe_item(account_id, folvy_code);

-- ─────────────────────────────────────────────────────────────────────
-- 5) PROVEEDORES MÚLTIPLES por artículo (match OCR por código de proveedor)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.article_supplier (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL,
  recipe_item_id   uuid NOT NULL REFERENCES public.recipe_item(id) ON DELETE CASCADE,
  supplier_id      uuid NOT NULL REFERENCES public.supplier(id) ON DELETE CASCADE,
  supplier_code    text,                              -- código del artículo EN ese proveedor
  purchase_unit_id uuid REFERENCES public.kitchen_unit(id),
  last_price       numeric,
  is_preferred     boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_item_id, supplier_id)
);

CREATE INDEX idx_article_supplier_account  ON public.article_supplier(account_id);
CREATE INDEX idx_article_supplier_item     ON public.article_supplier(recipe_item_id);
CREATE INDEX idx_article_supplier_supplier ON public.article_supplier(supplier_id);
CREATE INDEX idx_article_supplier_code     ON public.article_supplier(account_id, supplier_code);

ALTER TABLE public.article_supplier ENABLE ROW LEVEL SECURITY;
CREATE POLICY article_supplier_select ON public.article_supplier
  FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY article_supplier_insert ON public.article_supplier
  FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY article_supplier_update ON public.article_supplier
  FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY article_supplier_delete ON public.article_supplier
  FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

CREATE TRIGGER trg_article_supplier_updated_at
  BEFORE UPDATE ON public.article_supplier
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
