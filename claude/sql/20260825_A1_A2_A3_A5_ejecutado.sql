-- 20260825_A1_A2_A3_A5_ejecutado.sql
-- REGISTRO de lo EJECUTADO en producción el 25-08-2026, en el orden autorizado
-- por Julio: A2 → A1 → A3 → A5. A4 (recepciones duplicadas) queda fuera.
-- Este fichero es el rastro de lo que se hizo, no un script para re-ejecutar.

-- ════════════════════════════════════════════════════════════════════════
-- A2 · RESYNC DE LA CACHÉ DE STOCK CONTRA EL LEDGER
-- Antes: 716 filas, 144 desalineadas, 58 con coste medio negativo, 40.684,21 € de valor
-- Después: 716 filas,   0 desalineadas, 52 con coste medio negativo, 41.212,40 € de valor
-- ════════════════════════════════════════════════════════════════════════
-- create table public._a2_cache_antes as
--   select recipe_item_id, location_id, qty_on_hand, avg_unit_cost, stock_value, updated_at
--     from public.recipe_item_location_stock;      -- snapshot conservado
do $$
declare r record;
begin
  for r in select recipe_item_id, location_id from public.recipe_item_location_stock loop
    perform public.recompute_location_stock_core(r.recipe_item_id, r.location_id);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- A1 · DEVOLVER EL STOCK DE LAS VENTAS ANULADAS
-- 9 ventas con 95 movimientos de consumo vivos → 0.
-- Se hace con el propio motor ya corregido (D2): al ver la venta anulada borra
-- su consumo y refresca la caché. Mismo camino que usará en adelante.
-- ════════════════════════════════════════════════════════════════════════
-- create table public._a1_anuladas as select distinct s.id as sale_id ... ;
do $$
declare r record;
begin
  for r in select sale_id from public._a1_anuladas loop
    perform public.generate_sale_consumption(r.sale_id);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- A3 · REPROCESAR EL CONSUMO DE LAS VENTAS CON CABECERA DE COMBO SIN MAPEAR
-- 641 ventas. Movimientos de consumo: 392 → 6.340 (+5.948).
-- 397 ventas pasaron de no descontar nada a descontar. Coste total −1.798,25 €.
-- 4 ventas BAJARON (2 a cero): su producto ya no tiene escandallo explotable
-- hoy, así que el reproceso las deja en lo que dice el catálogo actual.
--
-- ⚠️ CONSECUENCIA DETECTADA DESPUÉS (ver informe §9): 6.108 de los 6.340
-- movimientos quedan FECHADOS ANTES del último conteo aprobado de su local
-- (1.882,72 €). Ese tramo ya lo había absorbido el ajuste de aquel conteo, así
-- que ahora se descuenta dos veces y el teórico se va por debajo de lo real.
-- Pendiente de decisión de Julio.
-- ════════════════════════════════════════════════════════════════════════
-- create table public._a3_cola as select distinct s.id as sale_id, ... , false as hecho ...;
-- create table public._a3_antes as select ... count(sm.id) as movs ... ;  -- foto previa
do $$
declare r record;
begin
  for r in select sale_id from public._a3_cola where not hecho order by sold_at loop
    perform public.generate_sale_consumption(r.sale_id);
    update public._a3_cola set hecho = true where sale_id = r.sale_id;
  end loop;
end $$;   -- ejecutado por lotes de 150/250/250 para no agotar el tiempo de sentencia

-- ════════════════════════════════════════════════════════════════════════
-- A5 · BACKFILL DEL INFORME DE VARIANCE (después de A3, como toca)
-- 1.604 líneas en 97 conteos. Excluida INV-00004 (línea de pruebas con
-- system_qty = 5e15): 1.591 líneas / 96 conteos.
--   merma informada  −10.116,87 € → −10.564,09 €   (delta −447,22 €)
--   128 líneas dejan de ser anomalía · 210 pasan a serlo
-- Verificación: 0 líneas cuyo teórico difiera del ledger en su counted_at.
-- Bitácora completa y reversible en inventory_count_line_rebase_log,
-- batch '20260825_system_qty_desde_ledger'.
--
-- Nota: se ejecutó con tabla de trabajo permanente (_a5_rebase_calc, ya
-- borrada) en vez de la TEMPORARY del fichero 20260825T1100, porque cada
-- llamada al SQL Editor/MCP es su propia transacción y una temp table no
-- sobrevive entre pasos. La lógica es idéntica.
-- ════════════════════════════════════════════════════════════════════════

-- ── MARCHA ATRÁS de A5 (no ejecutar salvo que haga falta) ────────────────
-- begin;
-- update public.inventory_count_line l
--    set system_qty       = g.old_system_qty,
--        variance_qty     = g.old_variance_qty,
--        variance_pct     = g.old_variance_pct,
--        variance_value   = g.old_variance_value,
--        within_tolerance = g.old_within_tolerance
--   from public.inventory_count_line_rebase_log g
--  where g.line_id = l.id and g.batch = '20260825_system_qty_desde_ledger';
-- commit;

-- ── MARCHA ATRÁS de A2 (no ejecutar; la tabla es derivada, basta recomputar) ──
-- update public.recipe_item_location_stock r
--    set qty_on_hand = a.qty_on_hand, avg_unit_cost = a.avg_unit_cost,
--        stock_value = a.stock_value, updated_at = a.updated_at
--   from public._a2_cache_antes a
--  where a.recipe_item_id = r.recipe_item_id and a.location_id = r.location_id;

-- ── A3 NO ES REVERSIBLE FILA A FILA ─────────────────────────────────────
-- generate_sale_consumption borra y reescribe TODO el consumo de la venta, así
-- que las filas previas ya no existen. _a3_antes guarda el recuento y la suma
-- de qty por venta (392 movimientos), suficiente para auditar la magnitud pero
-- no para restaurar. Si hay que deshacerlo, el camino es re-anclar el ledger
-- con los conteos aprobados, no resucitar filas.

-- ── Tablas de trabajo conservadas como evidencia (borrar tras decidir sobre A3) ──
--   public._a2_cache_antes (716)  ·  public._a1_anuladas (9)
--   public._a3_cola (641)         ·  public._a3_antes (641)
