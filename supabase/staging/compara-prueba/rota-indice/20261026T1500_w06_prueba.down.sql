-- supabase/staging/compara-prueba/rota-indice/20261026T1500_w06_prueba.down.sql
-- W06 · Vuelta atrás de la tanda de prueba: ROTA, no borra el índice (tiene que salir en rojo).

delete from public.w06_base where id = 1;
-- ROTA a propósito: no borra el índice w06_base_nombre_idx.
alter table public.w06_base drop column if exists marca;
create or replace function public.w06_prueba_f() returns int language sql as $$ select 1 $$;
do $$ begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.buckets where id = 'w06-prueba';
  perform set_config('storage.allow_delete_query', 'false', true);
end $$;
