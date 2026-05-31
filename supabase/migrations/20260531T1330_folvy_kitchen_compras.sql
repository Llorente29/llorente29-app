-- ============================================================================
-- Migration: Folvy Kitchen — Compras (cimiento): formatos de compra + coste
-- Fecha: 2026-05-31
-- Aplicada: Supabase project xzmpnchlguibclvxyynt (eu-west-1) — ejecutada y
--           verificada en sesión; este fichero la registra en el repo.
--
-- Contenido (4 bloques, una unidad coherente del eslabón "Artículos + formatos"):
--   1. Tabla recipe_item_purchase_format — árbol de empaquetado por ingrediente
--      (caja→bolsa→base), con integridad declarativa y RLS calcado de
--      recipe_item_unit_conversion.
--   2. article_supplier — +purchase_format_id, −purchase_unit_id (opción A:
--      el proveedor vende UN nodo del árbol).
--   3. Función kitchen_recompute_raw_cost — coste del ingrediente desde el
--      formato del proveedor (selector fixed/last_purchase/average_*; average_*
--      dormidas hasta la recepción; nunca inventa conversión).
--   4. Trigger trg_article_supplier_recompute_cost — recalcula el coste del
--      ingrediente al cambiar su compra (eje A híbrido, lado BBDD).
--   5. Función kitchen_ancestors_of — ancestros transitivos de un ingrediente,
--      para la cascada a platos (orquestada por la app, no por trigger).
--
-- Notas / hallazgos de la sesión:
--   · "Caja"/"Bolsa" NO son kitchen_unit (error de tspoon evitado); el
--     empaquetado vive en su tabla propia colgando del ingrediente.
--   · qty_in_base es la única verdad numérica del coste (>0); el blindaje de
--     conversión (dimensión/densidad) vive en la capa de alta, no en el coste.
--   · Las funciones SECURITY DEFINER NO se prueban en SQL Editor (auth.uid()
--     null); se verifican por separado y se prueban desde la app.
-- ============================================================================

BEGIN;

-- ─── 1. Árbol de formatos de compra ────────────────────────────────────────
CREATE TABLE recipe_item_purchase_format (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES recipe_item(id) ON DELETE CASCADE,
  name              text NOT NULL,
  parent_format_id  uuid REFERENCES recipe_item_purchase_format(id) ON DELETE CASCADE,
  qty_per_parent    numeric CHECK (qty_per_parent IS NULL OR qty_per_parent > 0),
  qty_in_base       numeric NOT NULL CHECK (qty_in_base > 0),
  is_piece          boolean NOT NULL DEFAULT false,
  is_weighted       boolean NOT NULL DEFAULT false,
  source            text NOT NULL DEFAULT 'manual',
  ai_confidence     numeric,
  needs_review      boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  created_by_name   text,
  CONSTRAINT ripf_id_item_uq UNIQUE (id, item_id),
  CONSTRAINT ripf_parent_same_item
    FOREIGN KEY (parent_format_id, item_id)
    REFERENCES recipe_item_purchase_format (id, item_id) ON DELETE CASCADE,
  CONSTRAINT ripf_no_self_parent CHECK (parent_format_id IS NULL OR parent_format_id <> id)
);

CREATE INDEX ripf_item_idx    ON recipe_item_purchase_format (item_id);
CREATE INDEX ripf_account_idx ON recipe_item_purchase_format (account_id);
CREATE INDEX ripf_parent_idx  ON recipe_item_purchase_format (parent_format_id);

ALTER TABLE recipe_item_purchase_format ENABLE ROW LEVEL SECURITY;

CREATE POLICY ripf_select ON recipe_item_purchase_format
  FOR SELECT USING (belongs_to_account(account_id));
