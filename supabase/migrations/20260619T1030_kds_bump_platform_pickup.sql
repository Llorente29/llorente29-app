-- supabase/migrations/20260619T1030_kds_bump_platform_pickup.sql
-- ============================================================================
-- CICLO DE VIDA DEL PEDIDO (7a): el cierre depende de QUIÉN reparte.
-- ============================================================================
-- Regla (Julio): la responsabilidad de Folvy en delivery de PLATAFORMA termina
-- cuando el rider de Glovo/Uber/JE recoge. Por eso, servir en cocina un pedido de
-- plataforma NO lo manda "en reparto" (Folvy no sigue lo que no controla): lo deja
-- "listo, esperando rider" (awaiting_collection). El operario lo cierra con el botón
-- "Entregado al rider" cuando ve que el rider se lo lleva.
--
-- Reparto PROPIO (own_delivery) sí sigue la vida del pedido -> in_delivery (y la 7b
-- añadirá "En ruta" + seguimiento con flota Catcher/Jelp/Shipday + métricas).
--
-- Ramas al servir (expo):
--   pickup            -> awaiting_collection (cliente recoge)
--   platform_delivery -> awaiting_collection (rider de plataforma recoge)   [CAMBIO]
--   own_delivery      -> in_delivery        (reparto propio, Folvy sigue)
--   NULL              -> in_delivery        (fallback delivery)
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

  if not exists (select 1 from kitchen_station k
                 where k.id = p_station_id and k.account_id = v_account and k.location_id = v_loc) then
    raise exception 'kds_bump: estación no válida para esta ubicación';
  end if;

  insert into kds_ticket_station_state (account_id, sale_id, station_id, status, updated_at)
  values (v_account, p_sale_id, p_station_id, 'done', now())
  on conflict (sale_id, station_id)
  do update set status = 'done', updated_at = now();

  select (k.kind = 'expo') into v_is_expo
  from kitchen_station k where k.id = p_station_id;

  if coalesce(v_is_expo, false) then
    select service_type, order_status into v_service, v_cur from sale where id = p_sale_id;

    if v_cur in ('new','received','accepted','in_preparation') then
      v_next := case
                  -- pickup y plataforma: listo esperando recogida (cliente o rider)
                  when v_service = 'pickup'            then 'awaiting_collection'
                  when v_service = 'platform_delivery' then 'awaiting_collection'
                  -- reparto propio (y NULL): sale a reparto, Folvy sigue el pedido
                  else 'in_delivery'
                end;

      update sale
      set order_status = v_next,
          updated_at   = now()
      where id = p_sale_id;
    end if;
  end if;
end;
$$;
