-- 20260825_reanclaje_ejecutado.sql
-- REGISTRO de lo EJECUTADO el 25-08-2026 tras autorización de Julio.
-- Objetivo: cancelar el doble descuento que dejó A3, reanclando cada conteo
-- ya asentado contra el ledger nuevo. Criterio acordado: solo las 1.512 líneas
-- CON asiento; las 406 sin asiento no se tocan (no anclarlas fue una decisión
-- de negocio, no un error de cálculo).

-- ── PASO 1 · Reanclaje ───────────────────────────────────────────────────
select * from public.reanchor_counted_adjustments('20260825_reanclaje');
--   lines_processed 1515 · movements_written 1479 · movements_removed 36
--   (83 conteos: 82 aprobados + INV-00181 en revisión)
--
-- PRUEBA ÁCIDA: para las 1.515 líneas, el ledger justo después del corte es
-- exactamente lo contado. 0 fallos.

-- ── PASO 2 · Dato corrupto encontrado y revertido ────────────────────────
-- INV-00002 (apertura, 15-06, semana de pruebas) tiene counted_qty =
-- 5.000.000.000.000.000 en Mozzarella rallada: un tecleo, no un físico. El
-- reanclaje lo ancló fielmente y metió 5e15 en el ledger. Revertido SOLO esa
-- línea a su asiento previo (+6.000) desde la bitácora, conservando su
-- created_at original del 15-06.
--
-- delete from stock_movement
--  where source_type='inventory_count'
--    and source_id     = '60ee5ee9-c00d-4640-9cfb-40475833bc3f'
--    and recipe_item_id= '61953c3c-39e3-4179-a9ba-aa15fe13dba3';
-- insert into stock_movement
--   select * from jsonb_populate_recordset(null::public.stock_movement,
--     (select old_rows from public.stock_movement_reanchor_log
--       where id='a9794c70-b991-46e5-b8a1-94a47ac63290'));
-- update public.stock_movement_reanchor_log
--    set batch='20260825_reanclaje_REVERTIDO_dato_corrupto'
--  where id='a9794c70-b991-46e5-b8a1-94a47ac63290';
--
-- Suma de ajustes de conteo: 5.599.310,86 → 5.618.002,99 (sana).
-- OJO, pendiente de decidir: INV-00129 tiene counted_qty = 7.200.000 en Salsa
-- Mayo Chipotle (7,2 toneladas). Es anterior a esta operación — no lo he
-- tocado — pero es el mismo tipo de dato imposible.

-- ── PASO 3 · A5 rehecho sobre el ledger reanclado ────────────────────────
-- 1.130 líneas en 84 conteos (sin INV-00004).
--   merma informada −7.930,04 € → −6.591,26 €
-- Bitácora: inventory_count_line_rebase_log, batch '20260825_post_reanclaje'.
-- Verificación: 0 líneas cuyo teórico difiera del ledger en su corte.

-- ── VERIFICACIÓN FINAL ───────────────────────────────────────────────────
-- Pan Hamburguesa, INV-00181 (Alcalá):
--   con el bug           teórico 140 · contado 120 · −20
--   teórico del ledger   teórico 137 · contado 120 · −17
--   tras A3 (doble)      teórico  87 · contado 120 · +33
--   tras el reanclaje    teórico 137 · contado 120 · −17   ← correcto
-- T3 (caché desalineada) 0 · T8 (informe ≠ asiento) 0

-- ── MARCHA ATRÁS COMPLETA ────────────────────────────────────────────────
-- Reanclaje: stock_movement_reanchor_log, batch '20260825_reanclaje'.
--   delete from stock_movement sm using stock_movement_reanchor_log g
--    where g.batch='20260825_reanclaje' and sm.source_type='inventory_count'
--      and sm.source_id=g.inventory_count_id and sm.recipe_item_id=g.recipe_item_id;
--   insert into stock_movement select * from jsonb_populate_recordset(
--     null::public.stock_movement,
--     (select jsonb_agg(x) from stock_movement_reanchor_log g,
--             jsonb_array_elements(g.old_rows) x where g.batch='20260825_reanclaje'));
-- Informe: inventory_count_line_rebase_log, batch '20260825_post_reanclaje'
--   (mismo UPDATE de vuelta que el documentado en 20260825_A1_A2_A3_A5_ejecutado.sql).

-- ── Tablas de trabajo que quedan como evidencia ─────────────────────────
--   public._a2_cache_antes (716) · public._a1_anuladas (9)
--   public._a3_cola (641)        · public._a3_antes (641)
-- Borrables cuando des el visto bueno.
