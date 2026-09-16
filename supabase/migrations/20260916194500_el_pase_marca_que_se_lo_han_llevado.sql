-- ============================================================================
-- «SE LO HA LLEVADO» · EL PASE PUEDE SELLAR LA RECOGIDA · 16/09/2026
--
-- Hasta hoy `handed_to_courier_at` solo lo escribía un aviso: Catcher, por
-- `delivery_state`, o --desde esta noche-- HubRise con Uber. Del resto no lo
-- escribía nadie, y el que está en el pase VE la bolsa irse por la puerta.
-- Esta RPC le deja decirlo.
--
-- 🔴 LA PRIMERA HORA GANA, y por eso el `where ... is null`: si el aviso llega
-- después, no pisa lo que dijo la persona; y si la persona pulsa después de que
-- llegara el aviso, no pisa el aviso. Es la misma regla que usan los dos sellos
-- de `hubrise-webhook`, y evita la discusión de quién manda: manda el primero
-- que lo supo.
--
-- 🔴 NO TOCA `order_status`. Pulsar esto NO es avanzar el pedido: es apuntar un
-- hecho. `set_order_status_by_token` sigue siendo el único que mueve el estado,
-- y el empuje a la plataforma depende de ÉSE, así que esto no empuja nada.
--
-- Devuelve la hora que quedó escrita --la nueva o la que ya había-- para que el
-- botón confirme con contenido y no con un visto (regla 8). Nunca null.
--
-- Guardas: las mismas tres de `set_order_status_by_token`, copiadas y no
-- adivinadas (token válido, misma cuenta, mismo local).
--
-- VOLVER ATRÁS: drop function public.marcar_recogido_by_token(text, uuid);
-- ============================================================================
create or replace function public.marcar_recogido_by_token(
  p_device_token text,
  p_sale_id      uuid
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_device kds_device;
  v_acc    uuid;
  v_loc    uuid;
  v_hora   timestamptz;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'marcar_recogido_by_token: token no válido';
  end if;

  select account_id, location_id, handed_to_courier_at
    into v_acc, v_loc, v_hora
    from sale where id = p_sale_id;
  if v_acc is null then
    raise exception 'marcar_recogido_by_token: venta inexistente';
  end if;
  if v_acc <> v_device.account_id then
    raise exception 'marcar_recogido_by_token: la venta no pertenece a la cuenta del dispositivo';
  end if;
  if v_device.location_id is not null and v_loc is distinct from v_device.location_id then
    raise exception 'marcar_recogido_by_token: la venta no pertenece al local del dispositivo';
  end if;

  if v_hora is not null then
    return v_hora;                      -- ya lo sabíamos: no se pisa
  end if;

  update sale
     set handed_to_courier_at = now(),
         updated_at           = now()
   where id = p_sale_id
     and handed_to_courier_at is null
  returning handed_to_courier_at into v_hora;

  -- Si entre el select y el update llegó el aviso, `v_hora` vuelve null: se lee
  -- otra vez y se devuelve la que haya. El botón nunca se queda sin respuesta.
  if v_hora is null then
    select handed_to_courier_at into v_hora from sale where id = p_sale_id;
  end if;

  return v_hora;
end $$;

revoke all on function public.marcar_recogido_by_token(text, uuid) from public;
grant execute on function public.marcar_recogido_by_token(text, uuid) to anon, authenticated;
