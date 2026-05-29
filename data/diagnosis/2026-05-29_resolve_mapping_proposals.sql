-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — resolve_mapping_proposals(session_id)
-- ════════════════════════════════════════════════════════════════════
-- Resuelve las mapping_proposal 'pending' de una sesión de escandallo:
-- por cada una, busca el recipe_item con la cascada de run_mapping
-- (código → nombre exacto → nombre normalizado → difuso pg_trgm), escribe
-- el mejor match en la propuesta y guarda los candidatos en mapping_candidate.
--
-- Estados resultantes (umbrales de map-products: 0.95 auto / 0.55 revisar):
--   conf >= 0.95 → auto_confirmed (verde, se da por bueno)
--   conf >= 0.55 → needs_review   (amarillo, el humano confirma)
--   sin candidato → no_candidate   (azul, crear nuevo)
--
-- method: exact | fuzzy (cómo casó). La IA semántica queda para un 2º paso
-- sobre lo que aquí quede en needs_review/no_candidate.
-- Integra la lógica de run_mapping (no lo llama) para no depender de su guard.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_mapping_proposals(
  p_session_id   uuid,
  p_target_types text[] DEFAULT ARRAY['raw','recipe'],
  p_fuzzy_min    numeric DEFAULT 0.45
)
RETURNS TABLE(
  resolved        integer,
  auto_confirmed  integer,
  needs_review    integer,
  no_candidate    integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_prop       record;
  v_norm       text;
  v_best_id    uuid;
  v_best_name  text;
  v_best_conf  numeric;
  v_best_method text;
  v_status     text;
  v_resolved   int := 0;
  v_auto       int := 0;
  v_review     int := 0;
  v_none       int := 0;
  v_rank       int;
  v_cand       record;
BEGIN
  -- cuenta de la sesión
  SELECT account_id INTO v_account_id
  FROM recipe_item_ai_session WHERE id = p_session_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Sesión % no encontrada', p_session_id;
  END IF;

  -- recorrer las propuestas pendientes de esta sesión
  FOR v_prop IN
    SELECT id, source_text, source_normalized
    FROM mapping_proposal
    WHERE source_ref = p_session_id AND status = 'pending'
  LOOP
    v_norm := COALESCE(v_prop.source_normalized,
                       normalize_ingredient_name(v_prop.source_text));
    v_best_id := NULL; v_best_name := NULL; v_best_conf := NULL; v_best_method := NULL;

    -- limpiar candidatos previos de esta propuesta (idempotente)
    DELETE FROM mapping_candidate WHERE proposal_id = v_prop.id;

    -- escribir candidatos (hasta 5) y quedarnos con el mejor
    v_rank := 0;
    FOR v_cand IN
      SELECT ri.id, ri.name,
             CASE
               WHEN normalize_ingredient_name(ri.name) = v_norm THEN 0.99::numeric
               ELSE ROUND(similarity(normalize_ingredient_name(ri.name), v_norm)::numeric, 2)
             END AS conf,
             CASE
               WHEN normalize_ingredient_name(ri.name) = v_norm THEN 'exact'
               ELSE 'fuzzy'
             END AS mt
      FROM recipe_item ri
      WHERE ri.account_id = v_account_id
        AND ri.is_active = true
        AND ri.type = ANY(p_target_types)
        AND (
          normalize_ingredient_name(ri.name) = v_norm
          OR (normalize_ingredient_name(ri.name) % v_norm
              AND similarity(normalize_ingredient_name(ri.name), v_norm) >= p_fuzzy_min)
        )
      ORDER BY conf DESC, ri.name
      LIMIT 5
    LOOP
      v_rank := v_rank + 1;
      INSERT INTO mapping_candidate (proposal_id, target_id, target_label, score, rank, reason)
      VALUES (v_prop.id, v_cand.id, v_cand.name, v_cand.conf, v_rank,
              CASE v_cand.mt WHEN 'exact' THEN 'Nombre coincide'
                             ELSE 'Similitud ' || v_cand.conf END);
      IF v_rank = 1 THEN
        v_best_id := v_cand.id; v_best_name := v_cand.name;
        v_best_conf := v_cand.conf; v_best_method := v_cand.mt;
      END IF;
    END LOOP;

    -- decidir estado según confianza
    IF v_best_id IS NOT NULL AND v_best_conf >= 0.95 THEN
      v_status := 'auto_confirmed'; v_auto := v_auto + 1;
    ELSIF v_best_id IS NOT NULL AND v_best_conf >= 0.55 THEN
      v_status := 'needs_review'; v_review := v_review + 1;
    ELSE
      v_status := 'no_candidate'; v_none := v_none + 1;
      v_best_id := NULL; v_best_method := NULL;
    END IF;

    UPDATE mapping_proposal
    SET chosen_target_id = v_best_id,
        confidence       = v_best_conf,
        method           = COALESCE(v_best_method, 'fuzzy'),
        status           = v_status,
        updated_at       = now()
    WHERE id = v_prop.id;

    v_resolved := v_resolved + 1;
  END LOOP;

  RETURN QUERY SELECT v_resolved, v_auto, v_review, v_none;
END;
$function$;
