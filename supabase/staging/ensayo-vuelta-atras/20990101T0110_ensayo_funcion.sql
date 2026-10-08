-- ============================================================================
-- ENSAYO DE VUELTA ATRÁS (solo staging-conta). Segunda pieza de la tanda de
-- ejemplo: una función que lee la tabla de la primera (así la vuelta atrás
-- tiene que ir en orden inverso: primero ésta, después la tabla).
-- Vuelta atrás: supabase/staging/ensayo-vuelta-atras/20990101T0110_ensayo_funcion.down.sql
-- ============================================================================
create function public.ensayo_vuelta_atras_cuenta() returns bigint
language sql stable as $$ select count(*) from public.ensayo_vuelta_atras $$;
