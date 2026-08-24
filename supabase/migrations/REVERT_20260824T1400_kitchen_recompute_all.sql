-- REVERT de 20260824T1400_kitchen_recompute_all.sql
--
-- Quita el cron, borra las tres funciones nuevas y devuelve
-- kitchen_recompute_item a su cuerpo EXACTO anterior (guarda + fórmula en la
-- misma función), copiado de pg_get_functiondef antes de tocar nada.

begin;

select cron.unschedule('kitchen-recompute-nightly')
 where exists (select 1 from cron.job where jobname = 'kitchen-recompute-nightly');

drop function if exists public.cron_kitchen_recompute_all();
drop function if exists public.kitchen_recompute_all(uuid, int, int);

create or replace function public.kitchen_recompute_item(p_item_id uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_item            recipe_item%ROWTYPE;
  v_line            recipe_line%ROWTYPE;
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_qty             numeric;
  v_qty_in_base     numeric;
  v_child_cost      numeric;
  v_conv            numeric;
  v_line_cost       numeric;
  v_total           numeric := 0;
  v_packaging       numeric := 0;
  v_incomplete      boolean := false;
  v_yield           numeric := NULL;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_item: item % no existe', p_item_id;
  END IF;
  IF NOT public.belongs_to_account(v_item.account_id) THEN
    RAISE EXCEPTION 'kitchen_recompute_item: sin acceso al item %', p_item_id;
  END IF;
  IF v_item.type IN ('raw', 'tool', 'packaging') THEN
    RETURN public.kitchen_recompute_raw_cost(p_item_id);
  END IF;
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    IF v_line_unit.dimension = v_child_base_unit.dimension THEN
      v_qty_in_base := v_qty * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
    ELSE
      SELECT qty_in_base INTO v_conv
        FROM recipe_item_unit_conversion
        WHERE item_id = v_child.id AND from_unit_id = v_line.unit_id
        LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_qty_in_base := v_qty * v_conv;
      ELSE
        v_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;
    v_line_cost := v_child_cost * v_qty_in_base;
    v_total := v_total + v_line_cost;
    IF v_child.type = 'packaging' THEN
      v_packaging := v_packaging + v_line_cost;
    END IF;
  END LOOP;

  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
    IF v_yield IS NOT NULL AND v_yield > 0 THEN
      v_total     := v_total / v_yield;
      v_packaging := v_packaging / v_yield;
    END IF;
  END IF;

  UPDATE recipe_item
    SET computed_cost   = v_total,
        packaging_cost  = v_packaging,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END,
        completeness    = COALESCE(completeness, '{}'::jsonb)
                          || jsonb_build_object(
                               'cost_incomplete', v_incomplete,
                               'cost_incomplete_reason',
                                 CASE WHEN v_incomplete THEN 'unmeasurable_line' ELSE NULL END)
    WHERE id = p_item_id;
  RETURN v_total;
END;
$function$;

drop function if exists public._kitchen_recompute_item_unguarded(uuid);

commit;
