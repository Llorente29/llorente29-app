-- ============================================================================
-- Folvy Supply C3.4 — Eslabón coste: aplicar precios de la factura
-- ============================================================================
-- apply_invoice_costs(p_invoice_id): por cada línea de factura casada (recipe_item
-- + precio), actualiza article_supplier.last_price = precio facturado (el coste
-- REAL que se paga; la factura confirma/corrige el del albarán). El UPDATE dispara
-- trg_article_supplier_recompute_cost → kitchen_recompute_raw_cost → cascada a platos.
-- Devuelve el IMPACTO: por ingrediente, coste antes vs después (+ Δ%).
--
-- NO mueve stock (lo hizo la recepción). Solo coste. Idempotente (re-aprobar deja
-- last_price en el último precio facturado).
-- SECURITY DEFINER + el trigger interno es SECURITY DEFINER → SE EJECUTA DESDE LA APP
-- (auth.uid() necesita sesión). NO probar en SQL Editor.
--
-- DDL sin BEGIN/COMMIT.
-- ============================================================================

create or replace function public.apply_invoice_costs(p_invoice_id uuid)
returns table (
  recipe_item_id uuid,
  item_name text,
  old_cost numeric,
  new_cost numeric,
  old_price numeric,
  new_price numeric,
  pct numeric
)
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_account_id uuid;
  v_supplier_id uuid;
  v_line record;
  v_old_cost numeric;
  v_new_cost numeric;
  v_old_price numeric;
BEGIN
  SELECT account_id, supplier_id INTO v_account_id, v_supplier_id
    FROM public.supplier_invoice WHERE id = p_invoice_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Factura % no encontrada', p_invoice_id;
  END IF;

  -- Tabla temporal para acumular el impacto (un ingrediente puede salir una vez).
  CREATE TEMP TABLE _impact (
    recipe_item_id uuid, item_name text,
    old_cost numeric, new_cost numeric,
    old_price numeric, new_price numeric, pct numeric
  ) ON COMMIT DROP;

  FOR v_line IN
    SELECT sil.recipe_item_id, sil.unit_price
      FROM public.supplier_invoice_line sil
      WHERE sil.supplier_invoice_id = p_invoice_id
        AND sil.recipe_item_id IS NOT NULL
        AND sil.unit_price IS NOT NULL
  LOOP
    -- Sin proveedor en la factura no podemos ubicar el article_supplier correcto.
    IF v_supplier_id IS NULL THEN CONTINUE; END IF;

    -- Coste y precio ANTES.
    SELECT computed_cost INTO v_old_cost FROM public.recipe_item WHERE id = v_line.recipe_item_id;
    SELECT last_price INTO v_old_price
      FROM public.article_supplier
      WHERE account_id = v_account_id AND recipe_item_id = v_line.recipe_item_id AND supplier_id = v_supplier_id;

    -- Actualizar last_price (upsert por la clave única recipe_item_id+supplier_id).
    -- Dispara el trigger → recompute del raw → cascada a platos.
    INSERT INTO public.article_supplier (account_id, recipe_item_id, supplier_id, last_price)
    VALUES (v_account_id, v_line.recipe_item_id, v_supplier_id, v_line.unit_price)
    ON CONFLICT (recipe_item_id, supplier_id)
    DO UPDATE SET last_price = EXCLUDED.last_price;

    -- Coste DESPUÉS (el trigger ya recalculó).
    SELECT computed_cost INTO v_new_cost FROM public.recipe_item WHERE id = v_line.recipe_item_id;

    INSERT INTO _impact (recipe_item_id, item_name, old_cost, new_cost, old_price, new_price, pct)
    SELECT v_line.recipe_item_id,
           (SELECT name FROM public.recipe_item WHERE id = v_line.recipe_item_id),
           v_old_cost, v_new_cost, v_old_price, v_line.unit_price,
           CASE WHEN v_old_price IS NOT NULL AND v_old_price > 0
                THEN round(((v_line.unit_price - v_old_price) / v_old_price) * 100, 1)
                ELSE NULL END
    WHERE NOT EXISTS (SELECT 1 FROM _impact i WHERE i.recipe_item_id = v_line.recipe_item_id);
  END LOOP;

  RETURN QUERY
    SELECT i.recipe_item_id, i.item_name, i.old_cost, i.new_cost, i.old_price, i.new_price, i.pct
    FROM _impact i
    ORDER BY abs(COALESCE(i.pct, 0)) DESC;
END;
$$;
