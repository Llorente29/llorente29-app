-- supabase/migrations/20260619T1010_kds_bump_advance_order.sql
-- ============================================================================
-- PUENTE KDS -> FEED (1/2): servir en cocina mueve el estado del pedido.
-- ============================================================================
-- Hoy kds_bump solo marca (pedido x estación) como 'done'. Cuando la estación
-- bumpeada es la EXPO (el Pase = "servido"), además avanzamos sale.order_status
-- para que el pedido progrese en el feed Y dispare el empuje al canal (el trigger
-- de la pieza 2/2 reacciona al cambio de order_status).
--
-- CLAVE (RECON): NO llamamos a set_order_status desde aquí. set_order_status exige
-- sesión manager/admin (auth.uid()), pero kds_bump corre también en KIOSCO (token,
-- sin sesión). Como kds_bump ya autorizó vía kds_authorize y tiene v_account,
-- hacemos el UPDATE sale directo. Cada RPC con su guard correcto.
--
-- Ramas por service_type (datos reales: delivery domina, pickup residual):
--   pickup                                  -> awaiting_collection (cliente recoge)
--   platform_delivery / own_delivery / NULL -> in_delivery        (sale a reparto)
--
-- Idempotente y seguro: solo avanza si el pedido AÚN no está servido/cerrado
-- (no piso estados terminales ni "rebobino" un pedido ya entregado).
-- ============================================================================

create or replace function public.kds_bump(p_sale_id uuid, p_station_id uuid, p_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account   uuid;
  v_loc       uuid;
  v_is_expo   boolean;
  v_service   text;
  v_cur       text;
  v_next      text;
begin
  select location_id into v_loc from sale where id = p_sale_id;
  if v_loc is null then raise exception 'kds_bump: venta inexistente'; end if;

  v_account := public.kds_authorize(v_loc, p_token);

  -- la estación debe ser de la misma cuenta/local
  if not exists (select 1 from kitchen_station k
                 where k.id = p_station_id and k.account_id = v_account and k.location_id = v_loc) then
    raise exception 'kds_bump: estación no válida para esta ubicación';
  end if;

  -- marca (pedido x estación) como 'done' (comportamiento original, intacto)
  insert into kds_ticket_station_state (account_id, sale_id, station_id, status, updated_at)
  values (v_account, p_sale_id, p_station_id, 'done', now())
  on conflict (sale_id, station_id)
  do update set status = 'done', updated_at = now();

  -- ¿esta estación es la EXPO (Pase)? -> servir -> avanzar el pedido
  select (k.kind = 'expo') into v_is_expo
  from kitchen_station k where k.id = p_station_id;

  if coalesce(v_is_expo, false) then
    select service_type, order_status into v_service, v_cur from sale where id = p_sale_id;

    -- solo avanzamos pedidos AÚN en preparación/aceptados (no terminales ni ya servidos)
    if v_cur in ('new','received','accepted','in_preparation') then
      v_next := case
                  when v_service = 'pickup' then 'awaiting_collection'
                  else 'in_delivery'   -- platform_delivery, own_delivery y NULL
                end;

      update sale
      set order_status = v_next,
          updated_at   = now()
      where id = p_sale_id;
      -- el cambio de order_status dispara el trigger de empuje (pieza 2/2)
    end if;
  end if;
end;
$$;
