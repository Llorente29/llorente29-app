-- supabase/vuelta-atras/20261102T1215_s01q_tienda_local_marca.down.sql
--
-- Vuelta atrás de la 1215: el local de una tienda nueva vuelve a salir solo de su
-- dirección, y la marca deja de ponerse sola. Lo que ya se puso se queda.
select public._restaurar_funcion('public._conta_tienda_local_por_direccion()', '20261102T1215_s01q_tienda_local_marca');
select public._restaurar_funcion('public.conta_local_de_tienda(uuid,text)', '20261102T1215_s01q_tienda_local_marca');
drop function if exists public.conta_marca_de_tienda(uuid, text);
drop function if exists public._conta_clave_marca(text);
drop function if exists public._conta_tienda_etiqueta(text);
