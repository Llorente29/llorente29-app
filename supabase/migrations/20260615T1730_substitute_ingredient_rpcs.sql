-- 20260615T1730_substitute_ingredient_rpcs.sql
-- Aplicada: 2026-06-15 (Folvy Interno + Llorente29, vía SQL Editor)
-- Sustituir un ingrediente por otro en los escandallos (mantenimiento).
--   preview_substitute_ingredient: una fila por plato afectado, con estado
--     (limpio | fusion | revisar | ciclo) + coste actual y proyectado.
--     El proyectado usa _qty_in_base (la conversión real del motor de coste).
--   substitute_ingredient_in_recipes: aplica SOLO en los platos elegidos
--     (p_parents). Fusiona si mismo destino+unidad+corte (suma cantidades,
--     gross NULL-safe); deja 2 líneas si difiere; salta ciclos. Devuelve los
--     platos afectados (el front recostea con cascadeFromItem).
-- Ambas SECURITY DEFINER con guard de cuenta (current_user_account_ids()).

CREATE OR REPLACE FUNCTION public.preview_substitute_ingredient(
  p_source uuid, p_target uuid
) RETURNS TABLE(
  parent_item_id uuid, parent_name text, estado text,
  n_lines integer, first_qty numeric, first_unit_id uuid,
  coste_actual numeric, coste_nuevo numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_acc uuid; v_scost numeric; v_tcost numeric;
BEGIN
  SELECT account_id, COALESCE(computed_cost, fixed_cost, 0)
    INTO v_acc, v_scost FROM recipe_item WHERE id = p_source;
  IF v_acc IS NULL OR NOT (v_acc = ANY (current_user_account_ids())) THEN
    RAISE EXCEPTION 'preview_substitute_ingredient: origen no accesible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM recipe_item WHERE id = p_target AND account_id = v_acc) THEN
    RAISE EXCEPTION 'preview_substitute_ingredient: destino no existe en la misma cuenta';
  END IF;
  SELECT COALESCE(computed_cost, fixed_cost, 0) INTO v_tcost
    FROM recipe_item WHERE id = p_target;

  RETURN QUERY
  WITH RECURSIVE desc_target AS (
    SELECT p_target AS item_id
    UNION
    SELECT rl.child_item_id FROM recipe_line rl
    JOIN desc_target d ON rl.parent_item_id = d.item_id
  ),
  src_lines AS (
    SELECT rl.parent_item_id, rl.position,
           COALESCE(rl.quantity_gross, rl.quantity_net) AS qty,
           rl.unit_id,
           public._qty_in_base(p_source, COALESCE(rl.quantity_gross, rl.quantity_net), rl.unit_id) AS src_base,
           public._qty_in_base(p_target, COALESCE(rl.quantity_gross, rl.quantity_net), rl.unit_id) AS tgt_base,
           EXISTS (SELECT 1 FROM recipe_line t WHERE t.parent_item_id = rl.parent_item_id
                     AND t.child_item_id = p_target AND t.unit_id = rl.unit_id
                     AND t.cut_type_id IS NOT DISTINCT FROM rl.cut_type_id) AS fusable,
           EXISTS (SELECT 1 FROM recipe_line t WHERE t.parent_item_id = rl.parent_item_id
                     AND t.child_item_id = p_target) AS has_target
    FROM recipe_line rl
    WHERE rl.child_item_id = p_source AND rl.account_id = v_acc
  ),
  per_dish AS (
    SELECT s.parent_item_id,
      bool_or(s.parent_item_id IN (SELECT item_id FROM desc_target)) AS is_cycle,
      bool_or(s.fusable) AS any_fusion,
      bool_or(s.has_target AND NOT s.fusable) AS any_dup,
      bool_or(s.tgt_base IS NULL) AS any_unconv,
      count(*)::int AS n_lines,
      (array_agg(s.qty ORDER BY s.position NULLS LAST))[1] AS first_qty,
      (array_agg(s.unit_id ORDER BY s.position NULLS LAST))[1] AS first_unit_id,
      sum(COALESCE(s.src_base,0)) * v_scost AS old_cost,
      CASE WHEN bool_or(s.tgt_base IS NULL) THEN NULL
           ELSE sum(COALESCE(s.tgt_base,0)) * v_tcost END AS new_cost
    FROM src_lines s
    GROUP BY s.parent_item_id
  )
  SELECT
    d.parent_item_id, ri.name,
    CASE WHEN d.is_cycle THEN 'ciclo'
         WHEN d.any_dup THEN 'revisar'
         WHEN d.any_fusion THEN 'fusion'
         ELSE 'limpio' END,
    d.n_lines, d.first_qty, d.first_unit_id,
    ri.computed_cost,
    CASE WHEN d.is_cycle OR d.new_cost IS NULL OR ri.computed_cost IS NULL THEN NULL
         ELSE ri.computed_cost - d.old_cost + d.new_cost END
  FROM per_dish d
  JOIN recipe_item ri ON ri.id = d.parent_item_id
  ORDER BY ri.name;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.substitute_ingredient_in_recipes(
  p_source uuid, p_target uuid, p_parents uuid[]
) RETURNS TABLE(
  replaced integer, merged integer, flagged integer,
  skipped_cycle integer, affected_item_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_acc uuid; v_replaced int:=0; v_merged int:=0; v_flagged int:=0; v_skipped int:=0;
  v_affected uuid[]:='{}'; r RECORD; v_tline uuid;
BEGIN
  SELECT account_id INTO v_acc FROM recipe_item WHERE id = p_source;
  IF v_acc IS NULL OR NOT (v_acc = ANY (current_user_account_ids())) THEN
    RAISE EXCEPTION 'substitute_ingredient_in_recipes: origen no accesible';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM recipe_item WHERE id = p_target AND account_id = v_acc) THEN
    RAISE EXCEPTION 'substitute_ingredient_in_recipes: destino no existe en la misma cuenta';
  END IF;
  IF p_parents IS NULL OR array_length(p_parents, 1) IS NULL THEN
    RETURN QUERY SELECT 0,0,0,0,'{}'::uuid[]; RETURN;
  END IF;

  FOR r IN
    WITH RECURSIVE desc_target AS (
      SELECT p_target AS item_id
      UNION
      SELECT rl.child_item_id FROM recipe_line rl
      JOIN desc_target d ON rl.parent_item_id = d.item_id
    )
    SELECT rl.id, rl.parent_item_id, rl.unit_id, rl.cut_type_id,
           rl.quantity_gross, rl.quantity_net,
           (rl.parent_item_id IN (SELECT item_id FROM desc_target)) AS is_cycle
    FROM recipe_line rl
    WHERE rl.child_item_id = p_source AND rl.account_id = v_acc
      AND rl.parent_item_id = ANY (p_parents)
  LOOP
    IF r.is_cycle THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    SELECT t.id INTO v_tline FROM recipe_line t
    WHERE t.parent_item_id = r.parent_item_id AND t.child_item_id = p_target
      AND t.unit_id = r.unit_id AND t.cut_type_id IS NOT DISTINCT FROM r.cut_type_id
    ORDER BY t.id LIMIT 1;

    IF v_tline IS NOT NULL THEN
      UPDATE recipe_line tgt
        SET quantity_net = tgt.quantity_net + r.quantity_net,
            quantity_gross = CASE WHEN tgt.quantity_gross IS NULL OR r.quantity_gross IS NULL
                                  THEN NULL ELSE tgt.quantity_gross + r.quantity_gross END,
            updated_at = now()
        WHERE tgt.id = v_tline;
      DELETE FROM recipe_line WHERE id = r.id;
      v_merged := v_merged + 1;
    ELSIF EXISTS (SELECT 1 FROM recipe_line t
            WHERE t.parent_item_id = r.parent_item_id AND t.child_item_id = p_target) THEN
      UPDATE recipe_line SET child_item_id = p_target, updated_at = now() WHERE id = r.id;
      v_flagged := v_flagged + 1;
    ELSE
      UPDATE recipe_line SET child_item_id = p_target, updated_at = now() WHERE id = r.id;
      v_replaced := v_replaced + 1;
    END IF;

    IF NOT (r.parent_item_id = ANY (v_affected)) THEN
      v_affected := array_append(v_affected, r.parent_item_id);
    END IF;
    v_tline := NULL;
  END LOOP;

  RETURN QUERY SELECT v_replaced, v_merged, v_flagged, v_skipped, v_affected;
END;
$fn$;
