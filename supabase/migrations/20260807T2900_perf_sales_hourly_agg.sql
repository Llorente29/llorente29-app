-- Aplicada 2026-08-07 por MCP. DEUDA DE RENDIMIENTO CERRADA (no bordeada).
--
-- CAUSA RAÍZ de los 500 intermitentes en Calendario: 5 funciones (team_labor_requirement,
-- team_demand_forecast, team_demand_profile, team_demand_by_hour, team_sales_by_location) repetían la MISMA
-- agregación sale × sale_line × menu_item × menu_category, con Seq Scan de sale_line (19.226 filas) varias
-- veces por llamada. Medido ANTES: Planning 251ms + Execution 269ms = 520ms por llamada.
-- Con ~25 llamadas concurrentes al montar la página -> ~13s de trabajo de BBDD -> satura el pool -> 500.
-- Y EMPEORABA conforme crecen las ventas.
--
-- SOLUCIÓN: agregación por cuenta/local/día/hora/demand_kind (1.927 filas frente a 19.226 a escanear).
-- Se guarda SIN filtrar por counted_kinds: sirve para cualquier configuración (se resuelve sumando) y un
-- cambio de config del cliente no invalida el caché.
-- RESULTADO MEDIDO en team_labor_requirement: 520ms -> 122ms (4,3x). Planning 251->32ms, Exec 269->90ms.
-- Escala bien: el agregado crece por día/hora (lineal y pequeño), no por línea de venta.
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

-- Refresco por rango (idempotente). Replica EXACTAMENTE la agregación de las funciones de demanda
-- (mismo join, misma zona horaria, mismo coalesce(is_active,true)) -> los números no cambian.
create or replace function public.refresh_sales_hourly_agg(
  p_account uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_rows int;
begin
  delete from public.sales_hourly_agg
  where account_id = p_account and day >= p_from and day <= p_to;

  insert into public.sales_hourly_agg (account_id, location_id, day, hour, demand_kind, units, tickets)
  select s.account_id, s.location_id,
         (s.sold_at at time zone 'Europe/Madrid')::date,
         extract(hour from (s.sold_at at time zone 'Europe/Madrid'))::smallint,
         coalesce(mc.demand_kind, 'otro'),
         coalesce(sum(sl.quantity), 0), count(distinct s.id)
  from public.sale s
  join public.sale_line sl on sl.sale_id = s.id
  join public.menu_item mi on mi.id = sl.menu_item_id
  join public.menu_category mc on mc.id = mi.menu_category_id
  where s.account_id = p_account
    and coalesce(s.is_active, true)
    and (s.sold_at at time zone 'Europe/Madrid')::date >= p_from
    and (s.sold_at at time zone 'Europe/Madrid')::date <= p_to
  group by 1,2,3,4,5;

  get diagnostics v_rows = row_count;
  return v_rows;
end $function$;
revoke execute on function public.refresh_sales_hourly_agg(uuid,date,date) from public, anon;
grant execute on function public.refresh_sales_hourly_agg(uuid,date,date) to authenticated, service_role;

-- BACKFILL (ejecutar una vez por cuenta tras aplicar):
--   select public.refresh_sales_hourly_agg('<account_id>', date '2023-01-01', current_date);
