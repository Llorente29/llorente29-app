-- Paso 2 de la clave ajena, aparte a proposito: `VALIDATE CONSTRAINT` recorre
-- la tabla, pero con un candado MAS FLOJO (SHARE UPDATE EXCLUSIVE) que no
-- bloquea lecturas ni escrituras normales. Por eso no va en el mismo paso que
-- el ADD.
--
-- Aplicada el 12/09/2026 a las 00:19 (Madrid, reloj de la base). Version
-- registrada: 20260911221942.
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.stock_movement
  VALIDATE CONSTRAINT stock_movement_sale_line_id_fkey;

DO $verifica$
DECLARE v_tipo "char"; v_validada boolean; v_filas bigint;
BEGIN
  SELECT confdeltype, convalidated INTO v_tipo, v_validada
    FROM pg_constraint
   WHERE conrelid = 'public.stock_movement'::regclass
     AND conname = 'stock_movement_sale_line_id_fkey';
  SELECT count(*) INTO v_filas FROM public.stock_movement;

  IF v_tipo IS DISTINCT FROM 'n' OR NOT v_validada THEN
    RAISE EXCEPTION 'FK mal: confdeltype=% validada=%', v_tipo, v_validada;
  END IF;
  IF v_filas <> 71516 THEN
    RAISE EXCEPTION 'stock_movement tenia 71.516 filas y ahora tiene %', v_filas;
  END IF;
  RAISE NOTICE 'FK validada · confdeltype=n · % filas', v_filas;
END
$verifica$;
