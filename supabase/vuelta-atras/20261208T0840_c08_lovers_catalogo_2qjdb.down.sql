-- supabase/vuelta-atras/20261208T0840_c08_lovers_catalogo_2qjdb.down.sql
--
-- Vuelta atrás de la 0840 (C08): la fila de Lovers Burgers en Carabanchel,
-- otra vez al q3v47. Solo si está como la dejó la 0840 (2qjdb); si no, no toca
-- nada y lo dice. En staging, nada.
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'C08 0840 (vuelta atrás): esta base no tiene la cuenta de Foodint: nada que deshacer.';
    return;
  end if;
  update public.brand_hubrise_catalog
     set external_catalog_id = 'q3v47'
   where id = '84c5951d-461d-454a-9fad-7b3bafd7e85b' and account_id = v_acc
     and brand_id = '99dff23e-98a8-46ab-af54-0cc19d036b72'
     and external_location_id = '1b6p8-2' and external_catalog_id = '2qjdb';
  get diagnostics v_n = row_count;
  raise notice 'C08 0840 (vuelta atrás): % fila(s) otra vez al q3v47.', v_n;
end $$;
