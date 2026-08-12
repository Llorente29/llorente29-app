-- 20260812T1720_indice_movimientos_por_local_y_fecha.sql
-- Aplicada: 2026-08-12 por SQL (fuera de transaccion: CONCURRENTLY no admite
-- bloque transaccional). Verificado: pg_index.indisvalid = true.
--
-- INTENTO 2 de 4. ESTE SI SIRVIO, y se queda.
--
-- CAUSA MEDIDA: el escaneo base de stock_movement tardaba 370 ms para devolver
-- 25 filas. Usaba idx_sm_item_loc_time, que empieza por recipe_item_id: pensado
-- para "el historico de UN articulo". La pantalla de Movimientos pide "TODO lo
-- de un local en un rango", sin articulo, asi que ese indice no discrimina.
--
-- RESULTADO MEDIDO: escaneo base 370 ms -> 25 ms.
--
-- movement_type se deja FUERA del indice a proposito: es poco selectivo (casi
-- todo es 'consumo') y solo engordaria el indice.
--
-- CONCURRENTLY: la tabla esta caliente (26.425+ filas, se escribe en cada
-- venta). No bloquea escrituras.
--
-- NO reejecutar contra produccion: ya esta aplicada.

create index concurrently if not exists idx_sm_account_loc_time
  on public.stock_movement (account_id, location_id, occurred_at desc);
