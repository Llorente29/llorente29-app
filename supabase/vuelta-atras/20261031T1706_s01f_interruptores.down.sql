-- supabase/vuelta-atras/20261031T1706_s01f_interruptores.down.sql
--
-- Vuelta atrás de 20261031T1706_s01f_interruptores.sql: quita las dos
-- funciones. Los interruptores que se hayan cambiado con ellas se quedan como
-- estén (la función no borra nada y esto tampoco).

drop function if exists public.conta_interruptor_cambiar(uuid, text, boolean, text);
drop function if exists public.conta_interruptores_de_cuenta(uuid);
