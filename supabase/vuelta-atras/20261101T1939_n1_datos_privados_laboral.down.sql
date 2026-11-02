-- supabase/vuelta-atras/20261101T1939_n1_datos_privados_laboral.down.sql
--
-- Vuelta atrás de la 1939: empleados_datos_privados como estaba (solo el
-- administrador), del respaldo con su huella.
select public._restaurar_funcion('public.empleados_datos_privados(uuid)', '20261101T1939_n1_datos_privados_laboral');
