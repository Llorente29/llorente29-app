-- supabase/migrations/20261114T0100_d01_encender_liquidaciones_foodint.sql
--
-- D01 · Liquidaciones por correo · ENCENDER la dirección de Foodint,
-- liquidaciones-foodint@entrada.folvy.app (la creó apagada la 0110). Se lanza
-- cuando Resend diga «Verified» para entrada.folvy.app: hasta entonces no llega
-- nada. Con el #208 desplegado (conta-facturas-entrada v3), ningún correo que
-- llegue se pierde: lo que no sea de ninguna dirección queda «sin destino».
--
-- Solo esa fila: cuenta y empresa de Foodint (regla 9), clase «liquidaciones»,
-- esa dirección. No toca la de facturas ni ninguna otra.
-- Freno: tiene que haber UNA sola fila así y estar APAGADA antes; si no, para
-- sin tocar nada y dice qué ha encontrado. Después comprueba que ha encendido
-- exactamente una.
-- En staging no hace nada (Foodint no está): lo dice y sigue.
-- Vuelta atrás: supabase/vuelta-atras/20261114T0100_d01_encender_liquidaciones_foodint.down.sql

do $$
declare
  n int; encendidas int; hechas int;
begin
  if not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise notice 'Encender liquidaciones-foodint: esta base no tiene a Foodint; no se toca nada.';
    return;
  end if;
  select count(*), count(*) filter (where active) into n, encendidas
    from public.company_inbound_address
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
     and kind = 'liquidaciones' and lower(local_part) = 'liquidaciones-foodint' and lower(domain) = 'entrada.folvy.app';
  if n <> 1 or encendidas <> 0 then
    raise exception 'ENCENDER liquidaciones-foodint PARADA: hay % fila(s) con esa dirección y % encendida(s); tiene que haber una sola y apagada. No se toca nada.', n, encendidas
      using errcode = 'P0001';
  end if;
  update public.company_inbound_address set active = true
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
     and kind = 'liquidaciones' and lower(local_part) = 'liquidaciones-foodint' and lower(domain) = 'entrada.folvy.app' and not active;
  get diagnostics hechas = row_count;
  if hechas <> 1 then
    raise exception 'ENCENDER liquidaciones-foodint: se esperaba encender 1 y se han encendido %. Se deshace todo.', hechas using errcode = 'P0001';
  end if;
end $$;
