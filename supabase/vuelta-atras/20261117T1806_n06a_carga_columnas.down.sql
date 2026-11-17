-- supabase/vuelta-atras/20261117T1806_n06a_carga_columnas.down.sql
--
-- N06a · la vuelta atrás de las columnas: las quita (va después de las de la 1808 y la 1807).
alter table public.customer_invoice drop column if exists import_pending, drop column if exists import_mark;
alter table public.supplier_invoice drop column if exists import_pending, drop column if exists import_mark;
alter table public.party drop column if exists import_run_id;
alter table public.supplier drop column if exists import_run_id;
alter table public.import_run drop column if exists detail, drop column if exists parent_id;
