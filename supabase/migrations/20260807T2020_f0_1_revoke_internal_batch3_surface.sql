-- Aplicada: 2026-08-07 por MCP. Verificado: las 23 sin anon; anon-exec DEFINER 281 -> 258.
-- Verificado además: is_brand_open lo llaman shop_* (todas SECURITY DEFINER -> anidado como owner);
-- resolve_delivery_zone no lo llama ninguna función SQL (edge/service_role); la auto-impresión inserta en
-- print_job directamente y el agente lee por claim_print_jobs/order_for_print (conservadas).
-- F0.1 (lote 3, cierre del revoke) · funciones de superficie que NO aparecen en el front (grep vacío):
-- se usan anidadas (owner), por cron o por edges (service_role). Revoke public+anon + re-grant.
-- Reversible: grant execute on function <sig> to anon.
do $$
declare r record;
  v_names text[] := array[
    'resolve_delivery_zone','is_brand_open','brand_status','location_status','closed_brands','brands_for_closure','adapt_folvy_shop_order',
    'delete_printer','upsert_printer','list_printers','enqueue_test_print','enqueue_print_job',
    'sale_delivery_distance_km','location_surge_pct','location_surge_reason','resolve_dispatch','delivery_watchdog_scan','dispatch_watchdog_scan',
    'availability_notices','availability_ack_notice','enqueue_customer_notification','enqueue_training_notice','set_customer_notify'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(v_names)
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
