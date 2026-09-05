-- F1.5 · Nocturnidad (art. 36 ET). Se computa por SOLAPAMIENTO REAL con la franja nocturna, nunca por
-- la hora de salida: salir a las 22:10 son 10 min nocturnos, no una jornada nocturna.
-- Franja configurable por convenio (por defecto 22:00-06:00, ET art. 36.1).
-- En Sesame esto es add-on desde 13 EUR/empleado/mes; en Folvy es nativo.
alter table public.break_policy add column if not exists night_start time not null default '22:00';
alter table public.break_policy add column if not exists night_end   time not null default '06:00';
alter table public.break_policy add column if not exists night_bonus_pct numeric;  -- plus % s/hora ordinaria
alter table public.break_policy add column if not exists night_worker_pct_threshold numeric default 33.33;
-- ^ % de jornada en franja para considerar "trabajador nocturno" (ET: 3h de jornada diaria o 1/3 anual)

comment on column public.break_policy.night_worker_pct_threshold is
  'Umbral %% de horas en franja para clasificar trabajador nocturno (ET art. 36.1: 1/3 de jornada).';

-- Minutos de una franja horaria [p_from, p_to) que caen en la ventana nocturna.
create or replace function public.night_minutes_in_span(
  p_from timestamptz, p_to timestamptz,
  p_night_start time default '22:00', p_night_end time default '06:00',
  p_tz text default 'Europe/Madrid'
) returns numeric
language sql
immutable
as $$
  select coalesce(sum(greatest(0, extract(epoch from (
           least(p_to, w.fin) - greatest(p_from, w.ini)
         )) / 60.0)), 0)::numeric
  from (
    select ((d + p_night_start) at time zone p_tz) as ini,
           ((d + case when p_night_end <= p_night_start then interval '1 day' else interval '0' end
               + p_night_end) at time zone p_tz) as fin
    from generate_series(
           ((p_from at time zone p_tz)::date - 1),
           ((p_to   at time zone p_tz)::date + 1),
           interval '1 day') d
  ) w;
$$;

comment on function public.night_minutes_in_span is
  'F1.5 Minutos de la jornada que caen en franja nocturna (solapamiento real). Soporta franja que cruza medianoche.';

revoke execute on function public.night_minutes_in_span(timestamptz,timestamptz,time,time,text) from public, anon;
grant execute on function public.night_minutes_in_span(timestamptz,timestamptz,time,time,text) to authenticated, service_role;