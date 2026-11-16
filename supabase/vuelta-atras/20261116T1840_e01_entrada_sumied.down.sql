-- supabase/vuelta-atras/20261116T1840_e01_entrada_sumied.down.sql
--
-- Vuelta atrás de la 1840: las seis funciones como estaban (desde su respaldo),
-- el único de antes (una dirección de cada clase por empresa), fuera la columna
-- de la cuenta de Resend y las dos funciones nuevas. Antes, la 1850 (si una
-- empresa tiene la misma clase en dos dominios, el único de antes no se puede
-- poner: para y lo dice).
select public._restaurar_funcion('public.conta_entrada_correo(jsonb)', '20261116T1840_e01_entrada_sumied');
select public._restaurar_funcion('public.conta_direccion_entrada(uuid,text,text)', '20261116T1840_e01_entrada_sumied');
select public._restaurar_funcion('public.conta_direccion_facturas(uuid,text)', '20261116T1840_e01_entrada_sumied');
select public._restaurar_funcion('public.conta_correo_facturas(uuid)', '20261116T1840_e01_entrada_sumied');
select public._restaurar_funcion('public.conta_puerta(uuid,integer)', '20261116T1840_e01_entrada_sumied');
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261116T1840_e01_entrada_sumied');
do $$ begin
  if exists (select 1 from public.company_inbound_address group by company_id, kind having count(*) > 1) then
    raise exception 'VUELTA ATRÁS 1840 PARADA: hay empresas con la misma clase de dirección en dos dominios (deshaz antes la 1850).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_inbound_address_company_id_kind_key') then
    alter table public.company_inbound_address add constraint company_inbound_address_company_id_kind_key unique (company_id, kind);
  end if;
end $$;
alter table public.company_inbound_address drop constraint if exists company_inbound_address_company_kind_domain_key;
alter table public.inbound_email_log drop constraint if exists inbound_email_log_resend_account_check;
alter table public.inbound_email_log drop column if exists resend_account;
drop function if exists public._conta_direccion_empresa(uuid);
drop function if exists public._conta_dominio_entrada(uuid);
