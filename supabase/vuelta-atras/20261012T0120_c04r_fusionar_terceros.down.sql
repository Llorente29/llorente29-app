-- ============================================================================
-- Vuelta atrás de C04 R4 · fusionar terceros: quita las dos funciones y la
-- tabla del rastro. PARA si hay alguna fusión sin deshacer: borrar el rastro
-- dejaría datos movidos sin manera de devolverlos. Primero se deshacen
-- (party_merge_undo) y después se quita.
-- ============================================================================
do $$ begin
  if to_regclass('public.party_merge') is not null
     and exists (select 1 from public.party_merge where undone_at is null) then
    raise exception 'Vuelta atrás de la fusión: hay fusiones sin deshacer. Deshazlas antes (party_merge_undo).';
  end if;
end $$;
drop function if exists public.party_merge_undo(uuid, text);
drop function if exists public.party_merge_do(uuid, uuid, text);
drop table if exists public.party_merge;
