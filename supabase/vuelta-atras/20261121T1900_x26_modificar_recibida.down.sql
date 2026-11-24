-- supabase/vuelta-atras/20261121T1900_x26_modificar_recibida.down.sql
--
-- X26 · Vuelta atrás de la 1900: quita las dos funciones y la tabla. Lo que se haya modificado con ellas se queda
-- como está (los asientos, con su cadena íntegra); su respaldo se va con la tabla.
drop function if exists public.conta_recibida_modificar(uuid, jsonb, text);
drop function if exists public.conta_recibida_se_puede_modificar(uuid);
drop table if exists public.conta_recibida_modificada;
