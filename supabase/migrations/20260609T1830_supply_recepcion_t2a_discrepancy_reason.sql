-- 20260609T1830_supply_recepcion_t2a_discrepancy_reason.sql
-- Aplicada:
--
-- TRAMO 2a del frente "Recepción usable y fiable" (espejo del albarán).
-- Motivo del descuadre por línea: cuando lo recibido NO coincide con el albarán,
-- al confirmar se pide el motivo (faltó / llegó de más / roto / caducidad corta /
-- hablado con el proveedor / otro) y queda registrado aquí. Null si la línea cuadra.
--
-- (doc_qty / doc_amount ya existen del Tramo 1.)
-- DDL idempotente, sin BEGIN/COMMIT (regla SQL Editor).

ALTER TABLE public.goods_receipt_line
  ADD COLUMN IF NOT EXISTS discrepancy_reason text;

COMMENT ON COLUMN public.goods_receipt_line.discrepancy_reason IS 'Motivo del descuadre recibido↔albarán al confirmar (falto/llego_de_mas/roto/caducidad_corta/hablado_proveedor/otro). Null si la línea cuadra.';
