-- supabase/vuelta-atras/20261113T1015_s01p_documento_sin_leer.down.sql
--
-- S01p·18.2 · 3 · la vuelta atrás: conta_puerta_dime_que_es desde su respaldo y fuera
-- conta_llegada_eliminar (lo eliminado sigue «descartado»: se devuelve a mano si hace falta).

select public._restaurar_funcion('public.conta_puerta_dime_que_es(uuid,text,boolean,text)', '20261113T1015_s01p_documento_sin_leer');
drop function if exists public.conta_llegada_eliminar(uuid, text);
