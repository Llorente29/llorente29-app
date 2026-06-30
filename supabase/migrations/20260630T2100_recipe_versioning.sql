-- 20260630T2100_recipe_versioning.sql
--
-- Versionado de escandallo (frente de comodidad, 30/06). La tabla
-- recipe_item_version YA EXISTE (esquema temporal version_number + valid_from/to
-- + snapshot jsonb + computed_cost + is_milestone/milestone_label/change_note +
-- created_by/created_by_name) con RLS (select=belongs_to_account,
-- insert/update/delete=current_user_is_admin_or_manager_of). Estaba VACÍA y SIN
-- cablear. Esta migración añade SOLO las dos RPCs que escriben/leen; cero cambio
-- de esquema.
--
-- Modelo: HITO MANUAL + snapshot recuperable (como meez/Apicbase). Se supera con
-- el coste guardado por versión (computed_cost) → el Histórico muestra el impacto
-- ECONÓMICO de cada cambio, no solo qué ingrediente cambió.
--
-- create_recipe_version(item, label, note, is_milestone, created_by_name):
--   foto del estado actual → nueva versión activa; cierra la anterior.
-- restore_recipe_version(version_id, created_by_name):
--   CON RED → 1) versiona el estado actual ("Antes de restaurar"),
--             2) sobrescribe líneas+pasos+enlaces desde el snapshot objetivo,
--             3) recostea, 4) versiona el estado restaurado (queda activo).
--
-- SECURITY DEFINER + guard explícito (igual que duplicate_recipe_item). En SQL
-- Editor auth.uid() es null → el guard hará EXCEPTION a propósito; se prueba
-- desde la app (que tiene sesión). NO ejecutar un SELECT de prueba aquí.

