-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: derivación de precio por unidad-base desde la jerarquía de formatos.
--
-- El precio vive en el formato de compra (la caja); los sub-envases (bote/unidad)
-- derivan su precio dividiendo por cuántos contiene la caja. Estas dos funciones
-- de solo lectura lo calculan; las consume el aviso de variación de precio en la
-- recepción de albaranes (y, a futuro, inventario y escandallo).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION format_price_per_base(
  p_format_id   uuid,
  p_supplier_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH self AS (
    SELECT id, qty_in_base
    FROM recipe_item_purchase_format
    WHERE id = p_format_id
  ),
  own AS (
    SELECT as2.last_price, s.qty_in_base
    FROM article_supplier as2
    JOIN self s ON true
    WHERE as2.purchase_format_id = p_format_id
      AND as2.supplier_id        = p_supplier_id
      AND as2.is_active
      AND as2.last_price IS NOT NULL
      AND s.qty_in_base > 0
    LIMIT 1
  ),
  derived AS (
    SELECT as2.last_price, caja.qty_per_parent, s.qty_in_base
    FROM recipe_item_purchase_format caja
    JOIN self s ON true
    JOIN article_supplier as2
      ON as2.purchase_format_id = caja.id
     AND as2.supplier_id        = p_supplier_id
     AND as2.is_active
     AND as2.last_price IS NOT NULL
    WHERE caja.parent_format_id = p_format_id
      AND caja.qty_per_parent > 0
      AND s.qty_in_base > 0
    ORDER BY as2.last_price
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT last_price / qty_in_base FROM own),
    (SELECT last_price / qty_per_parent / qty_in_base FROM derived)
  );
$$;

CREATE OR REPLACE FUNCTION supplier_format_prices(
  p_account_id  uuid,
  p_supplier_id uuid
)
RETURNS TABLE (format_id uuid, eur_per_base numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT pf.id AS format_id,
         (as2.last_price / pf.qty_in_base) AS eur_per_base
  FROM article_supplier as2
  JOIN recipe_item_purchase_format pf ON pf.id = as2.purchase_format_id
  WHERE as2.account_id = p_account_id
    AND as2.supplier_id = p_supplier_id
    AND as2.is_active
    AND as2.last_price IS NOT NULL
    AND pf.qty_in_base > 0

  UNION ALL

  SELECT sub.id AS format_id,
         (as2.last_price / caja.qty_per_parent / sub.qty_in_base) AS eur_per_base
  FROM recipe_item_purchase_format caja
  JOIN article_supplier as2
    ON as2.purchase_format_id = caja.id
   AND as2.account_id  = p_account_id
   AND as2.supplier_id = p_supplier_id
   AND as2.is_active
   AND as2.last_price IS NOT NULL
  JOIN recipe_item_purchase_format sub
    ON sub.id = caja.parent_format_id
  WHERE caja.account_id = p_account_id
    AND caja.qty_per_parent > 0
    AND sub.qty_in_base > 0;
$$;
