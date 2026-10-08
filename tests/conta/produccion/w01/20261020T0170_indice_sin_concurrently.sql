-- Ejemplo W01: índice sin concurrently sobre la tabla de ventas.
create index if not exists sale_created_at_w01 on public.sale (created_at);
