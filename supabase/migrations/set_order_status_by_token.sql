-- ============================================================================
-- CAPA 3 · Pedidos por token — set_order_status_by_token
-- ----------------------------------------------------------------------------
-- Variante por token de set_order_status para la Estación de Tablet (sin sesión).
-- Autoriza por TOKEN (kds_resolve_device); cuenta + local salen del dispositivo.
-- Verifica que la venta pertenece a la cuenta Y AL LOCAL del dispositivo (un
-- token no puede mover pedidos de otro local). Mismo UPDATE; el empuje al canal
-- lo dispara el trigger trg_sale_push_status, igual que la de sesión.
-- ============================================================================
create or replace function public.set_order_status_by_token(
  p_device_token text,
  p_sale_id      uuid,
  p_new_status   text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device   kds_device;
  v_acc      uuid;
  v_loc      uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_order_status_by_token: token no válido';
  end if;
  update kds_device set last_seen_at = now() where id = v_device.id;

  select account_id, location_id into v_acc, v_loc from sale where id = p_sale_id;
  if v_acc is null then
    raise exception 'set_order_status_by_token: venta inexistente';
  end if;
  if v_acc <> v_device.account_id then
    raise exception 'set_order_status_by_token: la venta no pertenece a la cuenta del dispositivo';
  end if;
  if v_device.location_id is not null and v_loc is distinct from v_device.location_id then
    raise exception 'set_order_status_by_token: la venta no pertenece al local del dispositivo';
  end if;

  if p_new_status is null or p_new_status not in (
    'new','received','accepted','in_preparation','awaiting_collection',
    'awaiting_shipment','in_delivery','completed','rejected','cancelled','delivery_failed'
  ) then
    raise exception 'set_order_status_by_token: estado no válido %', p_new_status;
  end if;

  update sale
  set order_status = p_new_status,
      updated_at   = now()
  where id = p_sale_id;

  return p_new_status;
end;
$function$;
