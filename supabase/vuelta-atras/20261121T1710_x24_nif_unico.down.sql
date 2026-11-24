-- supabase/vuelta-atras/20261121T1710_x24_nif_unico.down.sql
--
-- X24 · Vuelta atrás de la 1710: el índice de antes, por el NIF tal como está escrito.
drop index if exists public.ux_supplier_account_nif_clave;
create unique index if not exists ux_supplier_account_tax_id on public.supplier using btree (account_id, tax_id) where (tax_id is not null);
