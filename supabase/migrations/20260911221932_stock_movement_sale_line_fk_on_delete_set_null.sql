-- ════════════════════════════════════════════════════════════════════════
-- La clave ajena `stock_movement.sale_line_id` pasa a ON DELETE SET NULL
--
-- Aplicada el 12/09/2026 a las 00:19 (Madrid, reloj de la base). Version
-- registrada: 20260911221932. Luz verde de Julio a las 00:20, con cuatro
-- condiciones, todas cumplidas aqui o en el paso hermano.
--
-- POR QUE, Y POR QUE ANTES DE A4a
-- `adapt_lastapp_order` BORRA y rehace las lineas de una venta cada vez que se
-- reprocesa. Hoy la clave es NO ACTION (`confdeltype = 'a'`), pero no muerde
-- porque `sale_line_id` esta a NULL en las 71.516 filas. En cuanto A4a empiece
-- a rellenarla, borrar una linea con movimientos da 23503 y se lleva el
-- reproceso entero. Lo cazo el caso C13 del ensayo, no un razonamiento.
--
-- SET NULL y no CASCADE: el movimiento manda por `source_id` (la venta), y
-- `sale_line_id` es PROCEDENCIA. Si la linea desaparece se pierde la
-- procedencia, NO el movimiento — y justo despues el escritor reescribe la
-- venta entera. CASCADE haria desaparecer stock en silencio, que es la unica
-- cosa peor que un error.
--
-- COMO, para no pararse delante de la entrada de pedidos:
--   · `lock_timeout` de 3 segundos: si no coge el candado, aborta. No se espera.
--   · `NOT VALID` aqui y `VALIDATE CONSTRAINT` en el paso hermano
--     (20260911221942): asi este paso no recorre las 71.516 filas con el
--     candado cogido.
--
-- Verificado despues: confdeltype = 'n', convalidated = true, y 71.516 filas
-- antes y despues, con la misma consulta a los dos lados.
-- ════════════════════════════════════════════════════════════════════════

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.stock_movement
  DROP CONSTRAINT IF EXISTS stock_movement_sale_line_id_fkey;

ALTER TABLE public.stock_movement
  ADD CONSTRAINT stock_movement_sale_line_id_fkey
  FOREIGN KEY (sale_line_id) REFERENCES public.sale_line(id)
  ON DELETE SET NULL
  NOT VALID;

DO $verifica$
DECLARE v_tipo "char"; v_validada boolean; v_filas bigint;
BEGIN
  SELECT confdeltype, convalidated INTO v_tipo, v_validada
    FROM pg_constraint
   WHERE conrelid = 'public.stock_movement'::regclass
     AND conname = 'stock_movement_sale_line_id_fkey';
  SELECT count(*) INTO v_filas FROM public.stock_movement;

  IF v_tipo IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION 'La clave ajena no quedo en SET NULL: confdeltype = %', v_tipo;
  END IF;
  IF v_filas <> 71516 THEN
    RAISE EXCEPTION 'stock_movement tenia 71.516 filas y ahora tiene %', v_filas;
  END IF;
  RAISE NOTICE 'FK en SET NULL (confdeltype=n, validada=%), % filas', v_validada, v_filas;
END
$verifica$;
