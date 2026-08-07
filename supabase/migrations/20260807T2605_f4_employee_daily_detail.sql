-- Aplicada 2026-08-07. Verificado con Marlón julio: jornada 12/07 19:45-08:01 marcada como posible olvido.
-- F4.3 · RPC de la Ficha. Día a día anclado a la ENTRADA (F1.4) via team_worked_shifts. Bandera de olvido
-- de fichaje (presencia >11h o salida de madrugada) para pintar en ámbar, no contar como jornada real.
create or replace function public.employee_daily_detail(
  p_employee_id uuid, p_from date, p_to date
) returns table(
  work_date date, started_at timestamptz, ended_at timestamptz,
  worked_minutes numeric, presence_minutes numeric, break_minutes numeric,
  night_minutes numeric, looks_like_forgotten_clockout boolean
)
language sql stable
as $function$
  select
    (w.started_at at time zone 'Europe/Madrid')::date as work_date,
    w.started_at, w.ended_at,
    w.minutes, w.presence_minutes, w.break_minutes,
    public.night_minutes_in_span(w.started_at, w.ended_at) as night_minutes,
    (w.presence_minutes > 660
      or extract(hour from w.ended_at at time zone 'Europe/Madrid') between 4 and 10) as looks_like_forgotten_clockout
  from public.team_worked_shifts(
        (select account_id from public.employees where id = p_employee_id),
        p_from::timestamptz, (p_to + 1)::timestamptz) w
  where w.employee_id = p_employee_id
  order by w.started_at;
$function$;
grant execute on function public.employee_daily_detail(uuid,date,date) to authenticated, service_role;
