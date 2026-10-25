-- supabase/vuelta-atras/20261025T2341_v03_verifactu_autorizacion.down.sql
-- Vuelta atrás de la 2341: quita la autorización del certificado para
-- Verifactu, sus funciones y la columna del envío. Va antes que la de la 2249,
-- la 2141 y la 2140. Si ya hubo envíos con autorización (en real), se para: es
-- el rastro de qué se envió con qué certificado.
do $$
begin
  if to_regclass('public.verifactu_envio') is not null and exists (
       select 1 from information_schema.columns where table_schema = 'public' and table_name = 'verifactu_envio' and column_name = 'autorizacion_id')
     and (xpath('/row/n/text()', query_to_xml('select count(*) n from public.verifactu_envio where autorizacion_id is not null', false, true, '')))[1]::text::int > 0 then
    raise exception 'Hay envíos de Verifactu hechos con una autorización del certificado: no se deshace la 2341.';
  end if;
end $$;
drop function if exists public.verifactu_cert_abrir(uuid);
drop function if exists public.verifactu_retirar_autorizacion(uuid, text, text);
drop function if exists public.verifactu_autorizar_certificado(uuid, uuid, text, text);
alter table if exists public.verifactu_envio drop column if exists autorizacion_id;
drop table if exists public.verifactu_autorizacion;
drop function if exists public._verifactu_autorizacion_inalterable();
