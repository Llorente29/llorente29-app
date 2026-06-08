-- 20260608T2100_sale_line_cost_engine.sql
-- Aplicada: 2026-06-08
--
-- Motor de COSTE DE VENTA REAL (corazón del frente modificadores+combos).
-- "Un plato es su escandallo más su modificador, son inseparables": el coste real de
-- una línea vendida = coste del escandallo del producto ± el coste de los modificadores
-- que llevó ESA venta. Se CONGELA en la línea (no se recalcula al cambiar precios
-- mañana → el margen histórico es estable).
--
-- Este paso 1: producto + modificadores. (Combos = paso 2, en esta misma función.)
--
-- La conversión cantidad→coste es IDÉNTICA a kitchen_recompute_item (no se reimplementa):
--   qty_in_base = qty * unidad_linea.factor_to_base / ingrediente.base_unit.factor_to_base
--   (o vía recipe_item_unit_conversion si cambia de dimensión)
--   coste = ingrediente.coste * qty_in_base
-- Así el coste del modificador cuadra al céntimo con el del escandallo.
--
-- Resolución del modificador: del JSON de la venta (modifiers[].organizationModifierId)
--   → modifier_option.external_id → modifier_recipe_impact → coste del impacto.
-- impact_type: add_item/bundle (+), remove_item (−), replace_item (−viejo +nuevo),
--   multiply (escala el plato), none (0).
-- Mientras modifier_recipe_impact esté vacío, los modificadores suman 0 → coste =
-- escandallo base. El motor queda listo; cada impacto que se pueble se refleja al recasar.
--
-- Honesto: si el plato no tiene coste (computed_cost NULL) → computed_cost de la línea
-- NULL (no 0 falso). La señal "casado sin coste" ya lo refleja.

BEGIN;

ALTER TABLE public.sale_line
  ADD COLUMN IF NOT EXISTS computed_cost numeric,
  ADD COLUMN IF NOT EXISTS cost_computed_at timestamptz;

-- Helper: coste de un impacto concreto (cantidad+unidad de un ingrediente objetivo),
-- usando la MISMA conversión que el escandallo. Devuelve 0 si no resoluble.
CREATE OR REPLACE FUNCTION public._impact_cost(
  p_target_item_id uuid,
  p_quantity numeric,
  p_unit_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_child_cost      numeric;
  v_qty_in_base     numeric;
  v_conv            numeric;
BEGIN
  IF p_target_item_id IS NULL OR p_quantity IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_child FROM recipe_item WHERE id = p_target_item_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);

  SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = p_unit_id;
  SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
  IF v_line_unit.id IS NULL OR v_child_base_unit.id IS NULL THEN RETURN 0; END IF;

  IF v_line_unit.dimension = v_child_base_unit.dimension THEN
    v_qty_in_base := p_quantity * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
  ELSE
    SELECT qty_in_base INTO v_conv
      FROM recipe_item_unit_conversion
      WHERE item_id = v_child.id AND from_unit_id = p_unit_id
      LIMIT 1;
    IF v_conv IS NOT NULL THEN
      v_qty_in_base := p_quantity * v_conv;
    ELSE
      RETURN 0;  -- no convertible → no aporta coste (honesto, no inventa)
    END IF;
  END IF;

  RETURN v_child_cost * v_qty_in_base;
END;
$function$;

-- Motor: coste de una línea de venta = escandallo del producto ± modificadores.
CREATE OR REPLACE FUNCTION public.compute_sale_line_cost(p_sale_line_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line        sale_line%ROWTYPE;
  v_account_id  uuid;
  v_mi          menu_item%ROWTYPE;
  v_base_cost   numeric;
  v_mod_total   numeric := 0;
  v_norm        text;
  v_elem        jsonb;
  v_mod         jsonb;
  v_impact      record;
  v_total       numeric;
BEGIN
  SELECT * INTO v_line FROM sale_line WHERE id = p_sale_line_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_account_id := v_line.account_id;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'compute_sale_line_cost: sin acceso a la cuenta %', v_account_id;
  END IF;

  -- Sin casar → sin coste (honesto).
  IF v_line.menu_item_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_mi FROM menu_item WHERE id = v_line.menu_item_id;
  IF v_mi.recipe_item_id IS NULL THEN RETURN NULL; END IF;

  -- Coste base = escandallo del producto. NULL si no tiene coste (no 0 falso).
  SELECT COALESCE(ri.computed_cost, ri.fixed_cost)
  INTO v_base_cost
  FROM recipe_item ri WHERE ri.id = v_mi.recipe_item_id;

  IF v_base_cost IS NULL THEN
    -- producto sin coste: la línea queda sin coste, la señal lo refleja
    UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN NULL;
  END IF;

  -- Localizar el elemento del JSON de la venta que corresponde a esta línea (por nombre
  -- normalizado, igual que el casado) para leer sus modifiers[].
  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(v_line.product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g');

  SELECT rp.elem INTO v_elem
  FROM sale s, lateral jsonb_array_elements(s.raw_products::jsonb) rp(elem)
  WHERE s.id = v_line.sale_id
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name','')))), '\.$', ''),
          '\s+', ' ', 'g') = v_norm
  LIMIT 1;

  -- Sumar el impacto de cada modificador de esta venta.
  IF v_elem IS NOT NULL AND jsonb_typeof(v_elem->'modifiers') = 'array' THEN
    FOR v_mod IN SELECT * FROM jsonb_array_elements(v_elem->'modifiers')
    LOOP
      -- organizationModifierId → modifier_option → modifier_recipe_impact
      FOR v_impact IN
        SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
               COALESCE((v_mod->>'quantity')::numeric, 1) AS mod_qty
        FROM modifier_option mo
        JOIN modifier_recipe_impact mri ON mri.modifier_option_id = mo.id
        WHERE mo.account_id = v_account_id
          AND mo.external_id = (v_mod->>'organizationModifierId')
      LOOP
        IF v_impact.impact_type IN ('add_item','bundle') THEN
          v_mod_total := v_mod_total + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'remove_item' THEN
          v_mod_total := v_mod_total - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'replace_item' THEN
          -- replace: el impacto representa el NUEVO ingrediente; el viejo se modela como
          -- remove_item aparte si procede. Aquí sumamos el nuevo.
          v_mod_total := v_mod_total + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'multiply' THEN
          v_mod_total := v_mod_total + v_base_cost * (COALESCE(v_impact.quantity,1) - 1);
        END IF;
        -- 'none' → 0
      END LOOP;
    END LOOP;
  END IF;

  v_total := ROUND((v_base_cost + v_mod_total) * COALESCE(v_line.quantity, 1), 6);

  UPDATE sale_line
    SET computed_cost = v_total, cost_computed_at = now()
    WHERE id = p_sale_line_id;

  RETURN v_total;
END;
$function$;

COMMIT;
