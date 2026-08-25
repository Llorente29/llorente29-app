-- 20260825T1800_reanclar_conteos_aprobados.sql
-- FUNCIÓN CREADA, **NO EJECUTADA**. La ejecución la autoriza Julio.
--
-- POR QUÉ
-- A3 metió en el ledger el consumo de combos que faltaba, con la fecha real de
-- cada venta. 6.108 de esos 6.340 movimientos quedaron fechados ANTES del
-- último conteo aprobado de su local. El ajuste de aquel conteo ya había
-- absorbido ese consumo (un conteo fuerza el ledger a igualar el físico), así
-- que ahora el mismo producto sale dos veces.
--
-- QUÉ HACE
-- Recalcula el ajuste de cada línea ya asentada contra el ledger NUEVO, en
-- orden cronológico de corte. Como cada conteo vuelve a dejar el ledger igual
-- al físico contado en su instante, el doble descuento se cancela solo.
--
-- ALCANCE (medido el 25-08)
--   · 82 conteos 'aprobado' con ajuste en el ledger → 1.512 líneas
--   · 1 conteo 'en_revision' con ajuste parcial (INV-00181) → 3 líneas
--   · 16 conteos 'aprobado' SIN ajuste: no tocan el ledger, nada que reanclar
--   · 69 'anulado' y 2 'contando': 0 movimientos, no se tocan
--
-- QUÉ **NO** TOCA
--   · Las 406 líneas contadas que el conteo NUNCA ajustó (el autocierre parcial
--     las dejó pendientes de motivo). Si un conteo no las ancló, no hay nada que
--     "ya estuviera absorbido": el consumo nuevo es información nueva, no doble.
--     Reanclarlas sería revocar una decisión de negocio, no reparar un cálculo.
--   · El estado del conteo, approved_at, approved_by ni counted_qty. Solo el
--     importe del asiento.
--
-- REVERSIBLE: cada movimiento borrado se guarda ENTERO (fila jsonb) en
-- stock_movement_reanchor_log. La marcha atrás está al final del fichero.

-- ── Bitácora ──────────────────────────────────────────────────────────────
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
  old_rows                jsonb        -- filas originales completas, para restaurar
);
create index if not exists idx_smrl_batch on public.stock_movement_reanchor_log (batch);
create index if not exists idx_smrl_count on public.stock_movement_reanchor_log (inventory_count_id);
alter table public.stock_movement_reanchor_log enable row level security;

-- ── El re-anclaje ─────────────────────────────────────────────────────────
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
    -- Solo líneas que YA tienen asiento de su conteo. Orden cronológico por el
    -- corte de cada línea: cada asiento que se reescribe cambia el ledger que
    -- verán los cortes posteriores, así que el orden no es decorativo.
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

    -- 1) Guardar y retirar el asiento viejo de ESTA línea.
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

    -- 2) Ledger nuevo justo antes del corte (mismo criterio estricto que apply).
    v_before := public.theoretical_qty_at(r.recipe_item_id, r.location_id, r.cut_at);
    v_delta  := r.counted_qty - v_before;

    -- 3) Reasentar si hace falta. Metadatos: los del asiento viejo, para no
    --    perder quién y por qué; solo cambia el importe.
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

  -- 4) Refrescar la caché de todo lo tocado.
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

-- ── EJECUCIÓN (pendiente de autorización) ────────────────────────────────
--   select * from public.reanchor_counted_adjustments('20260825_reanclaje');
-- Después hay que rehacer el informe de variance (A5), porque el teórico de
-- cada línea cambia al cambiar los asientos anteriores.

-- ── MARCHA ATRÁS ─────────────────────────────────────────────────────────
-- begin;
-- delete from public.stock_movement sm
--  using public.stock_movement_reanchor_log g
--  where g.batch = '20260825_reanclaje'
--    and sm.source_type = 'inventory_count'
--    and sm.source_id = g.inventory_count_id
--    and sm.recipe_item_id = g.recipe_item_id;
-- insert into public.stock_movement
--   select * from jsonb_populate_recordset(null::public.stock_movement,
--            (select jsonb_agg(x) from public.stock_movement_reanchor_log g,
--                    jsonb_array_elements(g.old_rows) x
--              where g.batch = '20260825_reanclaje'));
-- -- y recomputar la caché de los artículos afectados
-- commit;
