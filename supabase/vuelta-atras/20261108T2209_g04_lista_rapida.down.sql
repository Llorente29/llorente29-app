-- supabase/vuelta-atras/20261108T2209_g04_lista_rapida.down.sql
--
-- G04 · La vuelta atrás de la 2209: fuera las dos funciones de lectura. Las
-- vistas no se tocaron: el front de antes las sigue leyendo.
-- sin prueba con datos: la prueba de staging (20261108_g04_lista_rapida_prueba.sql) la pasa en ROLLBACK y comprueba que no queda ninguna.

drop function if exists public.conta_lista_clientes(uuid);
drop function if exists public.conta_lista_que_hacer(uuid);
