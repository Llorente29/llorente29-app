-- ─────────────────────────────────────────────────────────────────────────────
-- format_price_per_base(p_format_id, p_supplier_id)
--
-- Devuelve el precio por UNIDAD BASE (€/g, €/ml, €/ud) de un formato de compra,
-- para un proveedor concreto. El precio vive en el formato de compra real (la
-- caja); los sub-envases (bote/unidad) DERIVAN su precio de la caja que los
-- contiene. Si no hay precio por ningún camino → NULL (cero falsos positivos).
--
-- Lógica:
--   (1) ¿El formato tiene precio propio con ese proveedor?  → last_price / qty_in_base
--   (2) ¿Es sub-envase de una caja con precio de ese proveedor?
--         (existe una caja con parent_format_id = este formato, con last_price)
--         → last_price_caja / qty_per_parent / qty_in_base_sub
--   (3) Si nada → NULL
--
-- Solo lectura. No es SECURITY DEFINER: se puede probar en el SQL Editor.
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
  -- (1) precio propio del formato con ese proveedor
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
  -- (2) derivado desde la caja que tiene este formato como sub-envase
  --     (parent_format_id apunta al sub-envase; qty_per_parent = cuántos contiene)
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

-- ─── Prueba en seco (no modifica nada): los 4 formatos de Tzatziki ───
-- Proveedores: 9,60€ = Caja 1200 (parent=Uni); 36,54€ = Caja 2400 (parent=Bote).
-- Esperado: Caja 2400 → 36,54/2400 = 0,015225 €/g
--           Bote 200  → 36,54/12/200 = 0,015225 €/g (mismo €/g, coherente)
SELECT
  pf.name,
  pf.qty_in_base,
  as2.supplier_id,
  as2.last_price AS precio_articulo_supplier,
  format_price_per_base(pf.id, as2.supplier_id) AS eur_por_base
FROM recipe_item_purchase_format pf
JOIN recipe_item ri ON ri.id = pf.item_id
LEFT JOIN article_supplier as2
  ON as2.recipe_item_id = pf.item_id AND as2.is_active
WHERE pf.account_id = '00000000-0000-0000-0000-000000000001'
  AND ri.name ILIKE '%tzatziki%'
ORDER BY pf.qty_in_base, as2.last_price;
