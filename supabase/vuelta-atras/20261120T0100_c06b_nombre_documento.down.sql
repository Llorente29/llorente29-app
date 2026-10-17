-- supabase/vuelta-atras/20261120T0100_c06b_nombre_documento.down.sql
--
-- Vuelta atrás de 20261120T0100_c06b_nombre_documento: fuera el disparador y
-- sus dos funciones. Los nombres que ya se limpiaron se quedan limpios (cumplen
-- el CHECK de antes, que sigue ahí).
-- La columna original_name solo se quita si no guarda nada que no esté ya en
-- file_name: si algún documento entró con un nombre que hubo que limpiar, su
-- original vive solo ahí y no se tira (se queda la columna, que admite nulos y
-- no la lee nadie de antes).

drop trigger if exists trg_journal_entry_document_nombre_limpio on public.journal_entry_document;
drop function if exists public.journal_entry_document_nombre_limpio();
drop function if exists public.conta_nombre_fichero(text);

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'journal_entry_document' and column_name = 'original_name') then
    if exists (select 1 from public.journal_entry_document where original_name is not null and original_name is distinct from file_name) then
      raise notice 'Vuelta atrás C06b nombre: hay documentos con su nombre original distinto del limpio; la columna original_name se queda.';
    else
      alter table public.journal_entry_document drop column original_name;
    end if;
  end if;
end $$;
