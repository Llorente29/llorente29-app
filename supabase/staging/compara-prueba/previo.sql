-- supabase/staging/compara-prueba/previo.sql
-- W06 · Lo que «ya existía» para la tanda de prueba. Solo dentro de la
-- transacción de compara.sh, que acaba en ROLLBACK.
create table public.w06_base (id int primary key, nombre text);
create function public.w06_prueba_f() returns int language sql as $$ select 1 $$;
