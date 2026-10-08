-- Ejemplo W01: columna que admite vacío en una tabla que EXISTE y está en el camino del pedido.
alter table public.sales_day_summary add column if not exists nota text;
