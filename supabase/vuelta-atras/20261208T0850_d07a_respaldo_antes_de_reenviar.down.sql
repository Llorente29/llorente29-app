-- supabase/vuelta-atras/20261208T0850_d07a_respaldo_antes_de_reenviar.down.sql
--
-- Vuelta atrás de 20261208T0850_d07a_respaldo_antes_de_reenviar: quita la
-- tabla del respaldo. Va DESPUÉS de la vuelta atrás de la 0820, que lo usa
-- (supabase/produccion/vuelta-atras.txt, en orden inverso a la tanda).
drop table if exists public.conta_respaldo_d07a_envios;
