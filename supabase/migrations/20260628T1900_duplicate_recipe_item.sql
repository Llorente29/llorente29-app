-- 20260628T1900_duplicate_recipe_item.sql
-- Aplicada: 2026-06-28
--
-- duplicate_recipe_item(p_source_id, p_new_name) — duplica un escandallo COMPLETO
-- en una sola transacción atómica (todo o nada): el plato + todas sus líneas +
-- todos sus pasos + el enlace paso↔línea. Devuelve el id del plato nuevo.
--
-- Caso de uso (Julio): hay platos que se diferencian en 1-2 ingredientes (la misma
-- milanesa con distinto queso, la misma birria con distinta proteína). Duplicar y
-- cambiar un par de líneas ahorra montar el escandallo de cero.
--
-- Por qué RPC y no copiar en el cliente: copiar plato + N líneas + M pasos con N+M
-- llamadas desde el navegador deja basura a medias si una falla. Aquí es atómico.
--
-- Detalles:
--   · El plato copia nace needs_review=true (hay que revisarlo), source='manual',
--     SIN folvy_code (el trigger trg_recipe_item_folvy_code le asigna uno nuevo).
--   · Las líneas se copian tal cual (cantidades, unidad, corte, comentario, orden).
--   · Los pasos se copian con su contenido; el enlace paso↔línea se RECONSTRUYE
--     contra las líneas NUEVAS (mapa id_viejo→id_nuevo), no contra las del original.
--   · NO copia menu_item (la copia no se vende en ninguna marca hasta que se quiera).
--   · NO copia modifier impacts (se decide aparte si esa receta los necesita).

BEGIN;

CREATE OR REPLACE FUNCTION public.duplicate_recipe_item(
  p_source_id uuid,
  p_new_name  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src        recipe_item%ROWTYPE;
  v_new_id     uuid;
  v_new_name   text;
  v_line       record;
  v_step       record;
  v_new_line   uuid;
  v_new_step   uuid;
  -- mapas id_viejo → id_nuevo para reconstruir el enlace paso↔línea
  v_line_map   jsonb := '{}'::jsonb;
  v_step_map   jsonb := '{}'::jsonb;
BEGIN
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'duplicate_recipe_item: falta el id de origen';
  END IF;

  SELECT * INTO v_src FROM recipe_item WHERE id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'duplicate_recipe_item: receta % no encontrada', p_source_id;
  END IF;

  -- Guard de cuenta: el llamante debe pertenecer a la cuenta del plato origen.
  -- Usa el helper canónico del proyecto (belongs_to_account), igual que el resto
  -- del sistema. (En SQL Editor auth.uid() es null → fallará a propósito; se
  -- prueba desde la app, que sí tiene sesión.)
  IF NOT public.belongs_to_account(v_src.account_id) THEN
    RAISE EXCEPTION 'Sin permiso sobre la cuenta de esta receta';
  END IF;

  v_new_name := COALESCE(NULLIF(btrim(p_new_name), ''), v_src.name || ' (copia)');

  -- ── 1) El PLATO copia (sin folvy_code: lo pone el trigger; needs_review=true) ──
  INSERT INTO recipe_item (
    account_id, type, name, base_unit_id, cost_strategy, fixed_cost,
    created_by_name, yield_portions, source, ai_confidence, needs_review, is_stockable
  )
  VALUES (
    v_src.account_id, v_src.type, v_new_name, v_src.base_unit_id, v_src.cost_strategy,
    v_src.fixed_cost, COALESCE(v_src.created_by_name, 'Duplicado'),
    v_src.yield_portions, 'manual', NULL, true, v_src.is_stockable
  )
  RETURNING id INTO v_new_id;

  -- ── 2) Las LÍNEAS (mapeando id viejo→nuevo para los pasos) ──
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_source_id
    ORDER BY position ASC, created_at ASC
  LOOP
    INSERT INTO recipe_line (
      account_id, parent_item_id, child_item_id,
      quantity_net, quantity_gross, unit_id, cut_type_id, comment, position
    )
    VALUES (
      v_src.account_id, v_new_id, v_line.child_item_id,
      v_line.quantity_net, v_line.quantity_gross, v_line.unit_id,
      v_line.cut_type_id, v_line.comment, v_line.position
    )
    RETURNING id INTO v_new_line;
    v_line_map := v_line_map || jsonb_build_object(v_line.id::text, v_new_line::text);
  END LOOP;

  -- ── 3) Los PASOS (contenido), mapeando id viejo→nuevo ──
  FOR v_step IN
    SELECT * FROM recipe_item_step WHERE recipe_item_id = p_source_id
    ORDER BY position ASC, created_at ASC
  LOOP
    INSERT INTO recipe_item_step (
      recipe_item_id, position, text, kind, duration_min, temperature_c, photo_url
    )
    VALUES (
      v_new_id, v_step.position, v_step.text, v_step.kind,
      v_step.duration_min, v_step.temperature_c, v_step.photo_url
    )
    RETURNING id INTO v_new_step;
    v_step_map := v_step_map || jsonb_build_object(v_step.id::text, v_new_step::text);
  END LOOP;

  -- ── 4) El ENLACE paso↔línea, reconstruido contra los ids NUEVOS ──
  --     Solo se copia el enlace si AMBOS (paso y línea) existen en los mapas.
  INSERT INTO recipe_item_step_line (account_id, step_id, line_id)
  SELECT
    v_src.account_id,
    (v_step_map->>sl.step_id::text)::uuid,
    (v_line_map->>sl.line_id::text)::uuid
  FROM recipe_item_step_line sl
  WHERE sl.step_id IN (SELECT id FROM recipe_item_step WHERE recipe_item_id = p_source_id)
    AND v_step_map ? sl.step_id::text
    AND v_line_map ? sl.line_id::text;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.duplicate_recipe_item(uuid, text) TO authenticated;

COMMIT;
