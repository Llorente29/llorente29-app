-- 20260628T1700_materialize_session_decisions.sql
-- Aplicada: 2026-06-28
--
-- materialize_recipe_session v2 — la decisión del humano (qué ingrediente es cada
-- línea de la ficha importada) se pasa DIRECTAMENTE como p_decisions y MANDA sobre
-- mapping_proposal.
--
-- RAÍZ que arregla: hasta ahora la decisión vivía SOLO en mapping_proposal, y la
-- RPC la leía de ahí. Pero cuando el Edge `extract-recipe` NO crea la propuesta de
-- una línea (choca con el índice único mapping_proposal_uq, que no incluye
-- source_ref), no hay fila que el modal pueda actualizar ni que la RPC pueda leer:
--   · resolveImportProposal hace UPDATE … WHERE source_normalized = X → 0 filas,
--     SIN error → la decisión se pierde en silencio.
--   · materialize busca esa misma fila, no la encuentra → CREA NUEVO.
-- Resultado: ingredientes nuevos (sin propuesta previa) se duplicaban SIEMPRE.
--
-- Solución (deuda 0): el modal pasa el objeto de decisiones completo y la RPC lo
-- usa con prioridad absoluta. Como el objeto siempre se construye para TODAS las
-- líneas, la decisión SIEMPRE existe — no depende del Edge, ni del índice único,
-- ni del parche de "adopción".
--
-- p_decisions = jsonb { "<source_normalized>": "<recipe_item_id>" | null }
--   · clave presente con uuid  → usar ese ingrediente existente (no duplica).
--   · clave presente con null  → crear nuevo a propósito (raw provisional).
--   · clave ausente            → fallback a mapping_proposal (flujo viejo / compat).
-- p_decisions = NULL           → comportamiento ANTERIOR intacto
--                                (importRecipeFromFile end-to-end sin revisión).
--
-- Nota: el casado por source_normalized usa normalize_ingredient_name(raw_text),
-- la MISMA clave que ya usaba el sistema (mapping_proposal.source_normalized); el
-- modal construye las claves con la función gemela del cliente. No se introduce
-- una clave nueva: solo se cambia DÓNDE vive la decisión (sesión, no proposal).

BEGIN;

-- 1 sola sobrecarga existente (verificado por RECON): DROP limpio.
DROP FUNCTION IF EXISTS public.materialize_recipe_session(uuid);

CREATE FUNCTION public.materialize_recipe_session(
  p_session_id uuid,
  p_decisions  jsonb DEFAULT NULL
)
RETURNS TABLE (
  result_recipe_id     uuid,
  dish_name            text,
  was_created          boolean,
  lines_created        int,
  new_articles_created int,
  lines_skipped        int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_decided    boolean;
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

  -- Persistir las decisiones recibidas en la sesión (trazabilidad + futuras lecturas).
  IF p_decisions IS NOT NULL THEN
    UPDATE recipe_item_ai_session
    SET decisions = p_decisions, updated_at = now()
    WHERE id = p_session_id;
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

    -- ── Resolver el ingrediente de esta línea ──
    v_chosen  := NULL;
    v_decided := false;

    -- (1) PRIORIDAD ABSOLUTA: decisión humana pasada en p_decisions.
    --     Presencia de la clave = el humano YA decidió esta línea.
    IF p_decisions IS NOT NULL AND (p_decisions ? v_norm) THEN
      v_decided := true;
      IF jsonb_typeof(p_decisions->v_norm) = 'string' THEN
        v_chosen := NULLIF(p_decisions->>v_norm, '')::uuid;   -- uuid = usar existente
      ELSE
        v_chosen := NULL;                                     -- null = crear nuevo a propósito
      END IF;
    END IF;

    -- (2) FALLBACK: mapping_proposal (flujo viejo end-to-end, o líneas sin decisión).
    IF NOT v_decided THEN
      SELECT chosen_target_id INTO v_chosen
      FROM mapping_proposal
      WHERE source_ref = p_session_id
        AND source_normalized = v_norm
        AND status IN ('auto_confirmed','needs_review','human_confirmed')
      LIMIT 1;
    END IF;

    IF v_chosen IS NOT NULL THEN
      -- artículo existente elegido por el humano (o por la propuesta): NO duplica.
      v_child_id := v_chosen;
    ELSE
      -- artículo NUEVO: crear provisional, needs_review + motivo.
      -- cost_strategy SIEMPRE 'fixed' (NOT NULL): si no hay coste, fixed_cost
      -- queda NULL = "sin coste, a completar". Igual que el defecto del front.
      INSERT INTO recipe_item (
        account_id, type, name, source, fixed_cost, cost_strategy,
        base_unit_id, needs_review, review_notes, created_by_name
      )
      VALUES (
        v_account_id, 'raw', v_raw_text, 'ai_recipe', v_cost,
        'fixed',
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
$$;

GRANT EXECUTE ON FUNCTION public.materialize_recipe_session(uuid, jsonb) TO authenticated;

COMMIT;
