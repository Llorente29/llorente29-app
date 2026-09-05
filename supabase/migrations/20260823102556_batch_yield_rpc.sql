CREATE OR REPLACE FUNCTION public.kitchen_batch_yield(p_item_id uuid)
 RETURNS TABLE(yield_in_base numeric, base_unit_id uuid, is_declared boolean, unmeasured_lines integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_base kitchen_unit%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_batch_yield: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_batch_yield: sin acceso al item %', p_item_id;
  END IF;

  SELECT * INTO v_base FROM kitchen_unit WHERE id = v_item.base_unit_id;

  yield_in_base := public._batch_yield_in_base(p_item_id);
  base_unit_id  := v_item.base_unit_id;
  is_declared   := (v_item.batch_yield IS NOT NULL AND v_item.batch_yield > 0);

  SELECT COUNT(*) INTO unmeasured_lines
  FROM recipe_line rl
  JOIN kitchen_unit lu ON lu.id = rl.unit_id
  WHERE rl.parent_item_id = p_item_id
    AND (v_base.id IS NULL OR lu.dimension <> v_base.dimension);

  RETURN NEXT;
END;
$function$;