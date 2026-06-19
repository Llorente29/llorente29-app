-- supabase/migrations/20260619T1020_sale_push_trigger.sql
-- ============================================================================
-- PUENTE KDS -> FEED (2/2): el empuje al canal es CONSECUENCIA del cambio de estado.
-- ============================================================================
-- VÍA ÚNICA DE EMPUJE (Opción A): cuando sale.order_status cambia -lo cambie quien
-- lo cambie: feed con sesión (set_order_status) o cocina-kiosco (kds_bump)- este
-- trigger dispara el empuje al canal vía net.http_post a la Edge order-advance.
-- Así el empuje funciona idéntico desde CUALQUIER origen (incluido el kiosco de
-- cocina, que no tiene usuario logueado). Imposible de olvidar.
--
-- FIRE-AND-FORGET: net.http_post encola la petición (net.http_request_queue) y no
-- espera respuesta. Si Last falla, el order_status YA cambió -> la cocina NUNCA se
-- bloquea. (Patrón ya probado en producción por ingestion_monitor.)
--
-- SOLO dispara cuando: (a) el estado REALMENTE cambia (WHEN old<>new), (b) el nuevo
-- estado es empujables, (c) la venta es de un canal con empuje (lastapp hoy).
--
-- SECRET: la frontera la valida el secret en el header (la Edge se despliega con
-- --no-verify-jwt; la autorización la hace x-order-advance-secret). Inline, igual
-- que ingestion_monitor (deuda menor declarada: rotar = cambiar aquí + en el env
-- ORDER_ADVANCE_SECRET de la Edge).
-- ============================================================================

create or replace function public.trg_sale_push_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pushable text[] := array[
    'in_preparation','awaiting_collection','awaiting_shipment',
    'in_delivery','completed','rejected','cancelled','delivery_failed'
  ];
begin
  -- solo canales con empuje y estados empujables
  if new.source = 'lastapp' and new.order_status = any(v_pushable) then
    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/order-advance',
      headers := jsonb_build_object(
        'Content-Type',            'application/json',
        'x-order-advance-secret',  'fv_oadv_CV8IjsPzPIwDIXBPg42FkQMUMJp5Vyde'
      ),
      body    := jsonb_build_object(
        'sale_id',    new.id,
        'new_status', new.order_status,
        'internal',   true
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sale_push_status on public.sale;

create trigger trg_sale_push_status
  after update on public.sale
  for each row
  when (old.order_status is distinct from new.order_status)
  execute function public.trg_sale_push_status();
