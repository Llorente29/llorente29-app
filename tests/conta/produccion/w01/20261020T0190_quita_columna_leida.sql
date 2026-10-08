-- Ejemplo W01: borrar una columna que el front LEE todavía (supplier.name).
alter table public.supplier drop column if exists name;
