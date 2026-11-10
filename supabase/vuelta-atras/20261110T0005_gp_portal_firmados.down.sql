-- supabase/vuelta-atras/20261110T0005_gp_portal_firmados.down.sql
--
-- GP · La vuelta atrás de la 0005: conta_portal_documentos como estaba, restaurada
-- de su respaldo (_restaurar_funcion comprueba la huella).
-- sin prueba con datos: la prueba de staging (20261110_gp_portal_firmados_prueba.sql) la pasa en ROLLBACK y comprueba que vuelve a no dar «firmados».

select public._restaurar_funcion('public.conta_portal_documentos(uuid)', '20261110T0005_gp_portal_firmados');
