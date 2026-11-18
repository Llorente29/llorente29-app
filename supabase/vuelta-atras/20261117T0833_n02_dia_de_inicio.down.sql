-- supabase/vuelta-atras/20261117T0833_n02_dia_de_inicio.down.sql
--
-- Vuelta atrás de la 0833 (N02): quita conta_dia_de_inicio (no la llama nadie)
-- y las tres columnas import_run_id. Mientras no haya carga nueva (N06), las
-- tres están a nulo en todas las filas: no se pierde nada.

drop function if exists public.conta_dia_de_inicio(uuid);
alter table public.vat_book_entry drop column if exists import_run_id;
alter table public.customer_invoice drop column if exists import_run_id;
alter table public.supplier_invoice drop column if exists import_run_id;
