-- Ejemplo W01: una tabla NUEVA que se llama como las del pedido (sales_*).
-- El 07/10 la franja la paró por el nombre; la crea la tanda: no está en el camino.
create table if not exists public.sales_hour_summary (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  hora timestamptz not null,
  ventas numeric(12,2) not null default 0
);
alter table public.sales_hour_summary enable row level security;
create policy sales_hour_summary_lectura on public.sales_hour_summary for select using (true);
grant select on public.sales_hour_summary to authenticated;
