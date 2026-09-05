-- ENCARGO CODE (21/08) §4 — el vigía de los 8 minutos distingue las dos causas:
--   dispatch_error ya tiene algo  -> «No se pudo enviar a Catcher: <motivo>»
--   dispatch_error vacío          -> «Enviado a Catcher, sin rider tras N min…»
-- No prefija dos veces: el vigía sólo alcanza cada pedido una vez
-- (delivery_alarm_at is null en los candidatos, y el UPDATE lo pone).
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
       and coalesce(l.dispatch_mode,'auto') = 'auto'
       and s.order_status in ('accepted','in_preparation','awaiting_collection')
       and s.carrier_order_id is null
       and s.delivery_alarm_at is null
       and s.created_at > now() - interval '24 hours'
       and now() - coalesce(s.accepted_at, s.created_at) > make_interval(mins => greatest(p_grace_minutes,1))
       and not exists (
         select 1 from public.delivery_assignment da
          where da.sale_id = s.id and da.state not in ('failed','canceled'))
  )
  update public.sale s
     set delivery_alarm_at    = now(),
         delivery_alarm_kind   = 'no_rider',
         delivery_alarm_ack_at = null,
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