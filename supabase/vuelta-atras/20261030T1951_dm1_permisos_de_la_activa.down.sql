-- supabase/vuelta-atras/20261030T1951_dm1_permisos_de_la_activa.down.sql
--
-- Vuelta atrás de la 1951: las ocho funciones de permisos como estaban (del
-- respaldo, con su huella), en orden inverso. Una persona con varias cuentas
-- vuelve a ver todas a la vez: antes, devolver el front y quitar las
-- pertenencias de más que se hayan dado.
select public._restaurar_funcion('public.current_employee_and_account()', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_location_ids()', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_is_office()', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_ve_persona(uuid,uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_is_employee(uuid,uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_is_admin_or_manager_of(uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_is_admin_of(uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._restaurar_funcion('public.current_user_account_ids()', '20261030T1951_dm1_permisos_de_la_activa');