-- ─────────────────────────────────────────────────────────────────────
-- create_recipe_version: snapshot del estado actual del plato → nueva versión.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_recipe_version(
  p_item_id        uuid,
  p_label          text DEFAULT NULL,
  p_note           text DEFAULT NULL,
  p_is_milestone   boolean DEFAULT false,
  p_created_by_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ri        recipe_item%ROWTYPE;
  v_next      integer;
  v_snapshot  jsonb;
  v_new_id    uuid;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'create_recipe_version: falta el id del plato';
  END IF;

  SELECT * INTO v_ri FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_recipe_version: receta % no encontrada', p_item_id;
  END IF;

  -- Guard de escritura (mismo criterio que la RLS de inserción).
  IF NOT public.current_user_is_admin_or_manager_of(v_ri.account_id) THEN
    RAISE EXCEPTION 'Sin permiso para versionar esta receta';
  END IF;

  -- Nº de versión correlativo por plato.
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
  FROM recipe_item_version WHERE recipe_item_id = p_item_id;

  -- Snapshot autosuficiente: líneas (con nombre del ingrediente para diff
  -- legible e histórico fiel) + pasos + enlaces paso↔línea + meta del plato.
  v_snapshot := jsonb_build_object(
    'name', v_ri.name,
    'yield_portions', v_ri.yield_portions,
    'computed_cost', v_ri.computed_cost,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rl.id,
        'child_item_id', rl.child_item_id,
        'child_name', ci.name,
        'quantity_net', rl.quantity_net,
        'quantity_gross', rl.quantity_gross,
        'unit_id', rl.unit_id,
        'cut_type_id', rl.cut_type_id,
        'comment', rl.comment,
        'position', rl.position
      ) ORDER BY rl.position, rl.created_at)
      FROM recipe_line rl
      JOIN recipe_item ci ON ci.id = rl.child_item_id
      WHERE rl.parent_item_id = p_item_id
    ), '[]'::jsonb),
    'steps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'position', s.position,
        'text', s.text,
        'kind', s.kind,
        'duration_min', s.duration_min,
        'temperature_c', s.temperature_c,
        'photo_url', s.photo_url
      ) ORDER BY s.position, s.created_at)
      FROM recipe_item_step s
      WHERE s.recipe_item_id = p_item_id
    ), '[]'::jsonb),
    'step_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('step_id', sl.step_id, 'line_id', sl.line_id))
      FROM recipe_item_step_line sl
      WHERE sl.step_id IN (SELECT id FROM recipe_item_step WHERE recipe_item_id = p_item_id)
    ), '[]'::jsonb)
  );

  -- Cierra la versión activa anterior (la que no tiene valid_to).
  UPDATE recipe_item_version
     SET status = 'superseded', valid_to = now()
   WHERE recipe_item_id = p_item_id
     AND valid_to IS NULL;

  -- Nueva versión activa.
  INSERT INTO recipe_item_version (
    recipe_item_id, version_number, valid_from, valid_to, snapshot,
    computed_cost, status, is_milestone, milestone_label, change_note, created_by_name
  )
  VALUES (
    p_item_id, v_next, now(), NULL, v_snapshot,
    v_ri.computed_cost, 'active', COALESCE(p_is_milestone, false),
    NULLIF(btrim(p_label), ''), NULLIF(btrim(p_note), ''),
    NULLIF(btrim(p_created_by_name), '')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- restore_recipe_version: vuelve el escandallo a una versión, SIN perder nada.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_recipe_version(
  p_version_id     uuid,
  p_created_by_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ver       recipe_item_version%ROWTYPE;
  v_item_id   uuid;
  v_account   uuid;
  v_snap      jsonb;
  v_line      jsonb;
  v_step      jsonb;
  v_sl        jsonb;
  v_new_line  uuid;
  v_new_step  uuid;
  v_line_map  jsonb := '{}'::jsonb;
  v_step_map  jsonb := '{}'::jsonb;
  v_new_active uuid;
BEGIN
  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'restore_recipe_version: falta el id de la versión';
  END IF;

  SELECT * INTO v_ver FROM recipe_item_version WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_recipe_version: versión % no encontrada', p_version_id;
  END IF;

  v_item_id := v_ver.recipe_item_id;
  SELECT account_id INTO v_account FROM recipe_item WHERE id = v_item_id;

  IF NOT public.current_user_is_admin_or_manager_of(v_account) THEN
    RAISE EXCEPTION 'Sin permiso para restaurar esta receta';
  END IF;

  v_snap := v_ver.snapshot;

  -- 1) RED: versiona el estado ACTUAL antes de sobrescribir (no se pierde nada).
  PERFORM public.create_recipe_version(
    v_item_id,
    'Antes de restaurar a v' || v_ver.version_number::text,
    NULL, false, p_created_by_name
  );

  -- 2) Sobrescribe líneas + pasos + enlaces desde el snapshot objetivo.
  --    Orden de borrado: enlaces → pasos → líneas (por las FK).
  DELETE FROM recipe_item_step_line
   WHERE step_id IN (SELECT id FROM recipe_item_step WHERE recipe_item_id = v_item_id);
  DELETE FROM recipe_item_step WHERE recipe_item_id = v_item_id;
  DELETE FROM recipe_line WHERE parent_item_id = v_item_id;

  -- Líneas (mapa id_snapshot → id_nuevo para reconstruir enlaces).
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'lines', '[]'::jsonb))
  LOOP
    INSERT INTO recipe_line (
      account_id, parent_item_id, child_item_id,
      quantity_net, quantity_gross, unit_id, cut_type_id, comment, position
    )
    VALUES (
      v_account, v_item_id,
      (v_line->>'child_item_id')::uuid,
      NULLIF(v_line->>'quantity_net','')::numeric,
      NULLIF(v_line->>'quantity_gross','')::numeric,
      NULLIF(v_line->>'unit_id','')::uuid,
      NULLIF(v_line->>'cut_type_id','')::uuid,
      v_line->>'comment',
      COALESCE(NULLIF(v_line->>'position','')::int, 0)
    )
    RETURNING id INTO v_new_line;
    v_line_map := v_line_map || jsonb_build_object(v_line->>'id', v_new_line::text);
  END LOOP;

  -- Pasos (mapa id_snapshot → id_nuevo).
  FOR v_step IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'steps', '[]'::jsonb))
  LOOP
    INSERT INTO recipe_item_step (
      recipe_item_id, position, text, kind, duration_min, temperature_c, photo_url
    )
    VALUES (
      v_item_id,
      COALESCE(NULLIF(v_step->>'position','')::int, 0),
      v_step->>'text',
      v_step->>'kind',
      NULLIF(v_step->>'duration_min','')::int,
      NULLIF(v_step->>'temperature_c','')::numeric,
      v_step->>'photo_url'
    )
    RETURNING id INTO v_new_step;
    v_step_map := v_step_map || jsonb_build_object(v_step->>'id', v_new_step::text);
  END LOOP;

  -- Enlaces paso↔línea (solo si ambos extremos existen en los mapas).
  FOR v_sl IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'step_lines', '[]'::jsonb))
  LOOP
    IF (v_step_map ? (v_sl->>'step_id')) AND (v_line_map ? (v_sl->>'line_id')) THEN
      INSERT INTO recipe_item_step_line (account_id, step_id, line_id)
      VALUES (
        v_account,
        (v_step_map->>(v_sl->>'step_id'))::uuid,
        (v_line_map->>(v_sl->>'line_id'))::uuid
      );
    END IF;
  END LOOP;

  -- Meta del plato que afecta al coste por ración (no se toca el nombre).
  UPDATE recipe_item
     SET yield_portions = NULLIF(v_snap->>'yield_portions','')::numeric
   WHERE id = v_item_id;

  -- 3) Recostea el plato (cascada).
  PERFORM public.kitchen_recompute_item(v_item_id);

  -- 4) Versiona el estado RESTAURADO → queda como versión activa coherente.
  v_new_active := public.create_recipe_version(
    v_item_id,
    'Restaurada de v' || v_ver.version_number::text,
    v_ver.milestone_label,
    false, p_created_by_name
  );

  RETURN v_new_active;
END;
$function$;

-- Permisos: la app (rol authenticated) puede llamar; el guard interno + RLS
-- hacen cumplir la cuenta.
GRANT EXECUTE ON FUNCTION public.create_recipe_version(uuid, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_recipe_version(uuid, text) TO authenticated;
