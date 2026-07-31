-- 20260731T1120_availability_open_hours.sql
-- ============================================================================
-- DISPONIBILIDAD · C3a — HORAS DE APERTURA (§4, denominador del uptime).
--
-- RECON (encargo, hecho 31/07): el horario semanal vive en `business_hours`
-- (20260626T1400) — el mismo que edita/guarda `BusinessHoursEditor.tsx` vía
-- `businessHoursService.getHours/replaceHours` (push_location_opening_hours
-- solo EMPUJA a HubRise, no es la fuente; la fuente es esta tabla).
-- Columnas: location_id, brand_id (NULL=horario general del local), weekday
-- smallint 0-6, open_time/close_time time. weekday=0 es DOMINGO (comentario
-- de businessHoursService.ts) — coincide con extract(dow from date) nativo de
-- Postgres (0=domingo..6=sábado), así que el cruce es directo, sin conversión
-- al dow "isodow-1" que usa el resto de C3a (ese otro dow es 0=lunes, y se
-- usa solo en sales_profile/heatmap — aquí NO hace falta, este helper no
-- devuelve dow, devuelve intervalos concretos).
--
-- ALCANCE DECLARADO (decisión de esta sesión, sin maqueta que arbitrar):
-- este helper expande el horario GENERAL del local (brand_id IS NULL)
-- ÚNICAMENTE. NO resuelve horario por-marca (una marca con horario propio
-- distinto del general no se refleja aquí). El uptime de C3a (RPC principal)
-- se calcula por eso a nivel LOCAL, no por marca/producto — ver cabecera de
-- availability_report. Deuda declarada para una iteración futura si Julio
-- quiere uptime por marca.
--
-- NO cubre `business_hours_exception` (festivos/días especiales): un local
-- cerrado por excepción sigue contando sus horas habituales como "apertura
-- esperada". Deuda declarada (el propio BusinessHoursEditor ya avisa que las
-- excepciones no se sincronizan con HubRise por el mismo motivo de alcance).
--
-- Cruce de medianoche: igual criterio que BusinessHoursEditor.crossesMidnight
-- (close_time <= open_time -> cierra al día siguiente).
--
-- SECURITY INVOKER (RLS de business_hours: bh_read permite lectura abierta,
-- pero esto solo se llama desde availability_report, que SÍ guarda con
-- current_user_is_admin_or_manager_of).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.availability_location_open_minutes(
  p_location_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
)
returns table (
  opened_from  timestamptz,
  opened_until timestamptz
)
language sql
stable
as $function$
  with days as (
    select d::date as day
    from generate_series(
      (p_from at time zone 'Europe/Madrid')::date,
      (p_to   at time zone 'Europe/Madrid')::date,
      interval '1 day'
    ) d
  ),
  hours as (
    select weekday, open_time, close_time
    from public.business_hours
    where location_id = p_location_id and brand_id is null
  ),
  expanded as (
    select
      ((d.day + h.open_time)::timestamp at time zone 'Europe/Madrid') as opened_from,
      case when h.close_time <= h.open_time
        then (((d.day + 1) + h.close_time)::timestamp at time zone 'Europe/Madrid')
        else ((d.day + h.close_time)::timestamp at time zone 'Europe/Madrid')
      end as opened_until
    from days d
    join hours h on h.weekday = extract(dow from d.day)::int
  )
  select
    greatest(e.opened_from, p_from) as opened_from,
    least(e.opened_until, p_to) as opened_until
  from expanded e
  where e.opened_from < p_to and e.opened_until > p_from
$function$;

grant execute on function public.availability_location_open_minutes(uuid, timestamptz, timestamptz) to authenticated;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.availability_location_open_minutes(uuid, timestamptz, timestamptz)') is null then
    raise exception 'availability_location_open_minutes no quedó creada con la firma esperada';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- 1) Horas de apertura de un local real en la última semana (comparar a mano
-- contra lo que ves en Disponibilidad > Horarios para ese local):
-- select opened_from, opened_until, opened_until - opened_from as duracion
-- from availability_location_open_minutes('<<LOCATION_ID>>', now() - interval '7 days', now())
-- order by opened_from;
--
-- 2) Total de horas de apertura en el periodo:
-- select sum(extract(epoch from (opened_until - opened_from)) / 3600)
-- from availability_location_open_minutes('<<LOCATION_ID>>', now() - interval '7 days', now());
--
-- 3) Local con tramo que cruza medianoche (viernes 13:00-03:45, visto en la
-- captura de Disponibilidad > Horarios) -> confirmar que aparece como UN
-- intervalo que atraviesa la medianoche, no cortado a las 00:00.
