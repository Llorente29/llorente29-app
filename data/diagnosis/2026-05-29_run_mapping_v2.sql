-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — run_mapping v2: motor de mapeo (refinado)
-- ════════════════════════════════════════════════════════════════════
-- Mejoras sobre v1 tras prueba real con la Bacon Cheeseburger:
--   · p_target_types text[] CONFIGURABLE (default {raw,recipe}): no casa
--     ingredientes contra dishes. El OCR de compras u otros módulos pasan
--     los tipos que quieran.
--   · Umbral difuso por defecto 0.45 (era 0.30): menos ruido de distractores.
--   · match_type bien etiquetado: las capas deterministas (code, name_exact,
--     name_normalized) ganan a fuzzy aunque fuzzy dé 1.00, vía prioridad de capa.
--   · La IA (Edge Function) queda como red de seguridad para lo dudoso/raro;
--     el SQL resuelve barato el grueso y no pretende cubrir el 100%.
--
-- normalize_ingredient_name ya existe (v1). pg_trgm ya instalada (v1).
-- Solo se reemplaza la función run_mapping.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.run_mapping(
  p_account_id   uuid,
  p_text         text,
  p_code         text     DEFAULT NULL,
  p_limit        int      DEFAULT 5,
  p_fuzzy_min    numeric  DEFAULT 0.45,
  p_target_types text[]   DEFAULT ARRAY['raw','recipe']  -- configurable
)
RETURNS TABLE(
  recipe_item_id uuid,
  name           text,
  folvy_code     text,
  confidence     numeric,
  match_type     text,    -- code | name_exact | name_normalized | fuzzy
  semaphore      text     -- green | yellow
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text := public.normalize_ingredient_name(p_text);
BEGIN
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'run_mapping: sin permiso sobre la cuenta %', p_account_id;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    -- Cada capa lleva 'prio' (1=mejor) para priorizar capa sobre similitud bruta
    -- 1) CÓDIGO
    SELECT ri.id, ri.name, ri.folvy_code, 1.00::numeric AS conf, 'code'::text AS mt, 1 AS prio
    FROM recipe_item ri
    WHERE ri.account_id = p_account_id AND ri.is_active = true
      AND ri.type = ANY(p_target_types)
      AND p_code IS NOT NULL AND p_code <> ''
      AND (
        ri.folvy_code = p_code
        OR EXISTS (SELECT 1 FROM jsonb_each_text(ri.external_codes) j WHERE j.value = p_code)
        OR EXISTS (SELECT 1 FROM article_supplier a
                   WHERE a.recipe_item_id = ri.id AND a.supplier_code = p_code)
      )

    UNION ALL
    -- 2) NOMBRE EXACTO LITERAL (name + alt_names), normalizado
    SELECT ri.id, ri.name, ri.folvy_code, 0.99::numeric, 'name_exact', 2
    FROM recipe_item ri
    WHERE ri.account_id = p_account_id AND ri.is_active = true
      AND ri.type = ANY(p_target_types)
      AND (
        lower(public.unaccent(ri.name)) = lower(public.unaccent(p_text))
        OR EXISTS (SELECT 1 FROM unnest(ri.alt_names) an
                   WHERE lower(public.unaccent(an)) = lower(public.unaccent(p_text)))
      )

    UNION ALL
    -- 3) NOMBRE NORMALIZADO (sin paréntesis/acentos/espacios), name + alt_names
    SELECT ri.id, ri.name, ri.folvy_code, 0.92::numeric, 'name_normalized', 3
    FROM recipe_item ri
    WHERE ri.account_id = p_account_id AND ri.is_active = true
      AND ri.type = ANY(p_target_types)
      AND (
        public.normalize_ingredient_name(ri.name) = v_norm
        OR EXISTS (SELECT 1 FROM unnest(ri.alt_names) an
                   WHERE public.normalize_ingredient_name(an) = v_norm)
      )

    UNION ALL
    -- 4) DIFUSO (similarity trgm), confianza real = similitud
    SELECT ri.id, ri.name, ri.folvy_code,
           ROUND(similarity(public.normalize_ingredient_name(ri.name), v_norm)::numeric, 2),
           'fuzzy', 4
    FROM recipe_item ri
    WHERE ri.account_id = p_account_id AND ri.is_active = true
      AND ri.type = ANY(p_target_types)
      AND public.normalize_ingredient_name(ri.name) % v_norm
      AND similarity(public.normalize_ingredient_name(ri.name), v_norm) >= p_fuzzy_min
  ),
  -- Mejor capa por artículo: prioridad de capa primero, luego confianza
  best AS (
    SELECT DISTINCT ON (c.id)
      c.id, c.name, c.folvy_code, c.conf, c.mt, c.prio
    FROM candidates c
    ORDER BY c.id, c.prio ASC, c.conf DESC
  )
  SELECT
    b.id, b.name, b.folvy_code, b.conf, b.mt,
    -- verde si es match determinista (code/exact/normalized) o fuzzy muy alto
    CASE WHEN b.prio <= 3 OR b.conf >= 0.90 THEN 'green' ELSE 'yellow' END
  FROM best b
  ORDER BY b.prio ASC, b.conf DESC, b.name
  LIMIT p_limit;
END;
$function$;
