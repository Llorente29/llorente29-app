-- X10 · vuelta atrás de 20261119T1250: quita el conector «erp10» del catálogo,
-- solo si nadie lo ha conectado todavía (si hay conexiones, para: se miran antes).
do $$
begin
  if exists (select 1 from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'erp10') then
    raise exception 'Hay conexiones con ERP10 (despacho): no se quita el conector sin mirarlas antes';
  end if;
  delete from public.connector where code = 'erp10';
end $$;
