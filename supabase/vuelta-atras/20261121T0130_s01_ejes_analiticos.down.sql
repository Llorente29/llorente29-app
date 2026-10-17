-- supabase/vuelta-atras/20261121T0130_s01_ejes_analiticos.down.sql
--
-- Vuelta atrás de 20261121T0130_s01_ejes_analiticos. ANTES, la de la 0140 (la
-- regla 5 lee esta tabla) y el front de antes del S01 (el del S01 la lee).
-- No se pierde ningún dato de los asientos: solo qué ejes estaban encendidos.

drop trigger if exists trg_conta_eje_analitico_al_dia on public.conta_eje_analitico;
drop table if exists public.conta_eje_analitico;
drop function if exists public.conta_eje_analitico_al_dia();
