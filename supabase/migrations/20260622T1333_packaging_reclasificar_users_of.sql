-- ============================================================================
-- Folvy — Hueco 1 (packaging), TRAMO 3: reclasificar artículo + reordenar en recetas
--
-- kitchen_recompute_users_of(p_item_id): recostea todos los recipe_item que usan
-- p_item_id como hijo en una línea (los platos/recetas "padre"). Necesario al
-- cambiar la NATURALEZA de un artículo (p.ej. raw -> packaging): su coste no
-- cambia, pero el desglose food/packaging de cada plato que lo usa sí, y hay que
-- recalcularlo. Hoy no existía ninguna cascada "este artículo cambió -> recostea
-- sus platos" (el flujo factura->coste recostea por trigger, pero no hay RPC).
--
-- Alcance: UN nivel (padres directos). Es suficiente y exacto para la
-- reclasificación, porque el packaging solo cuenta en líneas DIRECTAS, y el
-- coste total del padre NO cambia al reclasificar (un raw y un packaging se
-- costean igual). Para cascada transitiva de COSTE existe otra vía (front
-- costCascadeService); no se mezcla aquí.
--
-- SECURITY DEFINER con guard de tenancy. Se invoca desde la app (hay sesión),
-- nunca desde el SQL Editor (kitchen_recompute_item, que llama dentro, exige
-- auth.uid()). NO incluir SELECT que la invoque en la migración.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kitchen_recompute_users_of(p_item_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item   recipe_item%ROWTYPE;
  v_parent uuid;
  v_count  integer := 0;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_users_of: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recompute_users_of: sin acceso al item %', p_item_id;
  END IF;

  FOR v_parent IN
    SELECT DISTINCT parent_item_id
    FROM recipe_line
    WHERE child_item_id = p_item_id
  LOOP
    PERFORM public.kitchen_recompute_item(v_parent);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
