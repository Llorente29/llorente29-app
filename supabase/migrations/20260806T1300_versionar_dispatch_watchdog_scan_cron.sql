-- ============================================================================
-- Folvy · VERSIONAR DRIFT: dispatch_watchdog_scan + su cron (registro de lo vivo)
-- ----------------------------------------------------------------------------
-- Vigía del auto-despacho: marca alarma 'no_rider' en pedidos own_delivery en
-- modo 'auto' que llevan sin rider más de p_grace_minutes. Vive en producción
-- desde ~julio 2026 (hermano de delivery_watchdog_scan, ese sí versionado en
-- 20260724T2320). Nunca se había versionado — hallado en el RECON de drifts.
--
-- Es un volcado VERBATIM de pg_get_functiondef de lo vivo + el cron.schedule que
-- ya existe en producción (cron.job jobid 25, jobname 'dispatch-watchdog',
-- schedule '*/3 * * * *'). NO reintroduce ni cambia nada.
--
-- ⚠️ YA ESTÁ APLICADO EN PRODUCCIÓN. Este fichero es un REGISTRO para el repo;
--    NO se vuelve a ejecutar en el SQL Editor. Reaplicarlo sería inocuo
--    (CREATE OR REPLACE idéntico + cron.schedule que hace upsert por nombre).
--
-- Aplicada: (ya viva en producción; versionada como registro)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_watchdog_scan(p_grace_minutes integer DEFAULT 8)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
  with candidatos as (
    select s.id
      from public.sale s
      join public.locations l on l.id = s.location_id
     where s.service_type = 'own_delivery'
       and coalesce(l.dispatch_mode,'auto') = 'auto'          -- solo donde SÍ debe auto-despachar
       and s.order_status in ('accepted','in_preparation','awaiting_collection')
       and s.carrier_order_id is null                          -- sin rider
       and s.delivery_alarm_at is null                         -- aún sin alarmar
       and s.created_at > now() - interval '24 hours'
       and now() - coalesce(s.accepted_at, s.created_at) > make_interval(mins => greatest(p_grace_minutes,1))
       and not exists (                                        -- ni por flota propia (delivery_assignment)
         select 1 from public.delivery_assignment da
          where da.sale_id = s.id and da.state not in ('failed','canceled'))
  )
  update public.sale s
     set delivery_alarm_at    = now(),
         delivery_alarm_kind   = 'no_rider',
         delivery_alarm_ack_at = null,
         dispatch_error        = coalesce(s.dispatch_error,
                                   'Auto-despacho SIN CONFIRMAR: sin rider tras ' || p_grace_minutes || ' min. Revisar/despachar a mano.'),
         updated_at            = now()
    from candidatos c
   where s.id = c.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Cron vivo: cada 3 minutos. cron.schedule hace upsert por jobname → idempotente.
select cron.schedule('dispatch-watchdog', '*/3 * * * *', $$ select public.dispatch_watchdog_scan(); $$);
