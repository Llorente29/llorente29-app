-- Ejemplo W01: el mismo índice, con concurrently.
create index concurrently if not exists sale_created_at_w01 on public.sale (created_at);
