-- 20260709T1900_team_report_functions.sql
-- Folvy Team — Informes v2 (Bloque A): base de cálculo server-side.
-- Tres funciones de solo lectura (SECURITY INVOKER: la RLS del que llama manda):
--   1) team_worked_shifts     → turnos emparejados entrada→salida, con local y minutos.
--   2) team_sales_by_location → ventas, ticket, base y cobertura de coste por local.
--   3) team_sales_by_hour     → ventas por franja horaria (hora local Madrid) y local.
-- El coste laboral (nómina) se cruza en el front por asignación de ficha del empleado.

begin;

-- 1) Turnos trabajados: empareja cada 'entrada' con la siguiente 'salida' del MISMO
--    empleado. Ignora turnos abiertos (sin salida) y anómalos (>16h = olvido de fichar).
--    El local es donde se fichó (location_id_at_clock).
create or replace function public.team_worked_shifts(
  p_account uuid, p_from timestamptz, p_to timestamptz
) returns table (
  employee_id uuid, location_id uuid, started_at timestamptz, ended_at timestamptz, minutes numeric
) language sql stable as $$
  with ordered as (
    select ce.employee_id,
           ce.location_id_at_clock as location_id,
           ce.type, ce.datetime,
           lead(ce.datetime) over (partition by ce.employee_id order by ce.datetime) as next_dt,
           lead(ce.type)     over (partition by ce.employee_id order by ce.datetime) as next_type
    from public.clock_entries ce
    join public.employees e on e.id = ce.employee_id
    where coalesce(ce.voided, false) = false
      and e.location_id in (select id from public.locations where account_id = p_account)
      and ce.datetime >= p_from and ce.datetime < p_to
  )
  select employee_id, location_id, datetime, next_dt,
         round(extract(epoch from (next_dt - datetime)) / 60.0, 1)
  from ordered
  where type = 'entrada' and next_type = 'salida' and next_dt is not null
    and next_dt - datetime < interval '16 hours';
$$;

-- 2) Ventas por local: tickets, importe, base imponible, y cobertura de coste
--    (líneas con computed_cost / líneas totales) para el margen honesto del Bloque B.
create or replace function public.team_sales_by_location(
  p_account uuid, p_from timestamptz, p_to timestamptz
) returns table (
  location_id uuid, tickets bigint, ventas numeric, base numeric,
  coste_lineas numeric, lineas_total bigint, lineas_con_coste bigint
) language sql stable as $$
  with sc as (
    select location_id, count(*)::bigint tickets,
           coalesce(sum(total), 0) ventas, coalesce(sum(taxable_base), 0) base
    from public.sale
    where account_id = p_account and coalesce(is_active, true)
      and sold_at >= p_from and sold_at < p_to
    group by location_id
  ),
  lc as (
    select s.location_id,
           coalesce(sum(sl.computed_cost), 0) coste,
           count(sl.id)::bigint lineas,
           count(sl.computed_cost)::bigint con_coste
    from public.sale s
    join public.sale_line sl on sl.sale_id = s.id
    where s.account_id = p_account and coalesce(s.is_active, true)
      and s.sold_at >= p_from and s.sold_at < p_to
    group by s.location_id
  )
  select sc.location_id, sc.tickets, sc.ventas, sc.base,
         coalesce(lc.coste, 0), coalesce(lc.lineas, 0), coalesce(lc.con_coste, 0)
  from sc left join lc on lc.location_id = sc.location_id;
$$;

-- 3) Ventas por franja horaria (hora local de Madrid) y local → sobre-dimensionado.
create or replace function public.team_sales_by_hour(
  p_account uuid, p_from timestamptz, p_to timestamptz
) returns table (
  location_id uuid, hour_of_day int, tickets bigint, ventas numeric
) language sql stable as $$
  select location_id,
         extract(hour from (sold_at at time zone 'Europe/Madrid'))::int,
         count(*)::bigint, coalesce(sum(total), 0)
  from public.sale
  where account_id = p_account and coalesce(is_active, true)
    and sold_at >= p_from and sold_at < p_to
  group by location_id, 2;
$$;

grant execute on function public.team_worked_shifts(uuid, timestamptz, timestamptz)     to authenticated;
grant execute on function public.team_sales_by_location(uuid, timestamptz, timestamptz)  to authenticated;
grant execute on function public.team_sales_by_hour(uuid, timestamptz, timestamptz)      to authenticated;

commit;
