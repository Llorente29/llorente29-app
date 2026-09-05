create table if not exists public.licensed_settlement (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  location_id uuid references public.locations(id),
  settlement_ref text,
  period_from date not null,
  period_to date not null,
  period_grain text default 'month',
  service_revenue numeric default 0,       -- revenue share base (Servicio Ventas Multimarcas + Reparto Propio)
  materials_supplied numeric default 0,    -- Mercaderías Aportadas por el Partner (base)
  stock_invoice_cost numeric default 0,    -- Mercaderías en Stock (base) que CTB factura a Llorente
  food_cost numeric default 0,             -- consumo materia prima (Compras y Ventas)
  packaging_cost numeric default 0,        -- consumo packaging (Compras y Ventas)
  net_settlement numeric default 0,        -- Saldo a Ingresar (con IVA)
  source text default 'ctb_settlement',
  import_key text unique,
  raw jsonb,
  created_at timestamptz default now()
);

alter table public.licensed_settlement enable row level security;

drop policy if exists licensed_settlement_read on public.licensed_settlement;
create policy licensed_settlement_read on public.licensed_settlement
  for select using (account_id = any(public.current_user_account_ids()));

drop policy if exists licensed_settlement_write on public.licensed_settlement;
create policy licensed_settlement_write on public.licensed_settlement
  for all using (public.current_user_is_admin_of(account_id))
  with check (public.current_user_is_admin_of(account_id));