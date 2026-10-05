-- supabase/vuelta-atras/20261007T0115_c02_pgc_definicion.down.sql
--
-- Deshace 20261007T0115: quita la columna de la reserva del BOE. La pantalla
-- vuelve a enseñar solo el título donde no hay «qué se apunta aquí».
alter table public.pgc_account drop column if exists boe_definition;
