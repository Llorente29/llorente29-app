-- supabase/vuelta-atras/20261122T0160_s01d_documento_expedida.down.sql
--
-- Vuelta atrás de 20261122T0160_s01d_documento_expedida: quita la función y
-- deja el CHECK de journal_entry_document.kind como estaba.
-- PARA, sin tocar nada, si ya hay algún PDF de expedida enlazado: con el CHECK
-- de antes esas filas no cabrían, y borrarlas es perder el enlace al papel.

do $$
declare n bigint;
begin
  select count(*) into n from public.journal_entry_document where kind = 'factura_expedida';
  if n > 0 then
    raise exception 'S01d 0160 vuelta atrás: hay % PDF de expedidas enlazados. No se toca nada.', n;
  end if;
end $$;

drop function if exists public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text);

alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check
  check (kind = any (array['resumen_ventas', 'factura_recibida']));
