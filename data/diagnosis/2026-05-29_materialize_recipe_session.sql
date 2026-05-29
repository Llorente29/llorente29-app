-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — materialize_recipe_session(session_id)
-- ════════════════════════════════════════════════════════════════════
-- Convierte una sesión de escandallo (ya extraída y mapeada) en un
-- escandallo REAL: recipe_item del plato + recipe_line de los ingredientes.
--
-- LÓGICA (decisiones de Julio):
--  · Plato (opción 3): si la sesión tiene recipe_item_id → actualiza ese
--    escandallo (reemplaza sus líneas); si no → crea un recipe_item nuevo.
--  · Ingredientes (opción C):
--      - con chosen_target_id (verde/amarillo) → recipe_line a ese artículo.
--      - sin match (azul) → CREA el artículo (type=raw) con needs_review=true
--        + motivo, coste provisional de la ficha, y luego la recipe_line.
--        Queda marcado para que un responsable complete la ficha.
--  · Unidad: el texto de la foto ('g','ud'...) → unit_id de kitchen_unit por
--    abreviatura normalizada. Si no casa → la línea se omite y se reporta
--    (no se inventa unidad). El plato queda marcado para revisar esa línea.
--  · Al acabar: sesión → 'accepted'. Devuelve resumen con artículos nuevos.
--
-- parsed_result viene de recipe_item_ai_session: {dish:{...}, lines:[{raw_text,
--   quantity, unit, cost, note}], notes}. El match de cada línea se cruza por
--   su source_text contra mapping_proposal (source_ref = session).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.materialize_recipe_session(
  p_session_id uuid
)
RETURNS TABLE(
  result_recipe_id      uuid,
  dish_name             text,
  was_created           boolean,   -- true si plato nuevo, false si actualizado
  lines_created         integer,
  new_articles_created  integer,   -- artículos provisionales creados (needs_review)
  lines_skipped         integer    -- líneas omitidas (unidad no reconocida)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_parsed     jsonb;
  v_dish       jsonb;
  v_dish_name  text;
  v_recipe_id  uuid;
  v_created    boolean := false;
  v_line       jsonb;
  v_raw_text   text;
  v_norm       text;
  v_qty        numeric;
  v_unit_txt   text;
  v_unit_id    uuid;
  v_cost       numeric;
  v_note       text;
  v_child_id   uuid;
  v_chosen     uuid;
  v_pos        int := 0;
  v_lines      int := 0;
  v_newart     int := 0;
  v_skipped    int := 0;
  v_default_unit uuid;   -- unidad 'ud' para base_unit_id del plato
BEGIN
  -- ── Cargar la sesión ──
  SELECT s.account_id, s.parsed_result, s.recipe_item_id
  INTO v_account_id, v_parsed, v_recipe_id
  FROM recipe_item_ai_session s WHERE s.id = p_session_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Sesión % no encontrada', p_session_id;
  END IF;

  v_dish := v_parsed->'dish';
  v_dish_name := COALESCE(v_dish->>'name', 'Escandallo sin nombre');

  -- unidad por defecto del plato (una ración = 1 ud)
  SELECT id INTO v_default_unit FROM kitchen_unit
  WHERE (account_id = v_account_id OR account_id IS NULL)
    AND lower(abbreviation) = 'ud'
  LIMIT 1;

  -- ── El PLATO: actualizar existente o crear nuevo ──
  IF v_recipe_id IS NOT NULL THEN
    -- actualizar: limpiar las líneas anteriores (se reemplazan por las nuevas)
    DELETE FROM recipe_line WHERE parent_item_id = v_recipe_id;
    v_created := false;
  ELSE
    -- crear plato nuevo (folvy_code lo pone el trigger)
    INSERT INTO recipe_item (account_id, type, name, source, base_unit_id, ai_confidence, created_by_name)
    VALUES (v_account_id, 'dish', v_dish_name, 'ai_recipe', v_default_unit, NULL, 'IA (foto)')
    RETURNING id INTO v_recipe_id;
    v_created := true;
    -- vincular la sesión al plato creado
    UPDATE recipe_item_ai_session SET recipe_item_id = v_recipe_id WHERE id = p_session_id;
  END IF;

  -- ── Las LÍNEAS ──
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_parsed->'lines')
  LOOP
    v_raw_text := v_line->>'raw_text';
    CONTINUE WHEN v_raw_text IS NULL OR trim(v_raw_text) = '';
    v_norm  := normalize_ingredient_name(v_raw_text);
    v_qty   := NULLIF(v_line->>'quantity','')::numeric;
    v_unit_txt := lower(trim(COALESCE(v_line->>'unit','')));
    v_cost  := NULLIF(v_line->>'cost','')::numeric;
    v_note  := v_line->>'note';

    -- resolver unidad por abreviatura normalizada (g, gr→g; ud, uds, unidad→ud)
    SELECT id INTO v_unit_id FROM kitchen_unit
    WHERE (account_id = v_account_id OR account_id IS NULL)
      AND lower(abbreviation) = CASE
            WHEN v_unit_txt IN ('g','gr','gramo','gramos') THEN 'g'
            WHEN v_unit_txt IN ('kg','kilo','kilogramo')   THEN 'kg'
            WHEN v_unit_txt IN ('l','litro','litros')      THEN 'l'
            WHEN v_unit_txt IN ('ml','mililitro')          THEN 'ml'
            WHEN v_unit_txt IN ('ud','uds','unidad','u')   THEN 'ud'
            ELSE v_unit_txt END
    LIMIT 1;

    -- si la unidad no se reconoce, no inventamos: omitir y contar
    IF v_unit_id IS NULL OR v_qty IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- buscar el match de esta línea en mapping_proposal
    SELECT chosen_target_id INTO v_chosen
    FROM mapping_proposal
    WHERE source_ref = p_session_id
      AND source_normalized = v_norm
      AND status IN ('auto_confirmed','needs_review','human_confirmed')
    LIMIT 1;

    IF v_chosen IS NOT NULL THEN
      -- artículo existente
      v_child_id := v_chosen;
    ELSE
      -- artículo NUEVO (opción C): crear provisional, needs_review + motivo
      INSERT INTO recipe_item (
        account_id, type, name, source, fixed_cost, cost_strategy,
        base_unit_id, needs_review, review_notes, created_by_name
      )
      VALUES (
        v_account_id, 'raw', v_raw_text, 'ai_recipe', v_cost,
        CASE WHEN v_cost IS NOT NULL THEN 'fixed' ELSE NULL END,
        v_unit_id, true,
        jsonb_build_object('reason', 'Creado automáticamente desde ficha (foto). Completar coste real, proveedor y formato.',
                           'origin_session', p_session_id),
        'IA (foto)'
      )
      RETURNING id INTO v_child_id;
      v_newart := v_newart + 1;
    END IF;

    -- crear la línea del escandallo
    v_pos := v_pos + 1;
    INSERT INTO recipe_line (
      account_id, parent_item_id, child_item_id,
      quantity_net, unit_id, comment, position
    )
    VALUES (
      v_account_id, v_recipe_id, v_child_id,
      v_qty, v_unit_id, v_note, v_pos
    );
    v_lines := v_lines + 1;
  END LOOP;

  -- ── Cerrar la sesión ──
  UPDATE recipe_item_ai_session SET status = 'accepted', updated_at = now()
  WHERE id = p_session_id;

  RETURN QUERY SELECT v_recipe_id, v_dish_name, v_created, v_lines, v_newart, v_skipped;
END;
$function$;