CREATE POLICY ripf_insert ON recipe_item_purchase_format
  FOR INSERT WITH CHECK (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY ripf_update ON recipe_item_purchase_format
  FOR UPDATE USING (current_user_is_admin_or_manager_of(account_id));
CREATE POLICY ripf_delete ON recipe_item_purchase_format
  FOR DELETE USING (current_user_is_admin_or_manager_of(account_id));

-- ─── 2. article_supplier: +purchase_format_id, −purchase_unit_id ────────────
ALTER TABLE article_supplier
  ADD COLUMN purchase_format_id uuid REFERENCES recipe_item_purchase_format(id) ON DELETE SET NULL;
ALTER TABLE article_supplier
  DROP COLUMN purchase_unit_id;
CREATE INDEX article_supplier_format_idx ON article_supplier (purchase_format_id);

-- ─── 3. Coste del ingrediente desde el formato del proveedor ────────────────
CREATE OR REPLACE FUNCTION public.kitchen_recompute_raw_cost(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item          recipe_item%ROWTYPE;
  v_link          article_supplier%ROWTYPE;
  v_format        recipe_item_purchase_format%ROWTYPE;
  v_cost          numeric;
  v_found         boolean := false;
  v_needs_review  boolean := false;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_raw_cost: item % no existe', p_item_id;
  END IF;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recompute_raw_cost: sin acceso al item %', p_item_id;
  END IF;

  IF v_item.type NOT IN ('raw', 'tool') THEN
    RETURN COALESCE(v_item.computed_cost, 0);
  END IF;

  IF v_item.cost_strategy = 'fixed' THEN
    v_cost := COALESCE(v_item.fixed_cost, 0);
    UPDATE recipe_item
      SET computed_cost = v_cost, cost_updated_at = now()
      WHERE id = p_item_id;
    RETURN v_cost;
  END IF;

  SELECT a.* INTO v_link
    FROM article_supplier a
    WHERE a.recipe_item_id = p_item_id
      AND a.is_active
      AND a.purchase_format_id IS NOT NULL
      AND a.last_price IS NOT NULL
    ORDER BY a.is_preferred DESC, a.updated_at DESC
    LIMIT 1;

  IF FOUND THEN
    SELECT f.* INTO v_format
      FROM recipe_item_purchase_format f
      WHERE f.id = v_link.purchase_format_id
        AND f.is_active;

    IF FOUND AND v_format.qty_in_base > 0 THEN
      v_cost  := v_link.last_price / v_format.qty_in_base;
      v_found := true;
      IF v_format.needs_review THEN
        v_needs_review := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_found THEN
    UPDATE recipe_item
      SET needs_review = true, cost_updated_at = now()
      WHERE id = p_item_id;
    RETURN COALESCE(v_item.computed_cost, v_item.fixed_cost, 0);
  END IF;

  UPDATE recipe_item
    SET computed_cost   = v_cost,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_needs_review THEN true ELSE needs_review END
    WHERE id = p_item_id;

  RETURN v_cost;
END;
$function$;

-- ─── 4. Trigger: recalcular coste del ingrediente al cambiar su compra ──────
CREATE OR REPLACE FUNCTION public.trg_article_supplier_recompute_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.kitchen_recompute_raw_cost(
    COALESCE(NEW.recipe_item_id, OLD.recipe_item_id)
  );
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_article_supplier_recompute_cost ON public.article_supplier;
CREATE TRIGGER trg_article_supplier_recompute_cost
  AFTER INSERT OR DELETE OR UPDATE OF last_price, purchase_format_id, is_preferred, is_active
  ON public.article_supplier
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_article_supplier_recompute_cost();

-- ─── 5. Ancestros transitivos (para la cascada a platos, lado app) ──────────
CREATE OR REPLACE FUNCTION public.kitchen_ancestors_of(p_item_id uuid)
 RETURNS TABLE (ancestor_id uuid, depth integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_ancestors_of: item % no existe', p_item_id;
  END IF;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'kitchen_ancestors_of: sin acceso al item %', p_item_id;
  END IF;

  RETURN QUERY
  WITH RECURSIVE ancestros AS (
    SELECT rl.parent_item_id AS ancestor_id, 1 AS depth
    FROM recipe_line rl
    WHERE rl.child_item_id = p_item_id
    UNION
    SELECT rl.parent_item_id, a.depth + 1
    FROM recipe_line rl
    JOIN ancestros a ON rl.child_item_id = a.ancestor_id
  )
  SELECT anc.ancestor_id, MAX(anc.depth) AS depth
  FROM ancestros anc
  GROUP BY anc.ancestor_id
  ORDER BY MAX(anc.depth) DESC;
END;
$function$;

COMMIT;
