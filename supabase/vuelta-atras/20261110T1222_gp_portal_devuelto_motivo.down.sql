-- supabase/vuelta-atras/20261110T1222_gp_portal_devuelto_motivo.down.sql
--
-- GP · la vuelta atrás de la 1222: _conta_portal_devueltos como estaba, restaurada
-- de su respaldo (_restaurar_funcion comprueba la huella).
-- sin prueba con datos: la prueba de staging (20261110_gp_portal_devuelto_motivo_prueba.sql) la pasa en ROLLBACK y comprueba que vuelve a no dar el motivo.

select public._restaurar_funcion('public._conta_portal_devueltos(uuid, uuid)', '20261110T1222_gp_portal_devuelto_motivo');
