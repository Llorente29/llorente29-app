-- supabase/vuelta-atras/20261117T1602_r05_dia_tpv_funciones.down.sql
--
-- Vuelta atrás de la 1602 (R05): quita las cuatro funciones del día del TPV. Los
-- asientos ya validados se quedan (son asientos como cualquier otro).

drop function if exists public.conta_tpv_dia_validar(uuid, uuid, integer, text, text, text, integer, text);
drop function if exists public.conta_tpv_dia_para_validar(uuid);
drop function if exists public.conta_tpv_dias(uuid, date, date);
drop function if exists public._conta_tpv_propuesta(uuid);
