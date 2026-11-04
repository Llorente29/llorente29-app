-- supabase/vuelta-atras/20261104T1905_s01p_falsos_rojos.down.sql
-- Vuelta atrás de la 1905: las cinco funciones de «Cerrar el mes», las de la 1720 (desde su respaldo), y fuera el ayudante.
select public._restaurar_funcion('public.conta_cierre_mes(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._restaurar_funcion('public.conta_cierre_bloque_repite(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._restaurar_funcion('public.conta_cierre_bloque_laboral(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._restaurar_funcion('public.conta_cierre_bloque_justificantes(uuid,date)', '20261104T1905_s01p_falsos_rojos');
select public._restaurar_funcion('public.conta_cierre_bloque_plataformas(uuid,date)', '20261104T1905_s01p_falsos_rojos');
drop function if exists public._s01p_sin_medir(jsonb);
