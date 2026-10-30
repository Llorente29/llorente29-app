-- supabase/vuelta-atras/20261029T0850_lab1_importador_lote.down.sql
--
-- Quita lo que añadió la 0850 (LAB1, tanda 1): la función y las dos tablas, con
-- sus lotes y filas. Antes de la 0850 no existía nada de esto.

drop function if exists public.lab_import_leer_cabeceras(uuid, text, text, jsonb, jsonb);
drop table if exists public.lab_import_fila;
drop table if exists public.lab_import_lote;
