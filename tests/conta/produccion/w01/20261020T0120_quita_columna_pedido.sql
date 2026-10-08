-- Ejemplo W01: borrar una columna de una tabla del pedido que existe (contraer).
alter table public.sale drop column if exists rider_seen_at;
