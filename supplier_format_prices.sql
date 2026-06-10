-- ─────────────────────────────────────────────────────────────────────────────
-- supplier_format_prices(p_account_id, p_supplier_id)
--
-- Devuelve el precio por UNIDAD BASE (€/g, €/ml, €/ud) de TODOS los formatos que
-- ese proveedor puede surtir, en una sola consulta. Mismo modelo que
-- format_price_per_base pero en bloque (el front lo llama una vez y arma un mapa
-- format_id → €/base, evitando una llamada por línea).
--
-- El precio vive en el formato de compra (la caja); los sub-envases derivan:
--   · formato con precio propio  → last_price / qty_in_base
--   · sub-envase de una caja con precio → last_price_caja / qty_per_parent / qty_in_base_sub
-- Si un formato no tiene precio por ningún camino, NO aparece en el resultado
-- (el front lo trata como "sin dato" → sin aviso; cero falsos positivos).
--
-- Solo lectura. No SECURITY DEFINER: probable en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supplier_format_prices(
  p_account_id  uuid,
  p_supplier_id uuid
)
RETURNS TABLE (format_id uuid, eur_per_base numeric)
LANGUAGE sql
STABLE
AS $$
  -- (1) formatos con precio propio de este proveedor
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

  -- (2) sub-envases que derivan su precio de una caja con precio de este proveedor
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

-- ─── Prueba en seco (no modifica nada): formatos de Tzatziki del proveedor 36,54€ ───
-- Esperado: Caja 2400 → 0,015225 ; Bote 200 → 0,015225 (mismo €/g)
SELECT sfp.format_id, pf.name, pf.qty_in_base, sfp.eur_per_base
FROM supplier_format_prices(
       '00000000-0000-0000-0000-000000000001',
       '0e82cb84-b449-4233-a10a-34823b2fbff7'
     ) sfp
JOIN recipe_item_purchase_format pf ON pf.id = sfp.format_id
JOIN recipe_item ri ON ri.id = pf.item_id
WHERE ri.name ILIKE '%tzatziki%'
ORDER BY pf.qty_in_base;
