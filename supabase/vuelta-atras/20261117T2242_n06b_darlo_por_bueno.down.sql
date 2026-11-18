-- supabase/vuelta-atras/20261117T2242_n06b_darlo_por_bueno.down.sql
--
-- N06b · la vuelta atrás de traer y darlo por bueno: quita las tres funciones nuevas y devuelve las tres
-- del N06a desde su respaldo (va antes que la de la 2241). Lo dado por bueno se queda: no se deshace.
drop function if exists public.conta_traer_dar_por_bueno(uuid, text);
drop function if exists public.conta_traer_antes_de_dar_por_bueno(uuid);
drop function if exists public._conta_traer_comparar(uuid);
select public._restaurar_funcion('public.conta_traer_dejar_fuera(uuid,uuid[],boolean)', '20261117T2242_n06b_darlo_por_bueno');
select public._restaurar_funcion('public.conta_traer_deshacer(uuid,text)', '20261117T2242_n06b_darlo_por_bueno');
select public._restaurar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261117T2242_n06b_darlo_por_bueno');
