-- supabase/vuelta-atras/20261105T1510_s01p_iva_redondeo.down.sql
-- Vuelta atrás de la 1510: conta_motivos_para_validar desde su respaldo y fuera _conta_iva_tolerancia.
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261105T1510_s01p_iva_redondeo');
drop function if exists public._conta_iva_tolerancia(uuid, numeric);
