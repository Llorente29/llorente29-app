-- supabase/vuelta-atras/20261109T1720_gp_portal_cuenta.down.sql
--
-- GP · La vuelta atrás de la 1720: conta_portal_cuenta como estaba antes (la
-- de la 1530), restaurada de su respaldo (_restaurar_funcion comprueba la huella).
-- Los permisos a service_role se quedan: los tenía ya por el permiso por
-- defecto de Supabase, así que quitarlos no deja las cosas «como estaban».
-- sin prueba con datos: la prueba de staging (20261109_gp_portal_cuenta_prueba.sql) la pasa en ROLLBACK y comprueba que vuelve la de antes.

select public._restaurar_funcion('public.conta_portal_cuenta(uuid)', '20261109T1720_gp_portal_cuenta');
