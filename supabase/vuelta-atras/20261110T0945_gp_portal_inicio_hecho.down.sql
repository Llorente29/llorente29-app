-- supabase/vuelta-atras/20261110T0945_gp_portal_inicio_hecho.down.sql
--
-- GP · La vuelta atrás de la 0945: conta_portal_inicio como estaba, restaurada de
-- su respaldo (_restaurar_funcion comprueba la huella).
-- sin prueba con datos: la prueba de staging (20261110_gp_portal_inicio_hecho_prueba.sql) la pasa en ROLLBACK y comprueba que vuelve a no dar lo hecho.

select public._restaurar_funcion('public.conta_portal_inicio(uuid)', '20261110T0945_gp_portal_inicio_hecho');
