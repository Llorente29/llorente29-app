-- scripts/conta/produccion/cuentas/e02-lectura-caida.sql
--
-- E02 · La lectura caída (0600) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0600 añade columnas que nacen vacías, una tabla, funciones y un cron; no escribe ninguna
-- fila que exista. Se mide que las llegadas y las sesiones de lectura siguen igual. Cifras de la
-- TABLA ENTERA, a propósito (regla 9, excepción: la huella de «esto no se ha movido»).
-- Corte fijo (el #241): solo lo creado antes del 18/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  -- corte: llegadas creadas antes del 18/11 a las 00:00
  select 1 o, 'tabla entera · document_inbox ' || status clave, count(*)::text valor
    from public.document_inbox where created_at < timestamptz '2026-11-18 00:00:00+01' group by status
  union all
  -- corte: sesiones de lectura creadas antes del 18/11 a las 00:00
  select 2, 'tabla entera · goods_receipt_ai_session ' || status, count(*)::text
    from public.goods_receipt_ai_session where created_at < timestamptz '2026-11-18 00:00:00+01' group by status
) t order by o, clave;
