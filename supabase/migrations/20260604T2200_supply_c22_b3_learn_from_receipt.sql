-- ============================================================================
-- Folvy Supply C2.2.b.3 — aprendizaje al confirmar
-- ============================================================================
-- 1) goods_receipt_line.supplier_code — el código del proveedor leído del
--    albarán (lo necesita el aprendizaje para casar por código la próxima vez).
-- 2) learn_from_receipt(p_receipt_id) — tras confirmar, por cada línea con
--    recipe_item_id, UPSERT en article_supplier (clave recipe_item_id+supplier_id):
--    set supplier_code, supplier_item_name (= raw_text, denominación del
--    proveedor), last_price (= unit_cost), purchase_format_id si lo hay.
--    NO toca el coste (eso ya lo hace confirm_goods_receipt / el ledger): esto es
--    la MEMORIA para el próximo casado. Capa AÑADIDA, no modifica confirm_goods_receipt.
--
-- SECURITY DEFINER con guard idéntico a confirm_goods_receipt. Se valida desde la
-- app (auth.uid() null en el SQL Editor). DDL/función en transacciones separadas
-- de cualquier prueba: aquí solo se crea, no se ejecuta.
-- ============================================================================

-- ── 1) Código del proveedor en la línea de recepción ──
alter table public.goods_receipt_line
  add column if not exists supplier_code text;

-- ── 2) Función de aprendizaje ──
create or replace function public.learn_from_receipt(p_receipt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_receipt goods_receipt%ROWTYPE;
  v_line    goods_receipt_line%ROWTYPE;
  v_count   integer := 0;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'learn_from_receipt: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_receipt.account_id)) THEN
    RAISE EXCEPTION 'learn_from_receipt: sin acceso al albarán %', p_receipt_id;
  END IF;

  -- Sin proveedor en la cabecera no hay nada que aprender (la memoria es por proveedor).
  IF v_receipt.supplier_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id
      AND recipe_item_id IS NOT NULL
  LOOP
    INSERT INTO article_supplier (
      account_id, recipe_item_id, supplier_id,
      supplier_code, supplier_item_name, last_price, purchase_format_id,
      is_preferred, is_active
    )
    VALUES (
      v_receipt.account_id, v_line.recipe_item_id, v_receipt.supplier_id,
      NULLIF(btrim(coalesce(v_line.supplier_code, '')), ''),
      NULLIF(btrim(coalesce(v_line.raw_text, v_line.product_name, '')), ''),
      v_line.unit_cost,
      v_line.purchase_format_id,
      false, true
    )
    ON CONFLICT (recipe_item_id, supplier_id) DO UPDATE SET
      -- Solo sobreescribe lo que viene con valor (no borra lo aprendido antes).
      supplier_code      = COALESCE(NULLIF(btrim(coalesce(EXCLUDED.supplier_code, '')), ''), article_supplier.supplier_code),
      supplier_item_name = COALESCE(EXCLUDED.supplier_item_name, article_supplier.supplier_item_name),
      last_price         = COALESCE(EXCLUDED.last_price, article_supplier.last_price),
      purchase_format_id = COALESCE(EXCLUDED.purchase_format_id, article_supplier.purchase_format_id),
      is_active          = true,
      updated_at         = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
