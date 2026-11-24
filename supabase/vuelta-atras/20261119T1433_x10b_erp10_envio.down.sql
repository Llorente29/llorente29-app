-- X10b · vuelta atrás de 20261119T1433: quita la función y la tabla nuevas, solo si la tabla
-- está vacía (con filas, hay cosas escritas en ERP10 y su registro no se tira sin mirarlo).
do $$
begin
  if exists (select 1 from public.conta_erp10_envio) then
    raise exception 'conta_erp10_envio tiene filas (cosas escritas en ERP10): no se quita sin mirarlas antes';
  end if;
end $$;
drop function if exists public.conta_erp10_envio_tomar(uuid, uuid, text, text);
drop table if exists public.conta_erp10_envio;
