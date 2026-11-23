-- supabase/vuelta-atras/20261123T0800_x28_tesoreria_modificar.down.sql
--
-- X28 · Vuelta atrás de la 0800: quita las tres funciones y el registro. Los asientos modificados se quedan como quedaron
-- (con su cadena íntegra); lo que eran antes está en conta_tesoreria_modificada, que se lee antes de quitarla si hace falta.

drop function if exists public.conta_tesoreria_modificar(uuid, jsonb, text);
drop function if exists public.conta_tesoreria_se_puede_modificar(uuid);
drop function if exists public.conta_tesoreria_a_mano(uuid, date, text, text, numeric, text, uuid, uuid, uuid);
drop table if exists public.conta_tesoreria_modificada;
