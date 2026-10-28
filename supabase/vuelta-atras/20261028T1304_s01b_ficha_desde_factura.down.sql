-- supabase/vuelta-atras/20261028T1304_s01b_ficha_desde_factura.down.sql
--
-- Vuelta atrás de la 1304, que solo añade: la función y la columna. Lo que la
-- columna apuntaba se pierde («de la factura …»), no los datos de la ficha.
drop function if exists public.conta_proveedor_iban_de_factura(uuid, uuid);
alter table public.supplier drop column if exists data_from_invoice;
