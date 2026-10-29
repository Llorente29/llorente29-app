-- supabase/vuelta-atras/20261029T1135_l1ah_firma_interruptor.down.sql
--
-- Vuelta atrás de la 1135 (L1a-H): quita la función y la columna. Antes,
-- devolver el front: el de esta rama lee accounts.firma_registro_mes y, sin la
-- columna, no sabe si pedir la firma (deja de pedirla: falla hacia apagado).
-- Se pierde qué cuentas la tenían encendida; las firmas ya hechas
-- (registro_jornada_firma) no se tocan.

drop function if exists public.firma_registro_mes_pedir(uuid, boolean);
alter table public.accounts drop column if exists firma_registro_mes;
