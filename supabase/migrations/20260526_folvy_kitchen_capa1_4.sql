-- =====================================================================
-- FUNCIÓN: kitchen_recipe_breakdown(p_item_id uuid)
--   → TABLE(line_id, child_item_id, child_name, quantity, unit_abbr,
--           line_cost, needs_review)
--
-- Folvy Kitchen — DESGLOSE de coste por línea de un plato/receta.
-- Una fila por cada recipe_line del plato, con el coste de esa línea
-- calculado con LA MISMA lógica de conversión + merma que
-- kitchen_recompute_item (copiada, NO reinventada). Por construcción, la
-- SUMA de line_cost == computed_cost del plato → las partes suman el total.
--
-- La pantalla calculará el % de cada línea (line_cost / suma) en cliente:
-- es una división simple, sin conversiones, así que no compromete la
-- honestidad del número (a diferencia de calcular el coste en cliente).
--
-- needs_review por línea = true si esa línea NO se pudo convertir (coste 0
-- honesto). La pantalla la marca en rojo (patrón meez).
--
-- SECURITY DEFINER + search_path fijo + MISMO guard de tenancy que
-- kitchen_recompute_item (lee datos de la cuenta).
--
-- NO escribe nada (función de solo lectura / reporte). No toca computed_cost.
--
-- REVISAR ANTES DE EJECUTAR. Propuesta del coordinador; ejecuta Julio.
-- EDITOR SUPABASE: CREATE OR REPLACE, no necesita BEGIN/COMMIT.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.kitchen_recipe_breakdown(p_item_id uuid)
RETURNS TABLE (
  line_id       uuid,
  child_item_id uuid,
  child_name    text,
  quantity      numeric,
  unit_abbr     text,
  line_cost     numeric,
  needs_review  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item            recipe_item%ROWTYPE;
  v_line            recipe_line%ROWTYPE;
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_qty             numeric;
  v_qty_in_base     numeric;
  v_child_cost      numeric;
  v_conv            numeric;
  v_line_total      numeric;
  v_line_incomplete boolean;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recipe_breakdown: item % no existe', p_item_id;
  END IF;

  -- MISMO guard de tenancy que kitchen_recompute_item (SECURITY DEFINER salta RLS)
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recipe_breakdown: sin acceso al item %', p_item_id;
  END IF;

  -- Solo elaboraciones tienen líneas. Si es raw/tool, no devuelve filas.
  IF v_item.type NOT IN ('recipe', 'dish') THEN
    RETURN;
  END IF;

  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;

    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    v_line_incomplete := false;

    -- Conversión IDÉNTICA a kitchen_recompute_item
    IF v_line_unit.dimension = v_child_base_unit.dimension THEN
      v_qty_in_base := v_qty * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
    ELSE
      SELECT qty_in_base INTO v_conv
        FROM recipe_item_unit_conversion
        WHERE item_id = v_child.id AND from_unit_id = v_line.unit_id
        LIMIT 1;

      IF v_conv IS NOT NULL THEN
        v_qty_in_base := v_qty * v_conv;
      ELSE
        v_line_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;

    v_line_total := v_child_cost * v_qty_in_base;

    -- Emitir la fila del desglose
    line_id       := v_line.id;
    child_item_id := v_line.child_item_id;
    child_name    := v_child.name;
    quantity      := v_line.quantity_net;   -- cantidad neta (lo que se muestra al usuario)
    unit_abbr     := v_line_unit.abbreviation;
    line_cost     := v_line_total;
    needs_review  := v_line_incomplete;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

-- =====================================================================
-- PRUEBA (tras crear la función): con la Hamburguesa Clásica que ya existe.
-- Sustituir el UUID por el id real del plato (lo da un SELECT previo).
--
--   SELECT * FROM kitchen_recipe_breakdown('<id_hamburguesa>');
--
-- Esperado: 3 filas (carne, pan, queso), cada una con su line_cost, y
--   SUM(line_cost) == 1.5265 (el computed_cost que ya mostró la pantalla).
-- Verificación de cuadre:
--   SELECT SUM(line_cost) FROM kitchen_recipe_breakdown('<id_hamburguesa>');
--   → debe dar 1.5265 (o el valor exacto del computed_cost del plato).
-- =====================================================================
