-- 20260827T0720_queue_system_alert_quitar_sobrecarga_vieja.sql
-- APLICADA en produccion el 27-08-2026, minutos despues de la T0700.
--
-- ERROR MIO, y de los que hay que dejar escritos.
--
-- La migracion T0700 anadio un 5o parametro con CREATE OR REPLACE. Eso NO
-- reemplaza una funcion: crea una SOBRECARGA. Con las dos firmas vivas, las
-- llamadas de 4 argumentos — o sea, LAS DE LOS 7 VIGIAS — quedaron ambiguas:
--
--   ERROR 42725: function public._queue_system_alert(unknown, text, text, text)
--   is not unique
--   HINT: Could not choose a best candidate function.
--
-- Durante esos minutos ningun vigia podia encolar nada. Lo detecte al probar
-- sales_unmapped_watchdog inmediatamente despues de aplicar, que es justo para
-- lo que sirve probar en vez de dar por hecho.
--
-- Se elimina la firma de 4 argumentos. Los llamadores pasan 4 y resuelven a la
-- nueva, que tiene default en el 5o. Verificado despues: una sola firma viva, y
-- los cuatro vigias (sales_unmapped_watchdog, kds_device_silence_check,
-- sale_line_cost_sweep, db_health_watchdog) corren sin error.
--
-- Regla para la proxima vez: anadir un parametro a una funcion existente es
-- DROP + CREATE, nunca CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public._queue_system_alert(text, text, text, text);

NOTIFY pgrst, 'reload schema';
