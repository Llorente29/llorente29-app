-- supabase/vuelta-atras/20261113T0110_d01_liquidaciones_direccion_foodint.down.sql
-- Deshace la 0110: quita la dirección de liquidaciones de Foodint. Freno: si
-- está encendida o ya le ha llegado algún correo, no se toca nada y lo dice.
do $$
declare n int; e boolean;
begin
  select count(*), bool_or(active) into n, e from public.company_inbound_address
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'liquidaciones' and local_part = 'liquidaciones-foodint';
  if n = 0 then return; end if;
  if e or exists (select 1 from public.inbound_email_log where lower(to_address) = 'liquidaciones-foodint@entrada.folvy.app') then
    raise exception 'VUELTA ATRÁS 0110 (dirección de liquidaciones) PARADA: la dirección está encendida o ya le han llegado correos. No se toca nada.' using errcode = 'P0001';
  end if;
  delete from public.company_inbound_address
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'liquidaciones' and local_part = 'liquidaciones-foodint' and not active;
end $$;
