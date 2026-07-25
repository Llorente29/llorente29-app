-- 20260725T1200_sellar_entrega.sql
-- ============================================================================
-- SELLA sale.delivered_at al confirmar la entrega (para el TIEMPO DE REPARTO).
-- ============================================================================
-- handed_to_courier_at casi nunca se sella (Catcher emite delivery_state='in_delivery'
-- ~1 de cada 454), así que sin esto no habría hito de FIN de reparto. Este trigger
-- sella delivered_at cuando el broker reporta la entrega (delivery_state 'delivered'
-- o 'finish'). El tiempo de reparto = delivered_at − coalesce(handed_to_courier_at,
-- ready_at); si no hubo handoff sellado, se mide desde "Listo" y se etiqueta como tal.
--
-- YA APLICADA A MANO en producción (25/07/2026). Este fichero la VERSIONA (registro;
-- NO re-ejecutar por db push). Reconstruida EXACTA desde la BBDD (fuente de verdad:
-- pg_get_functiondef + pg_get_triggerdef). Idempotente.
-- ============================================================================

alter table public.sale add column if not exists delivered_at timestamptz;

create or replace function public.tg_sale_seal_delivered()
returns trigger
language plpgsql
as $function$
begin
  if new.delivery_state is distinct from old.delivery_state
     and new.delivery_state in ('delivered','finish')
     and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sale_seal_delivered on public.sale;
create trigger trg_sale_seal_delivered
  before update on public.sale
  for each row execute function public.tg_sale_seal_delivered();
