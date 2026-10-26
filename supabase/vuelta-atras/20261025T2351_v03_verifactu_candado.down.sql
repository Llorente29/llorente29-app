-- supabase/vuelta-atras/20261025T2351_v03_verifactu_candado.down.sql
-- Vuelta atrás de la 2351: quita las pruebas de conexión y sus dos funciones.
-- verifactu_modo se queda como lo dejó la 2351, con la comprobación delante:
-- sin verifactu_conexion_probada, encender falla en vez de abrirse (se cierra
-- del lado seguro). La función la quita la vuelta atrás de la 2140. Va antes que
-- la de la 2341.
drop function if exists public.verifactu_conexion_probada(text, text);
drop function if exists public.verifactu_conexion_apuntar(text, text, boolean, integer, text, text);
drop table if exists public.verifactu_conexion;
