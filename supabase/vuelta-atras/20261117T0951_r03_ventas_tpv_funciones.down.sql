-- supabase/vuelta-atras/20261117T0951_r03_ventas_tpv_funciones.down.sql
--
-- Vuelta atrás de la 0951 (R03): quita las tres funciones nuevas. No las llama
-- nadie todavía (ni la pantalla ni el día de ventas): no se pierde nada.

drop function if exists public.conta_tpv_dia_leer(uuid, date, text);
drop function if exists public.conta_tpv_dia_guardar(uuid, date, text, jsonb, text);
drop function if exists public._conta_tpv_lista(text[]);
