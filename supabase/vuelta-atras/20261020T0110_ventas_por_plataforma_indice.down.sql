-- Vuelta atrás de 20261020T0110: el índice de un resumen por día y local.
-- PARA si ya hay más de un resumen el mismo día y local (unidades propuestas):
-- antes hay que deshacer la 0130 y la 0120, o retirar esas unidades a mano.
do $$
begin
  if exists (select 1 from public.sales_day_summary group by company_id, location_id, sales_day having count(*) > 1) then
    raise exception 'Vuelta atrás de la 0110: hay días con más de un resumen (unidades); no se puede volver a un resumen por día.';
  end if;
end $$;
create unique index if not exists ux_sales_day_summary on public.sales_day_summary (company_id, location_id, sales_day);
drop index if exists public.ux_sales_day_summary_unidad;
drop index if exists public.ux_sales_day_summary_dia;
