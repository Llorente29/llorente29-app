-- Vuelta atrás de 20261021T0100 (R15): el documento de cada asiento de ventas.
--
-- PARA si ya hay algún documento guardado o algún envío que lo nombre: quitar
-- la tabla se llevaría el enlace de un PDF de verdad con su asiento. Entonces
-- no se toca nada y lo decide una persona. Los ficheros del bucket no se borran
-- aquí (storage no se vacía desde SQL): si el bucket tiene ficheros, también PARA.
do $$
begin
  if to_regclass('public.journal_entry_document') is not null
     and exists (select 1 from public.journal_entry_document) then
    raise exception 'Vuelta atrás R15: hay % documento(s) guardado(s); no se quita nada.', (select count(*) from public.journal_entry_document);
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'conta-documentos') then
    raise exception 'Vuelta atrás R15: el bucket conta-documentos tiene % fichero(s); no se quita nada.', (select count(*) from storage.objects where bucket_id = 'conta-documentos');
  end if;
end $$;

alter table public.external_send drop column if exists document_attached_at;
alter table public.external_send drop column if exists document_error;
alter table public.external_send drop column if exists document_status;
alter table public.external_send drop column if exists document_id;
drop function if exists public.conta_documento_guardar(uuid, text, text, text, integer, text);
drop function if exists public.conta_resumen_ventas(uuid);
drop table if exists public.journal_entry_document;
drop policy if exists conta_documentos_insert on storage.objects;
drop policy if exists conta_documentos_select on storage.objects;
-- storage.protect_delete no deja borrar de storage sin decirlo: se dice aquí,
-- solo para esta transacción y con el bucket vacío (comprobado arriba).
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'conta-documentos';

do $$
begin
  if to_regclass('public.journal_entry_document') is not null or exists (select 1 from storage.buckets where id = 'conta-documentos')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'external_send' and column_name like 'document_%') then
    raise exception 'Vuelta atrás R15: algo ha quedado.';
  end if;
  raise notice 'Vuelta atrás R15: sin bucket, sin tabla, sin funciones y external_send como antes.';
end $$;
