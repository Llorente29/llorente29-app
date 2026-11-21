-- K07 · vuelta atrás de 20261120T2004: quita la función nueva. La tabla de los documentos de antes
-- solo se quita si está vacía: si ya guardó alguno, es su historial y se queda (los ficheros nunca
-- se borraron, y el asiento ya tiene enlazado el nuevo).
drop function if exists public.conta_recibida_documento_cambiar(uuid, text, text, text);
do $$
begin
  if to_regclass('public.journal_entry_document_anterior') is not null
     and not exists (select 1 from public.journal_entry_document_anterior) then
    drop table public.journal_entry_document_anterior;
  end if;
end $$;
