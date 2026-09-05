-- F5.1b · Totales del registro de jornada para la cabecera/pie del PDF y para el export de gestoría.
-- Una jornada PARTIDA son dos tramos del mismo día: ambos constan en el detalle (registro_jornada_mensual)
-- y aquí se suman como un solo día trabajado. Los días de ausencia/festivo no cuentan como trabajados.
create or replace function public.registro_jornada_totales(
  p_employee_id uuid, p_from date, p_to date
) returns table(
  dias_trabajados int, tramos int,
  horas_trabajadas numeric, horas_pausa numeric, horas_nocturnas numeric,
  dias_vacaciones int, dias_baja int, dias_festivo_trabajado int,
  horas_contratadas numeric, delta_horas numeric
)
language sql stable
as $function$
  with r as (select * from public.registro_jornada_mensual(p_employee_id, p_from, p_to)),
       b as (select * from public.compute_employee_balance(p_employee_id, p_from, p_to))
  select
    (select count(distinct dia)::int from r where entrada is not null),
    (select count(*)::int from r where entrada is not null),
    (select round(coalesce(sum(minutos_trabajados),0)/60.0, 2) from r),
    (select round(coalesce(sum(minutos_pausa),0)/60.0, 2) from r),
    (select round(coalesce(sum(minutos_nocturnos),0)/60.0, 2) from r),
    (select count(distinct dia)::int from r where ausencia_tipo = 'vacaciones'),
    (select count(distinct dia)::int from r where ausencia_tipo = 'baja_medica'),
    (select count(distinct dia)::int from r where es_festivo and entrada is not null),
    (select contracted_hours from b),
    (select delta_hours from b);
$function$;

grant execute on function public.registro_jornada_totales(uuid,date,date) to authenticated, service_role;