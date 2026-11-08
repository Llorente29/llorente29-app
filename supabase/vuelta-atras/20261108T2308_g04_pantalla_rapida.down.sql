-- supabase/vuelta-atras/20261108T2308_g04_pantalla_rapida.down.sql
--
-- G04 · La vuelta atrás de la 2308: fuera las cuatro funciones de lectura. Las
-- tablas y su RLS no se tocaron: el front de antes las sigue leyendo.
-- sin prueba con datos: la prueba de staging (20261108_g04_pantalla_rapida_prueba.sql) la pasa en ROLLBACK y comprueba que no queda ninguna.

drop function if exists public.conta_lista_gc_cobros(uuid);
drop function if exists public.conta_lista_gc_mandatos(uuid);
drop function if exists public.conta_lista_gc_suscripciones(uuid);
drop function if exists public.conta_lista_fichas(uuid);
