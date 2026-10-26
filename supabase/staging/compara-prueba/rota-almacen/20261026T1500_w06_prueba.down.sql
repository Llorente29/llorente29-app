-- supabase/staging/compara-prueba/rota-almacen/20261026T1500_w06_prueba.down.sql
-- W06 · Vuelta atrás de la tanda de prueba: ROTA, no borra el almacén (tiene que salir en rojo).

delete from public.w06_base where id = 1;
drop index if exists public.w06_base_nombre_idx;
alter table public.w06_base drop column if exists marca;
create or replace function public.w06_prueba_f() returns int language sql as $$ select 1 $$;
-- ROTA a propósito: como el #230, se traga el error de storage.protect_delete y el almacén se queda.
do $$ begin
  delete from storage.buckets where id = 'w06-prueba';
exception when others then null;
end $$;
