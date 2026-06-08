-- 20260608T2500_preview_modifier_impact_cost.sql
-- Aplicada: 2026-06-08
--
-- G3 — tramo 6: PREVIEW de coste en vivo (el "latido").
--
-- Calcula, SIN GUARDAR NADA, el coste de un plato con un impacto de modificador
-- aplicado: coste base + delta del impacto. Alimenta el latido de la pestaña —
-- ver el food cost moverse MIENTRAS ajustas la cantidad, antes de confirmar.
--
-- CLAVE (regla de oro del coste): reutiliza _impact_cost — la MISMA función que usa
-- compute_sale_line_cost al guardar. Así el número del preview y el número que se
-- guardará al confirmar son IDÉNTICOS. Si reimplementáramos la conversión aquí, el
-- latido podría divergir del coste real → mentiría. No lo hacemos.
--
-- Es de solo lectura (no UPDATE). SECURITY DEFINER con guard de tenancy, como el
-- resto del motor. Devuelve base, delta y total.

BEGIN;

CREATE OR REPLACE FUNCTION public.preview_modifier_impact_cost(
  p_recipe_item_id uuid,          -- el plato base
  p_impact_type text,             -- add_item / remove_item / replace_item / multiply / bundle / none
  p_target_recipe_item_id uuid,   -- ingrediente que entra/sale (null para multiply/none)
  p_quantity numeric,             -- cantidad (o factor, si multiply)
  p_unit_id uuid                  -- unidad de la cantidad (null para multiply/none)
)
RETURNS TABLE(base_cost numeric, delta numeric, total_cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_base       numeric;
  v_delta      numeric := 0;
BEGIN
  SELECT account_id, COALESCE(computed_cost, fixed_cost)
    INTO v_account_id, v_base
  FROM recipe_item
  WHERE id = p_recipe_item_id;

  IF v_account_id IS NULL THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'preview_modifier_impact_cost: sin acceso a la cuenta %', v_account_id;
  END IF;

  -- Si el plato no tiene coste base, el preview tampoco lo tiene (honesto).
  IF v_base IS NULL THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  -- Delta según el tipo de impacto, con la MISMA lógica que compute_sale_line_cost.
  IF p_impact_type IN ('add_item', 'bundle', 'replace_item') THEN
    v_delta := public._impact_cost(p_target_recipe_item_id, p_quantity, p_unit_id);
  ELSIF p_impact_type = 'remove_item' THEN
    v_delta := -public._impact_cost(p_target_recipe_item_id, p_quantity, p_unit_id);
  ELSIF p_impact_type = 'multiply' THEN
    v_delta := v_base * (COALESCE(p_quantity, 1) - 1);
  ELSE
    v_delta := 0;  -- none
  END IF;

  RETURN QUERY SELECT v_base, v_delta, ROUND(v_base + v_delta, 6);
END;
$function$;

COMMIT;
