-- X10e · vuelta atrás de 20261120T1140: quita las tres columnas, solo si ninguna fila las usa
-- (con un día ya escrito en ERP10, su número no se tira sin mirarlo).
do $$
begin
  if exists (select 1 from public.conta_erp10_envio where dia is not null or cobro_documento is not null or cobro_serie is not null) then
    raise exception 'conta_erp10_envio tiene días del TPV escritos en ERP10: no se quitan sus columnas sin mirarlos antes';
  end if;
end $$;
alter table public.conta_erp10_envio drop constraint if exists conta_erp10_envio_cobro_documento_ck;
alter table public.conta_erp10_envio drop column if exists cobro_documento;
alter table public.conta_erp10_envio drop column if exists cobro_serie;
alter table public.conta_erp10_envio drop column if exists dia;
