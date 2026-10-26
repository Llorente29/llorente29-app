-- supabase/staging/compara-prueba/rota-columna/20261026T1500_w06_prueba.down.sql
-- W06 · Vuelta atrás de la tanda de prueba: ROTA, deja la columna (tiene que salir en rojo).

delete from public.w06_base where id = 1;
drop index if exists public.w06_base_nombre_idx;
-- ROTA a propósito: deja la columna marca.
create or replace function public.w06_prueba_f() returns int language sql as $$ select 1 $$;
do $$ begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.buckets where id = 'w06-prueba';
  perform set_config('storage.allow_delete_query', 'false', true);
end $$;
