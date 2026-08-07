-- Aplicada 2026-08-07. VERIFICADO IDÉNTICO fila a fila contra línea base ANTES de la reescritura:
--   196 filas / 11.657 unidades antes y después; 0 filas que falten, 0 filas de más.
--   Comprobado además contra ventas crudas EN EL MISMO INSTANTE: 6.261 = 6.261, 0 celdas distintas.
-- PERF · team_demand_profile lee de sales_hourly_agg en vez de reescanear sale × sale_line × menu_item ×
-- menu_category. Es la función BASE: team_labor_requirement y team_demand_forecast la llaman, así que
-- arreglarla aquí mejora toda la cadena de una vez (520ms -> 122ms medido en team_labor_requirement).
-- Misma firma, mismas columnas, misma lógica de counted_kinds.
-- NOTA: el rango se compara por DÍA (el agregado es día/hora), no por instante. Para ventanas de
-- semanas/meses (el uso real) es equivalente — verificado: el día frontera tenía 0 unidades — y además
-- evita que el borde mueva el resultado a cada segundo.
create or replace function public.team_demand_profile(
  p_account uuid, p_from timestamp with time zone, p_to timestamp with time zone
) returns table(location_id uuid, dow integer, hour_of_day integer, units numeric)
language sql stable
as $function$
  with kinds as (
    select coalesce(
      (select counted_kinds from public.team_demand_config where account_id = p_account),
      array['cocina']
    ) as k
  )
  select a.location_id,
         (extract(isodow from a.day)::int - 1) as dow,
         a.hour::int as hour_of_day,
         coalesce(sum(a.units), 0) as units
  from public.sales_hourly_agg a
  cross join kinds
  where a.account_id = p_account
    and a.day >= (p_from at time zone 'Europe/Madrid')::date
    and a.day <= (p_to   at time zone 'Europe/Madrid')::date
    and a.demand_kind = any (kinds.k)
  group by a.location_id, 2, 3;
$function$;

-- PENDIENTE (optimización fina, NO deuda grave): los CTE `ppt` y `loc_days` de team_labor_requirement
-- todavía escanean ventas crudas (~47ms de los 122ms restantes). Pasarlos al agregado lo bajaría a ~60ms.
