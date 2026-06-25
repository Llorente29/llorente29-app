-- Puebla descuento por línea CANÓNICO tras adaptar un pedido. Multi-TPV.
-- Se llama después de adapt_lastapp_order / adapt_hubrise_order.
-- Lee el raw del pedido y escribe original_unit_price + discount_label en sale_line.
-- Casa por external_product_id (matrícula), que el adaptador ya guarda en la línea.

CREATE OR REPLACE FUNCTION public.fill_line_discounts(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  v_sale  sale%ROWTYPE;
  v_count integer := 0;
  v_prod  jsonb;
  v_full  numeric;
  v_final numeric;
  v_disc  numeric;
  v_ext   text;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- ── LAST: raw_products[]; price en céntimos; fullPrice vs finalPrice ──
  IF v_sale.source = 'lastapp' AND v_sale.raw_products IS NOT NULL THEN
    FOR v_prod IN SELECT * FROM jsonb_array_elements(v_sale.raw_products::jsonb)
    LOOP
      v_ext   := nullif(v_prod->>'organizationProductId','');
      v_full  := nullif(v_prod->>'fullPrice','')::numeric;
      v_final := nullif(v_prod->>'finalPrice','')::numeric;
      v_disc  := nullif(v_prod->>'discountAmount','')::numeric;
      IF v_ext IS NULL OR v_full IS NULL OR v_final IS NULL THEN CONTINUE; END IF;
      IF v_full <= v_final THEN CONTINUE; END IF;     -- sin descuento real
      UPDATE sale_line sl
         SET original_unit_price = v_full / 100.0,
             unit_price = v_final / 100.0,
             line_total = (v_final / 100.0) * sl.quantity,
             discount_label = 'Descuento ' || replace(trim(to_char(
                COALESCE(v_disc, v_full - v_final) / 100.0, 'FM999990.00')), '.', ',') || ' EUR'
       WHERE sl.sale_id = p_sale_id
         AND sl.external_product_id = v_ext
         AND sl.line_type = 'product'
         AND sl.parent_sale_line_id IS NULL;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- ── HUBRISE: raw_tab.items[]; price_offset/subtotal indica descuento ──
  -- HubRise pone el precio ya con su valor; el descuento de línea viene como
  -- 'discounts' o diferencia con 'subtotal'. Si existe item->>'discount', se usa.
  IF v_sale.source = 'hubrise' AND v_sale.raw_tab IS NOT NULL THEN
    FOR v_prod IN SELECT * FROM jsonb_array_elements(COALESCE(v_sale.raw_tab::jsonb->'items','[]'::jsonb))
    LOOP
      v_ext   := nullif(v_prod->>'sku_ref','');
      -- HubRise: price = unitario; si trae 'price_without_discount' o 'full_price', tachar.
      v_full  := public.hubrise_money(coalesce(v_prod->>'full_price', v_prod->>'price_without_discount'));
      v_final := public.hubrise_money(v_prod->>'price');
      IF v_ext IS NULL OR v_full IS NULL OR v_final IS NULL THEN CONTINUE; END IF;
      IF v_full <= v_final THEN CONTINUE; END IF;
      UPDATE sale_line sl
         SET original_unit_price = v_full,
             discount_label = 'Descuento ' || replace(trim(to_char(v_full - v_final, 'FM999990.00')), '.', ',') || ' EUR'
       WHERE sl.sale_id = p_sale_id
         AND sl.external_product_id = v_ext
         AND sl.line_type = 'product'
         AND sl.parent_sale_line_id IS NULL;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$func$;
