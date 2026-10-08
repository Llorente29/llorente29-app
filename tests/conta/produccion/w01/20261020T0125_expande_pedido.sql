-- Ejemplo W01: expandir la misma tabla (columna nueva y copiar datos). Con la
-- 0120 en la misma tanda, es expandir y contraer a la vez: van en dos tandas.
alter table public.sale add column if not exists rider_seen_label text;
