-- DEUDA DE RENDIMIENTO (07/08) · Causa raíz de los 500 intermitentes en Calendario:
-- 5 funciones (team_labor_requirement, team_demand_forecast, team_demand_profile, team_demand_by_hour,
-- team_sales_by_location) repiten la MISMA agregación sale × sale_line × menu_item × menu_category.
-- Medido: Planning 251ms + Execution 269ms por llamada, con Seq Scan de sale_line (19.207 filas) x4.
-- Con ~25 llamadas concurrentes al montar Calendario -> satura el pool -> 500. Y EMPEORA al crecer ventas.
--
-- Solución: tabla de agregación por cuenta/local/fecha/hora/demand_kind.
-- Se guarda SIN filtrar por counted_kinds: así sirve para cualquier configuración (se resuelve sumando),
-- y un cambio de config del cliente no invalida el caché.
create table if not exists public.sales_hourly_agg (
  account_id uuid not null,
  location_id uuid not null,
  day date not null,
  hour smallint not null,
  demand_kind text not null,
  units numeric not null default 0,
  tickets int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, location_id, day, hour, demand_kind)
);
comment on table public.sales_hourly_agg is
  'Agregación de ventas por local/día/hora/demand_kind. Evita reescanear sale_line en las funciones de demanda.';
create index if not exists idx_sales_hourly_agg_lookup
  on public.sales_hourly_agg(account_id, location_id, day);

alter table public.sales_hourly_agg enable row level security;
drop policy if exists sales_hourly_agg_select on public.sales_hourly_agg;
create policy sales_hourly_agg_select on public.sales_hourly_agg
  for select to authenticated using (account_id = any(current_user_account_ids()));
revoke all on public.sales_hourly_agg from anon, public;
grant select on public.sales_hourly_agg to authenticated;
grant all on public.sales_hourly_agg to service_role;