-- supabase/vuelta-atras/20261116T1850_e01_direcciones_sumied.down.sql
-- Deshace la 1850: quita las direcciones en entrada.sumied.com que creó la tanda
-- (las de «Tanda E01 · entrada.sumied.com»). Freno: si a alguna ya le ha llegado
-- un correo, no se toca nada y lo dice. Las de entrada.folvy.app no se tocan.
do $$ begin
  if exists (select 1 from public.company_inbound_address a join public.inbound_email_log l
                 on lower(l.to_address) = lower(a.local_part || '@' || a.domain)
              where a.created_by_name = 'Tanda E01 · entrada.sumied.com') then
    raise exception 'VUELTA ATRÁS 1850 (direcciones en entrada.sumied.com) PARADA: ya les han llegado correos. No se toca nada.' using errcode = 'P0001';
  end if;
  delete from public.company_inbound_address where created_by_name = 'Tanda E01 · entrada.sumied.com' and lower(domain) = 'entrada.sumied.com';
end $$;
