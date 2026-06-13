-- supabase/migrations/20260613T2300_kds_capa1_b3a_board.sql
-- ============================================================================
-- CAPA 1 del KDS · BLOQUE 3a — TABLERO (kds_board) + validación de token
-- ============================================================================
-- kds_board(p_location_id, p_device_token) devuelve el tablero de una ubicación:
-- pedidos VIVOS EN COCINA (estado de cocina, no contable) con sus líneas
-- agrupadas por estación, estado por estación (bump), marcado por plato,
-- semáforo de tiempo y cabecera (código, canal, marca).
--
-- DOBLE PUERTA DE AUTORIZACIÓN (frontera en la propia RPC, SECURITY DEFINER):
--   - con p_device_token  -> valida contra kds_device (activo, del local). Kiosco.
--   - sin token           -> autoriza por sesión (belongs_to_account del local).
--
-- "VIVO EN COCINA": la venta de la ubicación que NO está cancelada y cuyo EXPO
-- aún no marcó 'done'. Independiente del estado contable (open/closed). Red de
-- seguridad: se excluyen las cerradas hace > 12 h sin servir (no satura).
--
-- auth.uid() es null en el SQL Editor -> la rama de SESIÓN no se puede probar
-- ahí; la rama de TOKEN sí. DDL sin BEGIN/COMMIT. Idempotente.
-- ============================================================================

-- Helper: valida un token de dispositivo y devuelve su fila (o NULL). ----------
-- SECURITY DEFINER: lee kds_device saltando RLS (la validación ES la frontera).
create or replace function public.kds_resolve_device(p_token text)
returns kds_device
language sql
security definer
set search_path = public
as $$
  select * from kds_device
  where token = p_token and is_active = true
  limit 1;
$$;

-- kds_board ------------------------------------------------------------------
create or replace function public.kds_board(
  p_location_id uuid,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_device     kds_device;
  v_station_filter uuid[] := null;   -- estaciones que esta pantalla muestra (NULL=todas)
  v_result     jsonb;
begin
  -- ── Autorización ──────────────────────────────────────────────────────────
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is null then
      raise exception 'kds_board: token de dispositivo no válido';
    end if;
    if v_device.location_id <> p_location_id then
      raise exception 'kds_board: el token no corresponde a esta ubicación';
    end if;
    v_account_id := v_device.account_id;
    v_station_filter := v_device.station_ids;   -- puede ser NULL (todas)
    -- marca de actividad del dispositivo (no bloqueante)
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    -- Rama de SESIÓN: la ubicación debe pertenecer a una cuenta del usuario.
    select account_id into v_account_id from locations where id = p_location_id;
    if v_account_id is null then
      raise exception 'kds_board: ubicación inexistente';
    end if;
    if not belongs_to_account(v_account_id) then
      raise exception 'kds_board: sin acceso a esta ubicación';
    end if;
  end if;

  -- ── Construcción del tablero ──────────────────────────────────────────────
  -- Pedidos vivos en cocina: de la ubicación, no cancelados, expo no 'done',
  -- y (si están closed) cerrados hace <= 12 h.
  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref, s.status,
           s.brand_id, s.channel_id, s.opened_at, s.closed_at, s.sold_at,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = p_location_id
      and s.account_id = v_account_id
      and s.status <> 'cancelled'
      and not exists (
        select 1
        from kds_ticket_station_state st
        join kitchen_station k on k.id = st.station_id
        where st.sale_id = s.id and k.kind = 'expo' and st.status = 'done'
      )
      and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '12 hours')
  ),
  lineas as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id,
           -- estación: override del recipe_item, si no ruteo por familia, si no NULL
           coalesce(
             ri.kds_station_id,
             (select fr.station_id from kitchen_family_route fr
               where fr.account_id = v_account_id and fr.family_id = ri.family_id limit 1)
           ) as station_id,
           coalesce(ls.marked, false) as marked,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and coalesce(sl.line_type,'product') = 'product'
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref, v.status,
           b.name as brand, ch.name as channel, v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           (select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'station_id', l.station_id, 'marked', l.marked, 'allergens', l.allergens,
                'has_recipe', (l.menu_item_id is not null)
            ) order by l.product_name)
            from lineas l where l.sale_id = v.id) as lineas,
           (select jsonb_object_agg(st.station_id, st.status)
            from kds_ticket_station_state st where st.sale_id = v.id) as estaciones
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', p_location_id,
    'station_filter', to_jsonb(v_station_filter),
    'now', now(),
    'tickets', coalesce(jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null), '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$$;
