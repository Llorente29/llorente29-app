-- supabase/vuelta-atras/20261122T1855_k11g_347_desde_los_libros.down.sql
-- K11g · vuelta atrás de la 1855: quita la función (no escribe nada en ninguna tabla).
drop function if exists public.conta_347_desde_los_libros(uuid, integer);
