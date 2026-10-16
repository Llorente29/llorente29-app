-- supabase/vuelta-atras/20261114T0100_d01_encender_liquidaciones_foodint.down.sql
-- Deshace la 0100 del 14: vuelve a APAGAR liquidaciones-foodint@entrada.folvy.app.
-- Apagar no borra nada: los correos que ya llegaron se quedan en el registro y
-- las liquidaciones que se leyeron, también; lo que llegue después se apunta
-- «apagada» y no se lee.
-- Freno: tiene que haber una sola fila así; si no, para sin tocar nada. Si ya
-- está apagada, no hace nada. En staging (sin Foodint), tampoco.
do $$
declare n int; hechas int;
begin
  select count(*) into n from public.company_inbound_address
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
     and kind = 'liquidaciones' and lower(local_part) = 'liquidaciones-foodint' and lower(domain) = 'entrada.folvy.app';
  if n = 0 and not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then return; end if;
  if n <> 1 then
    raise exception 'VUELTA ATRÁS (encender liquidaciones-foodint) PARADA: hay % fila(s) con esa dirección; tiene que haber una. No se toca nada.', n using errcode = 'P0001';
  end if;
  update public.company_inbound_address set active = false
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
     and kind = 'liquidaciones' and lower(local_part) = 'liquidaciones-foodint' and lower(domain) = 'entrada.folvy.app' and active;
  get diagnostics hechas = row_count;
  raise notice 'Vuelta atrás: % dirección(es) apagada(s).', hechas;
end $$;
