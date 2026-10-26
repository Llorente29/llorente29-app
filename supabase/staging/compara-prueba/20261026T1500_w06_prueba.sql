-- supabase/staging/compara-prueba/20261026T1500_w06_prueba.sql
-- W06 · La tanda de prueba: añade una columna, un índice, un almacén y una
-- fila, y cambia una función. Solo en staging, en ROLLBACK (aplicar.txt).
alter table public.w06_base add column marca text;
create index w06_base_nombre_idx on public.w06_base (nombre);
create or replace function public.w06_prueba_f() returns int language sql as $$ select 2 $$;
insert into storage.buckets (id, name) values ('w06-prueba', 'w06-prueba');
insert into public.w06_base (id, nombre, marca) values (1, 'uno', 'una');
