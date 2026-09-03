-- A6 · 03/09/2026 — CERRAR LA VENTA CUANDO EL PEDIDO SE COMPLETA.
-- ===========================================================================
-- POR QUE AQUI Y NO EN LA EDGE FUNCTION:
--   La ficha de A6 culpaba a `hubrise-order-status` de no llamar a close_sale.
--   Es cierto (v45, comprobado), pero medido el 03/09 sobre las 230 ventas
--   atascadas: 146 son de hubrise, 83 de lastapp y 1 de folvy_shop. Arreglar
--   la edge function dejaba UN TERCIO fuera. La transicion a 'completed' pasa
--   siempre por la BBDD, asi que el guardian va en la BBDD.
--
-- POR QUE SOLO EN UPDATE (y NO en INSERT):
--   Medido: las 230 atascadas llegaron a 'completed' por UPDATE — CERO nacieron
--   ya completadas. Cubrir el INSERT no arregla ningun caso observado y en
--   cambio abriria un riesgo real: una importacion historica (backfill CSV)
--   dispararia close_sale -> compute_sale_line_cost, que costea con la receta
--   de HOY. Eso es exactamente B44, y no se mete por la puerta de atras.
--
-- RECURSION: close_sale hace UPDATE sobre la misma fila. La clausula WHEN exige
--   que `order_status` CAMBIE; en la reentrada no cambia, asi que no dispara.
--   Por el mismo motivo no re-disparan trg_sale_consumption_on_complete ni
--   trg_sale_push_status, que tambien miran el cambio de order_status.
--
-- CONSECUENCIA MEDIDA (regla 11): la pantalla de cocina de Alcala pasa de 190
--   tickets vivos a 11, la de Carabanchel de 82 a 31. kds_board deja el ticket
--   vivo mientras status <> 'closed', y una venta atascada no caia nunca.

create or replace function public.tg_sale_close_on_complete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.close_sale(new.id);
  return null;
end;
$function$;

comment on function public.tg_sale_close_on_complete() is
  'A6: sella la venta (close_sale) cuando order_status pasa a completed. Solo UPDATE, a proposito — ver cabecera de la migracion 20260903 trg_sale_close_on_complete.';

drop trigger if exists trg_sale_close_on_complete on public.sale;

create trigger trg_sale_close_on_complete
after update on public.sale
for each row
when (
      new.order_status = 'completed'
  and old.order_status is distinct from new.order_status
  and coalesce(new.status, '') not in ('cancelled', 'closed')
  and coalesce(new.is_active, true)
)
execute function public.tg_sale_close_on_complete();
