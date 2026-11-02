-- supabase/vuelta-atras/20261030T0950_lab2_importador_filas.down.sql
--
-- Quita lo que añadió la 0950 (LAB2): las dos funciones. Las filas que se
-- hayan cargado entre medias se quedan en lab_import_fila (de la 0850): borrar
-- datos no es de esta vuelta atrás; si hiciera falta, la de la 0850 quita la
-- tabla entera.

drop function if exists public.lab_import_terminar_filas(uuid, jsonb);
drop function if exists public.lab_import_cargar_filas(uuid, text, integer, jsonb);
