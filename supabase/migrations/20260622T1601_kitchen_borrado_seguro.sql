-- ============================================================================
-- Folvy — TRAMO 5 (saneamiento), Pieza 1: borrar/archivar un artículo o receta
-- de forma SEGURA y AUTÓNOMA (sin SQL a mano por parte del cliente).
--
-- Regla (deuda 0, derivada de las FKs entrantes de recipe_item):
--   Un item es BORRABLE físicamente solo si NO tiene ninguna referencia
--   BLOQUEANTE (las FK RESTRICT / NO ACTION). Si la tiene -> se ARCHIVA
--   (is_active=false, archived_at=now) para no romper histórico ni cartas.
--   Las tablas hijas en CASCADE (alérgenos, fotos, conversiones, formatos,
--   stock_level, versiones, pasos, tags, sus propias recipe_line como parent…)
--   se limpian solas al borrar.
--
-- Referencias BLOQUEANTES (motivo -> tabla.columna):
--   en carta            -> menu_item.recipe_item_id            (RESTRICT)
--   usado en un plato    -> recipe_line.child_item_id           (RESTRICT)
--   movimientos de stock -> stock_movement / stock_waste         (RESTRICT)
--   inventarios          -> inventory_count_line.recipe_item_id  (NO ACTION)
--   modificadores        -> modifier_option / modifier_recipe_impact (NO ACTION)
--   facturas proveedor   -> supplier_invoice_line.recipe_item_id (NO ACTION)
--
-- Dos funciones: una para PREGUNTAR (la UI muestra el diálogo correcto antes de
-- actuar) y otra para EJECUTAR (re-evalúa por seguridad y hace delete o archive).
-- SECURITY DEFINER con guard de tenancy. Se invocan desde la app (hay sesión).
-- ============================================================================

-- 1) CHECK: ¿se puede borrar? ¿por qué no? (no modifica nada)
CREATE OR REPLACE FUNCTION public.kitchen_item_delete_check(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item    recipe_item%ROWTYPE;
  v_reasons text[] := ARRAY[]::text[];
  v_n       integer;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_item_delete_check: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_item_delete_check: sin acceso al item %', p_item_id;
  END IF;

  SELECT count(*) INTO v_n FROM menu_item WHERE recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || format('está en %s carta(s)', v_n); END IF;

  SELECT count(DISTINCT parent_item_id) INTO v_n FROM recipe_line WHERE child_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || format('se usa como ingrediente en %s plato(s)', v_n); END IF;

  SELECT count(*) INTO v_n FROM stock_movement WHERE recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || 'tiene movimientos de stock'; END IF;

  SELECT count(*) INTO v_n FROM stock_waste WHERE recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || 'tiene mermas registradas'; END IF;

  SELECT count(*) INTO v_n FROM inventory_count_line WHERE recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || 'aparece en inventarios'; END IF;

  SELECT count(*) INTO v_n FROM modifier_option WHERE recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || 'se usa en modificadores'; END IF;

  SELECT count(*) INTO v_n FROM modifier_recipe_impact WHERE target_recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || 'se usa en modificadores'; END IF;

  SELECT count(*) INTO v_n FROM supplier_invoice_line WHERE recipe_item_id = p_item_id;
  IF v_n > 0 THEN v_reasons := v_reasons || 'está en facturas de proveedor'; END IF;

  RETURN jsonb_build_object(
    'deletable', (array_length(v_reasons, 1) IS NULL),
    'reasons',   to_jsonb(v_reasons),
    'name',      v_item.name,
    'type',      v_item.type
  );
END;
$function$;

-- 2) ACCIÓN: borra si se puede, archiva si no. Re-evalúa dentro (no se fía del
--    check de la UI). Devuelve qué hizo y por qué.
CREATE OR REPLACE FUNCTION public.kitchen_delete_or_archive_item(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item  recipe_item%ROWTYPE;
  v_check jsonb;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_delete_or_archive_item: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_delete_or_archive_item: sin acceso al item %', p_item_id;
  END IF;

  v_check := public.kitchen_item_delete_check(p_item_id);

  IF (v_check->>'deletable')::boolean THEN
    -- Sin referencias bloqueantes: borrado físico. Los CASCADE se encargan del resto.
    DELETE FROM recipe_item WHERE id = p_item_id;
    RETURN jsonb_build_object('action', 'deleted', 'name', v_item.name);
  ELSE
    -- En uso: archivar (reversible, conserva histórico).
    UPDATE recipe_item
       SET is_active = false, archived_at = now()
     WHERE id = p_item_id;
    RETURN jsonb_build_object('action', 'archived', 'name', v_item.name,
                              'reasons', v_check->'reasons');
  END IF;
END;
$function$;
