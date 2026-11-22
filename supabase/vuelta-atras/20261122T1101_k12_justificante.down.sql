-- supabase/vuelta-atras/20261122T1101_k12_justificante.down.sql
--
-- K12 · Vuelta atrás de la 1101: quita la función y devuelve el CHECK de la clase a las tres de antes. Si ya hay algún
-- justificante guardado, PARA: devolver el CHECK lo dejaría fuera, y borrarlo es perder el documento de alguien.
do $$ begin
  if exists (select 1 from public.journal_entry_document where kind = 'justificante') then
    raise exception 'K12 · vuelta atrás: hay % justificantes guardados; el CHECK no se devuelve sin decidir qué se hace con ellos.',
      (select count(*) from public.journal_entry_document where kind = 'justificante');
  end if;
end $$;
drop function if exists public.conta_documento_justificante_guardar(uuid, text, text, text, integer, text);
alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check
  check (kind = any (array['resumen_ventas'::text, 'factura_recibida'::text, 'factura_expedida'::text]));
