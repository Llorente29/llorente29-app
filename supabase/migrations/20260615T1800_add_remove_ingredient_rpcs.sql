-- 20260615T1800_add_remove_ingredient_rpcs.sql
-- Aplicada: 2026-06-15 (Folvy Interno + Llorente29, vía SQL Editor)
-- Familia "gestionar ingrediente en escandallos" (junto a substitute_*):
--   QUITAR: preview_remove_ingredient / remove_ingredient_from_recipes
--   AÑADIR: preview_add_ingredient / add_ingredient_to_recipes (cantidad+unidad+corte)
-- Mismo patrón: preview por plato con coste actual→nuevo (vía _qty_in_base),
-- acción SOLO sobre los platos elegidos, el front recostea con cascadeFromItem.
-- Todas SECURITY DEFINER con guard de cuenta (current_user_account_ids()).
-- p_cut / p_parents con DEFAULT NULL para que los tipos generados los marquen opcionales.

CREATE OR REPLACE FUNCTION public.preview_remove_ingredient(
  p_source uuid
) RETURNS TABLE(
  parent_item_id uuid, parent_name text,
  n_lines integer, first_qty numeric, first_unit_id uuid,
  coste_actual numeric, coste_nuevo numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_acc uuid; v_scost numeric;
BEGIN
  SELECT account_id, COALESCE(computed_cost, fixed_cost, 0)
    INTO v_acc, v_scost FROM recipe_item WHERE id = p_source;
  IF v_acc IS NULL OR NOT (v_acc = ANY (current_user_account_ids())) THEN
    RAISE EXCEPTION 'preview_remove_ingredient: origen no accesible';
  END IF;

  RETURN QUERY
  WITH src_lines AS (
    SELECT rl.parent_item_id, rl.position,
           COALESCE(rl.quantity_gross, rl.quantity_net) AS qty, rl.unit_id,
           public._qty_in_base(p_source, COALESCE(rl.quantity_gross, rl.quantity_net), rl.unit_id) AS src_base
    FROM recipe_line rl
    WHERE rl.child_item_id = p_source AND rl.account_id = v_acc
  ),
  per_dish AS (
    SELECT s.parent_item_id,
      count(*)::int AS n_lines,
      (array_agg(s.qty ORDER BY s.position NULLS LAST))[1] AS first_qty,
      (array_agg(s.unit_id ORDER BY s.position NULLS LAST))[1] AS first_unit_id,
      sum(COALESCE(s.src_base,0)) * v_scost AS quitado
    FROM src_lines s GROUP BY s.parent_item_id
  )
  SELECT d.parent_item_id, ri.name, d.n_lines, d.first_qty, d.first_unit_id,
         ri.computed_cost,
         CASE WHEN ri.computed_cost IS NULL THEN NULL
              ELSE GREATEST(ri.computed_cost - d.quitado, 0) END
  FROM per_dish d JOIN recipe_item ri ON ri.id = d.parent_item_id
  ORDER BY ri.name;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remove_ingredient_from_recipes(
  p_source uuid, p_parents uuid[] DEFAULT NULL
) RETURNS TABLE(removed integer, affected_item_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_acc uuid; v_removed int; v_affected uuid[];
BEGIN
  SELECT account_id INTO v_acc FROM recipe_item WHERE id = p_source;
  IF v_acc IS NULL OR NOT (v_acc = ANY (current_user_account_ids())) THEN
    RAISE EXCEPTION 'remove_ingredient_from_recipes: origen no accesible';
  END IF;
  IF p_parents IS NULL OR array_length(p_parents,1) IS NULL THEN
    RETURN QUERY SELECT 0, '{}'::uuid[]; RETURN;
  END IF;

  SELECT array_agg(DISTINCT parent_item_id) INTO v_affected
  FROM recipe_line
  WHERE child_item_id = p_source AND account_id = v_acc AND parent_item_id = ANY(p_parents);

  WITH del AS (
    DELETE FROM recipe_line
    WHERE child_item_id = p_source AND account_id = v_acc AND parent_item_id = ANY(p_parents)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_removed FROM del;

  RETURN QUERY SELECT v_removed, COALESCE(v_affected, '{}'::uuid[]);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.preview_add_ingredient(
  p_target uuid, p_qty numeric, p_unit uuid, p_cut uuid DEFAULT NULL
) RETURNS TABLE(
  parent_item_id uuid, parent_name text,
  already_has boolean, is_cycle boolean,
  coste_actual numeric, coste_nuevo numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_acc uuid; v_tcost numeric; v_added_base numeric; v_added_cost numeric;
BEGIN
  SELECT account_id, COALESCE(computed_cost, fixed_cost, 0)
    INTO v_acc, v_tcost FROM recipe_item WHERE id = p_target;
  IF v_acc IS NULL OR NOT (v_acc = ANY (current_user_account_ids())) THEN
    RAISE EXCEPTION 'preview_add_ingredient: ingrediente no accesible';
  END IF;
  v_added_base := public._qty_in_base(p_target, p_qty, p_unit);
  v_added_cost := CASE WHEN v_added_base IS NULL THEN NULL ELSE v_added_base * v_tcost END;

  RETURN QUERY
  WITH RECURSIVE desc_target AS (
    SELECT p_target AS item_id
    UNION
    SELECT rl.child_item_id FROM recipe_line rl
    JOIN desc_target d ON rl.parent_item_id = d.item_id
  )
  SELECT ri.id, ri.name,
    EXISTS (SELECT 1 FROM recipe_line t WHERE t.parent_item_id = ri.id AND t.child_item_id = p_target),
    (ri.id IN (SELECT item_id FROM desc_target)),
    ri.computed_cost,
    CASE WHEN ri.id IN (SELECT item_id FROM desc_target) OR v_added_cost IS NULL OR ri.computed_cost IS NULL
         THEN NULL ELSE ri.computed_cost + v_added_cost END
  FROM recipe_item ri
  WHERE ri.account_id = v_acc AND ri.type IN ('dish','recipe') AND ri.id <> p_target
  ORDER BY ri.name;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.add_ingredient_to_recipes(
  p_target uuid, p_qty numeric, p_unit uuid, p_cut uuid DEFAULT NULL, p_parents uuid[] DEFAULT NULL
) RETURNS TABLE(added integer, skipped_cycle integer, affected_item_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_acc uuid; v_added int:=0; v_skipped int:=0; v_affected uuid[]:='{}'; pid uuid; v_pos int;
BEGIN
  SELECT account_id INTO v_acc FROM recipe_item WHERE id = p_target;
  IF v_acc IS NULL OR NOT (v_acc = ANY (current_user_account_ids())) THEN
    RAISE EXCEPTION 'add_ingredient_to_recipes: ingrediente no accesible';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 OR p_unit IS NULL THEN
    RAISE EXCEPTION 'add_ingredient_to_recipes: cantidad/unidad inválida';
  END IF;
  IF p_parents IS NULL OR array_length(p_parents,1) IS NULL THEN
    RETURN QUERY SELECT 0,0,'{}'::uuid[]; RETURN;
  END IF;

  FOREACH pid IN ARRAY p_parents LOOP
    IF NOT EXISTS (SELECT 1 FROM recipe_item WHERE id = pid AND account_id = v_acc
                     AND type IN ('dish','recipe')) THEN CONTINUE; END IF;
    IF pid = p_target OR EXISTS (
        WITH RECURSIVE dt AS (
          SELECT p_target AS item_id
          UNION
          SELECT rl.child_item_id FROM recipe_line rl JOIN dt ON rl.parent_item_id = dt.item_id
        ) SELECT 1 FROM dt WHERE item_id = pid) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    SELECT COALESCE(max(position),0)+1 INTO v_pos FROM recipe_line WHERE parent_item_id = pid;
    INSERT INTO recipe_line(account_id, parent_item_id, child_item_id,
                            quantity_gross, quantity_net, unit_id, cut_type_id, position)
    VALUES (v_acc, pid, p_target, p_qty, p_qty, p_unit, p_cut, v_pos);

    v_added := v_added + 1;
    IF NOT (pid = ANY(v_affected)) THEN v_affected := array_append(v_affected, pid); END IF;
  END LOOP;

  RETURN QUERY SELECT v_added, v_skipped, v_affected;
END;
$fn$;
