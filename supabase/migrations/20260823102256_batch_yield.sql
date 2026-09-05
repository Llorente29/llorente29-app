-- Rendimiento de batch en sub-recetas. Ver supabase/migrations/20260823T2000_batch_yield.sql
ALTER TABLE public.recipe_item
  ADD COLUMN IF NOT EXISTS batch_yield         numeric,
  ADD COLUMN IF NOT EXISTS batch_yield_unit_id uuid REFERENCES public.kitchen_unit(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipe_item_batch_yield_positive'
      AND conrelid = 'public.recipe_item'::regclass
  ) THEN
    ALTER TABLE public.recipe_item
      ADD CONSTRAINT recipe_item_batch_yield_positive
      CHECK (batch_yield IS NULL OR batch_yield > 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.recipe_item.batch_yield IS
  'Rendimiento del batch: cuánto produce esta receta, expresado en '
  'batch_yield_unit_id (si es NULL, en la unidad base del propio ítem). '
  'NULL = auto-yield: el motor suma lo que pesan/miden sus líneas. '
  'Se aplica a type=recipe siempre, y a cualquier tipo que lo declare.';
COMMENT ON COLUMN public.recipe_item.batch_yield_unit_id IS
  'Unidad en la que está expresado batch_yield. El motor lo normaliza a la '
  'unidad base del ítem con _qty_in_base antes de dividir.';

CREATE OR REPLACE FUNCTION public._batch_yield_in_base(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item  recipe_item%ROWTYPE;
  v_base  kitchen_unit%ROWTYPE;
  v_yield numeric;
BEGIN
  IF p_item_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- (a) DECLARADO: se normaliza a la unidad base del ítem.
  IF v_item.batch_yield IS NOT NULL AND v_item.batch_yield > 0 THEN
    v_yield := public._qty_in_base(
                 p_item_id,
                 v_item.batch_yield,
                 COALESCE(v_item.batch_yield_unit_id, v_item.base_unit_id));
    IF v_yield IS NOT NULL AND v_yield > 0 THEN
      RETURN v_yield;
    END IF;
    RETURN NULL;
  END IF;

  -- (b) AUTO-YIELD: suma de las líneas medibles EN LA UNIDAD BASE DEL PADRE.
  SELECT * INTO v_base FROM kitchen_unit WHERE id = v_item.base_unit_id;
  IF v_base.id IS NULL THEN RETURN NULL; END IF;

  SELECT SUM(COALESCE(rl.quantity_gross, rl.quantity_net)
             * lu.factor_to_base / v_base.factor_to_base)
    INTO v_yield
  FROM recipe_line rl
  JOIN kitchen_unit lu ON lu.id = rl.unit_id
  WHERE rl.parent_item_id = p_item_id
    AND lu.dimension = v_base.dimension;

  IF v_yield IS NOT NULL AND v_yield > 0 THEN
    RETURN v_yield;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public._batch_yield_in_base(uuid) IS
  'Rendimiento del batch expresado en la unidad base del ítem. Declarado '
  '(batch_yield + su unidad, normalizado con _qty_in_base) o automático (suma '
  'de las líneas medibles en esa base). NULL = sin rendimiento aplicable.';

CREATE OR REPLACE FUNCTION public.explode_recipe_to_raws(p_item_id uuid, p_multiplier numeric)
 RETURNS TABLE(raw_item_id uuid, qty_base numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item  recipe_item%ROWTYPE;
  v_line  recipe_line%ROWTYPE;
  v_qb    numeric;
  v_yield numeric := NULL;
BEGIN
  IF p_item_id IS NULL OR p_multiplier IS NULL THEN RETURN; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Condicion de parada: hoja del arbol de consumo.
  IF v_item.type IN ('raw', 'tool')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    raw_item_id := p_item_id;
    qty_base    := p_multiplier;
    RETURN NEXT;
    RETURN;
  END IF;

  -- NUEVO: rendimiento del batch. Solo preparaciones o quien lo declare.
  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
  END IF;
  IF v_yield IS NULL OR v_yield <= 0 THEN
    v_yield := 1;
  END IF;

  -- Nodo compuesto (recipe no-stockable o dish): recurrir por cada linea.
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      CONTINUE;
    END IF;
    RETURN QUERY
      SELECT * FROM public.explode_recipe_to_raws(
                      v_line.child_item_id,
                      (p_multiplier / v_yield) * v_qb);
  END LOOP;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kitchen_recompute_item(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_line_cost       numeric;
  v_total           numeric := 0;
  v_packaging       numeric := 0;
  v_incomplete      boolean := false;
  v_yield           numeric := NULL;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_item: item % no existe', p_item_id;
  END IF;
  IF NOT public.belongs_to_account(v_item.account_id) THEN
    RAISE EXCEPTION 'kitchen_recompute_item: sin acceso al item %', p_item_id;
  END IF;
  IF v_item.type IN ('raw', 'tool', 'packaging') THEN
    RETURN public.kitchen_recompute_raw_cost(p_item_id);
  END IF;
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
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
        v_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;
    v_line_cost := v_child_cost * v_qty_in_base;
    v_total := v_total + v_line_cost;
    IF v_child.type = 'packaging' THEN
      v_packaging := v_packaging + v_line_cost;
    END IF;
  END LOOP;

  -- NUEVO: coste POR UNIDAD DE RENDIMIENTO. Mismo criterio que explode.
  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
    IF v_yield IS NOT NULL AND v_yield > 0 THEN
      v_total     := v_total / v_yield;
      v_packaging := v_packaging / v_yield;
    END IF;
  END IF;

  UPDATE recipe_item
    SET computed_cost   = v_total,
        packaging_cost  = v_packaging,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END,
        completeness    = COALESCE(completeness, '{}'::jsonb)
                          || jsonb_build_object(
                               'cost_incomplete', v_incomplete,
                               'cost_incomplete_reason',
                                 CASE WHEN v_incomplete THEN 'unmeasurable_line' ELSE NULL END)
    WHERE id = p_item_id;
  RETURN v_total;
END;
$function$;

DO $guard$
DECLARE
  v_missing text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='recipe_item'
      AND column_name IN ('batch_yield','batch_yield_unit_id')
    HAVING count(*) = 2
  ) THEN
    v_missing := v_missing || 'columnas batch_yield/batch_yield_unit_id; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='_batch_yield_in_base'
  ) THEN
    v_missing := v_missing || '_batch_yield_in_base; ';
  END IF;

  IF regexp_replace(
       pg_get_functiondef('public.explode_recipe_to_raws(uuid,numeric)'::regprocedure),
       '--[^\n]*', '', 'g') NOT ILIKE '%_batch_yield_in_base%' THEN
    v_missing := v_missing || 'explode_recipe_to_raws sin rendimiento; ';
  END IF;
  IF regexp_replace(
       pg_get_functiondef('public.kitchen_recompute_item(uuid)'::regprocedure),
       '--[^\n]*', '', 'g') NOT ILIKE '%_batch_yield_in_base%' THEN
    v_missing := v_missing || 'kitchen_recompute_item sin rendimiento; ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRACIÓN INCOMPLETA: %', v_missing;
  END IF;
  RAISE NOTICE 'OK — rendimiento de batch activo.';
END
$guard$;