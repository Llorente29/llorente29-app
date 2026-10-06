-- Vuelta atrás de 20261009T0110_c03_terceros_datos.sql: quita los terceros que
-- solo eran la sombra de un proveedor (papel de proveedor y nada más, sin
-- cuentas de cliente enlazadas). PARA si alguno ya tiene otro papel: eso lo
-- añadió una persona.
do $$
begin
  if exists (select 1 from public.party_role r where r.role <> 'supplier'
              and exists (select 1 from public.party_role s where s.party_id = r.party_id and s.role = 'supplier')) then
    raise exception 'Algún proveedor ya tiene otro papel (cliente, plataforma o socio): no se quita nada.';
  end if;
  delete from public.party p where p.source = 'supplier'
     and not exists (select 1 from public.party_role r where r.party_id = p.id and r.role <> 'supplier');
end $$;
