-- 20260821T1700_vigia_distingue_causa.sql
-- ENCARGO CODE (21/08) «El despacho al repartidor no sale en los pedidos de
-- HubRise» — §4, segunda mitad. Deuda B36 con nombre y apellidos.
--
-- ── El problema ──────────────────────────────────────────────────────────
-- El vigía de los 8 minutos escribía SIEMPRE el mismo texto:
--
--   «Auto-despacho SIN CONFIRMAR: sin rider tras 8 min. Revisar/despachar a mano.»
--
-- Y ese texto esconde DOS causas opuestas:
--
--   Glovo por Last (42 pedidos)     Catcher SÍ recibió el pedido y ningún
--                                   rider lo confirmó en 8 minutos.
--   Just Eat por HubRise (12)       Catcher NUNCA recibió el pedido.
--
-- Son problemas contrarios con el mismo aviso en pantalla. Por eso llevaba
-- desde el 13/08 sin diagnosticarse.
--
-- ── El arreglo ───────────────────────────────────────────────────────────
-- catcher-dispatch (v49/v50, 21/08) ya escribe su motivo en dispatch_error en
-- todo camino que no llega a crear el pedido en Catcher. Aquí el vigía deja de
-- aplastar esa información con un coalesce y DISTINGUE:
--
--   dispatch_error ya tiene algo  ->  «No se pudo enviar a Catcher: <motivo>»
--   dispatch_error está vacío     ->  «Enviado a Catcher, sin rider tras N min…»
--
-- No hay riesgo de prefijar dos veces: el vigía sólo alcanza cada pedido UNA
-- vez (la lista de candidatos exige delivery_alarm_at is null, y lo primero que
-- hace el UPDATE es ponerlo).
--
-- Lo demás de la función NO se toca: mismos candidatos, mismo cron (jobid 25,
-- '*/3 * * * *'), misma firma. Sólo cambia el texto que escribe.

create or replace function public.dispatch_watchdog_scan(p_grace_minutes integer default 8)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
         -- ENCARGO CODE (21/08) §4 — DOS CAUSAS, DOS MENSAJES. Un aviso que no
         -- dice cuál de los dos problemas es no sirve para arreglar ninguno.
         dispatch_error        = case
           when s.dispatch_error is not null and btrim(s.dispatch_error) <> ''
             then 'No se pudo enviar a Catcher: ' || s.dispatch_error
           else 'Enviado a Catcher, sin rider tras ' || p_grace_minutes || ' min. Revisar/despachar a mano.'
         end,
         updated_at            = now()
    from candidatos c
   where s.id = c.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Verificación: que quede la función con los dos mensajes y una sola firma.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='dispatch_watchdog_scan') <> 1 then
    raise exception 'debería quedar EXACTAMENTE una dispatch_watchdog_scan';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='dispatch_watchdog_scan'
        and pg_get_functiondef(p.oid) like '%No se pudo enviar a Catcher%'
        and pg_get_functiondef(p.oid) like '%Enviado a Catcher, sin rider%') then
    raise exception 'el vigía no quedó distinguiendo las dos causas';
  end if;
end $$;
