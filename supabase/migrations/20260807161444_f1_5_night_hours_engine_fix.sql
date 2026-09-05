-- F1.5 (corrección) · La versión anterior construía la ventana como (d + 22:00) -> (d+1 + 06:00) = 32 h
-- en vez de 8 h, y calculaba de más/de menos. Se reescribe: la ventana nocturna de cada día es
-- ini = d + night_start, y fin = ini + duración real de la franja (cruce de medianoche resuelto en la duración).
create or replace function public.night_minutes_in_span(
  p_from timestamptz, p_to timestamptz,
  p_night_start time default '22:00', p_night_end time default '06:00',
  p_tz text default 'Europe/Madrid'
) returns numeric
language sql
immutable
as $$
  with cfg as (
    select case when p_night_end > p_night_start
                then (p_night_end - p_night_start)
                else (interval '24 hours' - (p_night_start - p_night_end))
           end as dur
  ),
  win as (
    select ((d::date + p_night_start) at time zone p_tz) as ini,
           ((d::date + p_night_start) at time zone p_tz) + (select dur from cfg) as fin
    from generate_series(
           ((p_from at time zone p_tz)::date - 1),
           ((p_to   at time zone p_tz)::date + 1),
           interval '1 day') d
  )
  select coalesce(sum(greatest(0, extract(epoch from (
           least(p_to, w.fin) - greatest(p_from, w.ini)
         )) / 60.0)), 0)::numeric
  from win w;
$$;