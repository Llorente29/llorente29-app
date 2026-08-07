-- Aplicada 2026-08-07. Verificado sobre julio 2026: 6 empleados con DNI, horas y las incidencias reales
-- (los 6 "sin descansos registrados", Marlón con "posible fichaje de salida olvidado", Mirlenys -83,3h).
-- F5.2 · EXPORT MENSUAL A GESTORÍA. Una fila por empleado con lo que el asesor necesita para la nómina.
-- Acotado por cuenta (nunca mezcla inquilinos).
-- 'incidencias' es la pieza que lo hace honesto: avisa de lo que impide cerrar el mes con confianza.
-- Sin ello el asesor calcula sobre datos sucios sin saberlo.
create or replace function public.export_gestoria_mensual(
  p_account uuid, p_from date, p_to date
) returns table(
  empleado text, dni text, local text,
  dias_trabajados int, horas_trabajadas numeric, horas_nocturnas numeric,
  dias_vacaciones int, dias_baja int, dias_festivo_trabajado int,
  horas_contratadas numeric, delta_horas numeric,
  incidencias text
)
language sql stable
as $function$
  select e.name, e.dni, l.name,
    t.dias_trabajados, t.horas_trabajadas, t.horas_nocturnas,
    t.dias_vacaciones, t.dias_baja, t.dias_festivo_trabajado,
    t.horas_contratadas, t.delta_horas,
    nullif(concat_ws(' · ',
      case when e.dni is null or e.dni = '' then 'SIN DNI' end,
      case when t.horas_pausa = 0 and t.horas_trabajadas > 0 then 'sin descansos registrados' end,
      case when abs(t.delta_horas) > 20 then 'desvío de '||round(t.delta_horas,1)||' h sobre contrato' end,
      case when exists (
        select 1 from public.registro_jornada_mensual(e.id, p_from, p_to) r
        where r.salida is not null
          and extract(hour from (r.salida at time zone 'Europe/Madrid')) between 4 and 10
      ) then 'posible fichaje de salida olvidado' end
    ), '')
  from public.employees e
  join public.locations l on l.id = e.location_id
  cross join lateral public.registro_jornada_totales(e.id, p_from, p_to) t
  where e.account_id = p_account and e.active
  order by e.name;
$function$;
grant execute on function public.export_gestoria_mensual(uuid,date,date) to authenticated, service_role;
