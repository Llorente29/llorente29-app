-- 20260801T1300_inventory_count_line_counted_at_y_apply_por_linea.sql
-- Aplicada: 2026-08-01 (a mano por SQL Editor; DB ya en este estado, este
--   fichero es registro, no ejecución).
--
-- Objetivo (C2 — foto por línea): el teórico de cada línea deja de anclarse al
--   instante GLOBAL de cierre del conteo (started_at/closed_at/created_at) y
--   pasa a anclarse al instante en que se contó ESA línea (counted_at). Evita
--   la merma fantasma en conteos largos: ventas/recepciones ocurridas DURANTE
--   el conteo, después de contar una línea pero antes de cerrar, ya no se le
--   imputan a esa línea. Fallback a v_instant (comportamiento anterior) para
--   líneas/conteos sin counted_at (autoinventario, históricos).
--
-- Piezas:
--   1) inventory_count_line.counted_at (sello por línea; counted_by/
--      counted_by_name YA EXISTÍAN, no se tocan aquí).
--   2) CREATE OR REPLACE de apply_inventory_count: usa
--      COALESCE(l.counted_at, v_instant) tanto para el corte del ledger
--      (ledger_before) como para el occurred_at del movimiento generado
--      (line_instant), en vez del v_instant único de antes.

-- 1) Columna de sello por línea.
alter table inventory_count_line
  add column if not exists counted_at timestamptz;

-- 2) Función completa, copiada literal desde la BBDD viva
--    (select pg_get_functiondef('apply_inventory_count'::regproc)).
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_partial boolean DEFAULT false)
 RETURNS TABLE(adjustments integer, items_recomputed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_status text;
  v_is_opening boolean;
  v_instant timestamptz;
  v_missing integer;
  v_adj integer := 0;
  v_rec integer := 0;
  v_mtype text;
  v_note text;
  v_delta numeric;
  r RECORD;
BEGIN
  -- H8: FOR UPDATE serializa aprobaciones concurrentes del MISMO conteo.
  SELECT account_id, location_id, status, is_opening,
         COALESCE(started_at, closed_at, created_at, now())
    INTO v_account_id, v_location_id, v_status, v_is_opening, v_instant
    FROM public.inventory_count WHERE id = p_count_id
    FOR UPDATE;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'apply_inventory_count: conteo % no existe', p_count_id;
  END IF;

  -- H7: el llamante debe pertenecer a la cuenta del conteo.
  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'apply_inventory_count: sin acceso a la cuenta %', v_account_id;
  END IF;

  IF v_status = 'aprobado' THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  IF v_status <> 'en_revision' THEN
    RAISE EXCEPTION 'apply_inventory_count: el conteo debe estar en revisión (está en %)', v_status;
  END IF;

  SELECT COUNT(*) INTO v_missing
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND within_tolerance = false
      AND (reason_code IS NULL OR reason_code = '');

  -- Modo normal (manual del gestor): exige todo resuelto antes de aprobar.
  -- Modo parcial (autoinventario): NO aborta; aplica lo resuelto y deja las
  -- anomalías pendientes para el gestor (el conteo no se da por aprobado).
  IF NOT v_is_opening AND NOT p_partial AND v_missing > 0 THEN
    RAISE EXCEPTION 'apply_inventory_count: % línea(s) fuera de tolerancia sin motivo. Asigna un motivo antes de aprobar.', v_missing;
  END IF;

  IF v_is_opening THEN
    v_mtype := 'apertura';
    v_note  := 'Inventario de apertura (stock inicial)';
  ELSE
    v_mtype := 'ajuste';
    v_note  := 'Ajuste por conteo de inventario';
  END IF;

  -- Idempotencia: elimina cualquier asiento previo generado por ESTE conteo.
  DELETE FROM public.stock_movement
    WHERE source_type = 'inventory_count'
      AND source_id   = p_count_id;

  FOR r IN
    SELECT l.recipe_item_id,
           l.counted_qty,
           -- FOTO POR LÍNEA: el teórico se ancla al instante en que se contó
           -- ESA línea (counted_at). Fallback al instante global del conteo para
           -- líneas/conteos sin counted_at (autoinventario, históricos) → idéntico
           -- al comportamiento anterior. Neutraliza ventas/recepciones ocurridas
           -- DURANTE un conteo largo (evita la merma fantasma).
           COALESCE(l.counted_at, v_instant) AS line_instant,
           COALESCE((
             SELECT SUM(sm.qty_base)
               FROM public.stock_movement sm
              WHERE sm.recipe_item_id = l.recipe_item_id
                AND sm.location_id    = v_location_id
                AND sm.occurred_at    < COALESCE(l.counted_at, v_instant)
           ), 0) AS ledger_before,
           COALESCE(ril.avg_unit_cost, 0) AS unit_cost
      FROM public.inventory_count_line l
      LEFT JOIN public.recipe_item_location_stock ril
        ON ril.recipe_item_id = l.recipe_item_id
       AND ril.location_id = v_location_id
       AND ril.account_id  = v_account_id
     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL
       AND (
         NOT p_partial
         OR l.within_tolerance = true
         OR (l.reason_code IS NOT NULL AND l.reason_code <> '')
       )
     ORDER BY l.recipe_item_id   -- H9: orden determinista, anti-deadlock
  LOOP
    v_delta := r.counted_qty - r.ledger_before;
    IF abs(v_delta) > 0.0000001 THEN
      INSERT INTO public.stock_movement (
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, cost_provisional, source_type, source_id, occurred_at,
        created_by, created_by_name, notes
      ) VALUES (
        v_account_id, v_location_id, r.recipe_item_id, v_mtype, v_delta,
        r.unit_cost, false, 'inventory_count', p_count_id, r.line_instant,
        p_user_id, p_user_name, v_note
      );
      v_adj := v_adj + 1;
    END IF;
    PERFORM public.recompute_location_stock(r.recipe_item_id, v_location_id);
    v_rec := v_rec + 1;
  END LOOP;

  -- Estado final: aprobado solo si NO quedan anomalías pendientes; si en modo
  -- parcial aún quedan, se mantiene en revisión para el gestor.
  IF v_missing > 0 AND p_partial THEN
    UPDATE public.inventory_count
      SET updated_at = now()
      WHERE id = p_count_id;   -- sigue en_revision
  ELSE
    UPDATE public.inventory_count
      SET status = 'aprobado',
          approved_at = now(),
          approved_by = p_user_id,
          approved_by_name = p_user_name,
          updated_at = now()
      WHERE id = p_count_id;
  END IF;

  RETURN QUERY SELECT v_adj, v_rec;
END;
$function$;
