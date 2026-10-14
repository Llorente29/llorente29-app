-- supabase/vuelta-atras/20261111T0610_c06b_contrasena_tope.down.sql
--
-- Vuelta atrás de 20261111T0610_c06b_contrasena_tope.sql: fuera la función y la
-- tabla de intentos (solo huellas de un día; nada que guardar).
-- ANTES, la edge function conta-contrasena tiene que volver a la versión que
-- llama a conta_contrasena_de_marca: si no, «He olvidado la contraseña» dejaría
-- de mandar correos (y seguiría contestando lo mismo, sin que nadie lo vea).
drop function if exists public.conta_contrasena_pedir(text, text, text);
drop table if exists public.conta_contrasena_intento;
