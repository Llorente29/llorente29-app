create table if not exists public.stock_movement_reanchor_log (
  id                      uuid primary key default gen_random_uuid(),
  batch                   text not null,
  reanchored_at           timestamptz not null default now(),
  seq                     integer,
  inventory_count_id      uuid not null,
  count_code              text,
  count_status            text,
  inventory_count_line_id uuid,
  recipe_item_id          uuid not null,
  location_id             uuid not null,
  cut_at                  timestamptz not null,
  counted_qty             numeric,
  ledger_before_new       numeric,
  old_qty_base            numeric,
  new_qty_base            numeric,
  old_rows                jsonb
);
create index if not exists idx_smrl_batch on public.stock_movement_reanchor_log (batch);
create index if not exists idx_smrl_count on public.stock_movement_reanchor_log (inventory_count_id);
alter table public.stock_movement_reanchor_log enable row level security;

CREATE OR REPLACE FUNCTION public.reanchor_counted_adjustments(p_batch text)
 RETURNS TABLE(lines_processed integer, movements_written integer, movements_removed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r            record;
  v_seq        integer := 0;
  v_written    integer := 0;
  v_removed    integer := 0;
  v_old_rows   jsonb;
  v_old_qty    numeric;
  v_before     numeric;
  v_delta      numeric;
  v_touched    uuid[] := '{}'::uuid[];
  v_locs       uuid[] := '{}'::uuid[];
  i            integer;
BEGIN
  IF p_batch IS NULL OR length(trim(p_batch)) = 0 THEN
    RAISE EXCEPTION 'reanchor_counted_adjustments: hace falta un nombre de lote';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_movement_reanchor_log WHERE batch = p_batch) THEN
    RAISE EXCEPTION 'reanchor_counted_adjustments: el lote % ya existe', p_batch;
  END IF;

  FOR r IN
    SELECT ic.id  AS count_id, ic.code AS count_code, ic.status AS count_status,
           ic.account_id, ic.location_id, ic.is_opening,
           l.id AS line_id, l.recipe_item_id, l.counted_qty,
           COALESCE(l.counted_at, ic.started_at, ic.closed_at, ic.created_at) AS cut_at
      FROM public.inventory_count ic
      JOIN public.inventory_count_line l ON l.inventory_count_id = ic.id
     WHERE ic.status IN ('aprobado', 'en_revision')
       AND l.counted_qty IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.stock_movement sm
                    WHERE sm.source_type = 'inventory_count'
                      AND sm.source_id   = ic.id
                      AND sm.recipe_item_id = l.recipe_item_id)
     ORDER BY COALESCE(l.counted_at, ic.started_at, ic.closed_at, ic.created_at),
              ic.id, l.recipe_item_id
  LOOP
    v_seq := v_seq + 1;

    SELECT COALESCE(jsonb_agg(to_jsonb(sm)), '[]'::jsonb), COALESCE(SUM(sm.qty_base), 0)
      INTO v_old_rows, v_old_qty
      FROM public.stock_movement sm
     WHERE sm.source_type = 'inventory_count'
       AND sm.source_id   = r.count_id
       AND sm.recipe_item_id = r.recipe_item_id;

    DELETE FROM public.stock_movement sm
     WHERE sm.source_type = 'inventory_count'
       AND sm.source_id   = r.count_id
       AND sm.recipe_item_id = r.recipe_item_id;
    v_removed := v_removed + 1;

    v_before := public.theoretical_qty_at(r.recipe_item_id, r.location_id, r.cut_at);
    v_delta  := r.counted_qty - v_before;

    IF abs(v_delta) > 0.0000001 THEN
      INSERT INTO public.stock_movement (
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, cost_provisional, source_type, source_id, occurred_at,
        created_by, created_by_name, notes)
      SELECT r.account_id, r.location_id, r.recipe_item_id,
             COALESCE(o->>'movement_type', CASE WHEN r.is_opening THEN 'apertura' ELSE 'ajuste' END),
             v_delta,
             NULLIF(o->>'unit_cost','')::numeric,
             false, 'inventory_count', r.count_id, r.cut_at,
             NULLIF(o->>'created_by','')::uuid,
             o->>'created_by_name',
             COALESCE(o->>'notes', 'Ajuste por conteo de inventario')
        FROM jsonb_array_elements(v_old_rows) o
       LIMIT 1;
      v_written := v_written + 1;
      v_removed := v_removed - 1;
    END IF;

    INSERT INTO public.stock_movement_reanchor_log (
      batch, seq, inventory_count_id, count_code, count_status,
      inventory_count_line_id, recipe_item_id, location_id, cut_at,
      counted_qty, ledger_before_new, old_qty_base, new_qty_base, old_rows)
    VALUES (
      p_batch, v_seq, r.count_id, r.count_code, r.count_status,
      r.line_id, r.recipe_item_id, r.location_id, r.cut_at,
      r.counted_qty, v_before, v_old_qty,
      CASE WHEN abs(v_delta) > 0.0000001 THEN v_delta ELSE 0 END, v_old_rows);

    v_touched := v_touched || r.recipe_item_id;
    v_locs    := v_locs    || r.location_id;
  END LOOP;

  IF array_length(v_touched, 1) IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_touched, 1) LOOP
      PERFORM public.recompute_location_stock_core(v_touched[i], v_locs[i]);
    END LOOP;
  END IF;

  lines_processed   := v_seq;
  movements_written := v_written;
  movements_removed := v_removed;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.reanchor_counted_adjustments(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reanchor_counted_adjustments(text) FROM anon, authenticated;

notify pgrst, 'reload schema';