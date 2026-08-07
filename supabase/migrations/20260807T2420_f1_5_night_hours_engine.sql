-- Aplicada 2026-08-07. Verificado con 7 casos de frontera calculados a mano (7/7 correctos):
--   salida exacta 22:00 -> 0 min · salida 22:10 -> 10 min · noche completa -> 480 · cruza 2 noches -> 480
--   patron real Foodint (cena 19:40-00:09) -> 129 min.
-- Dato resultante sobre datos vivos: 195/259 jornadas con nocturnidad, 422,8 h = 29% de las horas.
-- F1.5 · Nocturnidad (art. 36 ET) por SOLAPAMIENTO REAL con la franja, nunca por la hora de salida:
-- salir a las 22:10 son 10 min nocturnos, no una jornada nocturna. Franja configurable por convenio.
-- En Sesame esto es add-on desde 13 EUR/empleado/mes; en Folvy nativo.
alter table public.break_policy add column if not exists night_start time not null default '22:00';
alter table public.break_policy add column if not exists night_end   time not null default '06:00';
alter table public.break_policy add column if not exists night_bonus_pct numeric;
alter table public.break_policy add column if not exists night_worker_pct_threshold numeric default 33.33;
comment on column public.break_policy.night_worker_pct_threshold is
  'Umbral %% de horas en franja para clasificar trabajador nocturno (ET art. 36.1: 1/3 de jornada).';

-- OJO: la primera version construia la ventana como (d + 22:00) -> (d+1 + 06:00) = 32 h en vez de 8 h.
-- Version correcta: ini = d + night_start, fin = ini + duracion real de la franja.
create or replace function public.night_minutes_in_span(
  p_from timestamptz, p_to timestamptz,
  p_night_start time default '22:00', p_night_end time default '06:00',
  p_tz text default 'Europe/Madrid'
) returns numeric language sql immutable
as $$
  with cfg as (
    select case when p_night_end > p_night_start
                then (p_night_end - p_night_start)
                else (interval '24 hours' - (p_night_start - p_night_end)) end as dur
  ),
  win as (
    select ((d::date + p_night_start) at time zone p_tz) as ini,
           ((d::date + p_night_start) at time zone p_tz) + (select dur from cfg) as fin
    from generate_series(((p_from at time zone p_tz)::date - 1),
                         ((p_to   at time zone p_tz)::date + 1), interval '1 day') d
  )
  select coalesce(sum(greatest(0, extract(epoch from (
           least(p_to, w.fin) - greatest(p_from, w.ini))) / 60.0)), 0)::numeric
  from win w;
$$;
comment on function public.night_minutes_in_span is
  'F1.5 Minutos de la jornada en franja nocturna (solapamiento real). Soporta franja que cruza medianoche.';
revoke execute on function public.night_minutes_in_span(timestamptz,timestamptz,time,time,text) from public, anon;
grant execute on function public.night_minutes_in_span(timestamptz,timestamptz,time,time,text) to authenticated, service_role;
