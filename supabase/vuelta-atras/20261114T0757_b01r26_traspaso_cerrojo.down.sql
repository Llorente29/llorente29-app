-- supabase/vuelta-atras/20261114T0757_b01r26_traspaso_cerrojo.down.sql
-- B01r26 · vuelta atrás de la 0757: quita las dos funciones y la columna del cerrojo.
-- Antes, conta-diez-traspaso tiene que volver a la versión sin cerrojo (si no, la tanda para).
drop function if exists public.conta_traspaso_soltar_tanda(uuid);
drop function if exists public.conta_traspaso_tomar_tanda(uuid, integer);
alter table public.conta_diez_traspaso drop column if exists tanda_hasta;
