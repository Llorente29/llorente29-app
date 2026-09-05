-- F5.1 · Datos del PDF de REGISTRO DE JORNADA (RD-ley 8/2019, art. 34.9 ET).
-- Requisitos legales que cumple: identificación de empresa y trabajador, registro DIARIO con hora de
-- inicio y fin, totales, y conservación 4 años. Las horas son las REALES (real_datetime vía
-- team_worked_shifts), NUNCA las redondeadas: el redondeo no es oponible en inspección.
-- Devuelve una fila por día del periodo (incluidos los NO trabajados, que en el registro deben constar
-- como sin jornada, no desaparecer).
create or replace function public.registro_jornada_mensual(
  p_employee_id uuid, p_from date, p_to date
) returns table(
  dia date,
  entrada timestamptz, salida timestamptz,
  minutos_trabajados numeric, minutos_pausa numeric, minutos_nocturnos numeric,
  es_festivo boolean, festivo_nombre text,
  ausencia_tipo text
)
language sql stable
as $function$
  with dias as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  acc as (select account_id, location_id from public.employees where id = p_employee_id),
  jor as (
    select (w.started_at at time zone 'Europe/Madrid')::date as d,
           w.started_at, w.ended_at, w.minutes, w.break_minutes,
           public.night_minutes_in_span(w.started_at, w.ended_at) as night
    from public.team_worked_shifts((select account_id from acc),
           p_from::timestamptz, (p_to + 1)::timestamptz) w
    where w.employee_id = p_employee_id
  ),
  fest as (
    select h.holiday_date, h.name from public.holiday_calendar h
    where (h.account_id is null or h.account_id = (select account_id from acc))
      and h.holiday_date between p_from and p_to
  ),
  aus as (
    select v.start_date, v.end_date, v.type from public.vacations v
    where v.employee_id = p_employee_id and v.status = 'aprobada'
      and v.start_date <= p_to and v.end_date >= p_from
  )
  select dias.d,
         j.started_at, j.ended_at,
         coalesce(j.minutes, 0), coalesce(j.break_minutes, 0), coalesce(j.night, 0),
         (f.holiday_date is not null), f.name,
         (select a.type from aus a where dias.d between a.start_date and a.end_date limit 1)
  from dias
  left join jor j on j.d = dias.d
  left join fest f on f.holiday_date = dias.d
  order by dias.d;
$function$;

grant execute on function public.registro_jornada_mensual(uuid,date,date) to authenticated, service_role;