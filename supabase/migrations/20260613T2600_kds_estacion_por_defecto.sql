-- supabase/migrations/20260613T2600_kds_estacion_por_defecto.sql
-- ============================================================================
-- CAPA 1 del KDS · ESTACIÓN POR DEFECTO (fallback de ruteo)
-- ============================================================================
-- PROBLEMA: los platos de Llorente29 no tienen family_id → ninguna línea rutea
-- → todo cae en "Sin estación" y el tablero no es usable (ni botón de servir).
--
-- SOLUCIÓN (deuda 0, explícita): cada local tiene UNA estación por defecto
-- (kitchen_station.is_default). Jerarquía de ruteo de una línea:
--   1) override por plato   recipe_item.kds_station_id
--   2) ruteo por familia     kitchen_family_route
--   3) ESTACIÓN POR DEFECTO  kitchen_station.is_default  ← nuevo fallback
-- Solo si no hay defecto (no debería pasar tras la semilla) queda null ("Sin estación").
--
-- El flag es CONFIGURABLE en Ajustes (transparente, no magia en la RPC). Semilla:
-- la prep principal (Elaboración, menor display_order) de cada local.
--
-- DDL + CREATE OR REPLACE. Idempotente. No llama funciones con guard de usuario.
-- ============================================================================

-- 1) Flag is_default ----------------------------------------------------------
alter table kitchen_station
  add column if not exists is_default boolean not null default false;

-- Garantía: como mucho UNA estación por defecto por local (índice único parcial).
create unique index if not exists kitchen_station_one_default_per_location
  on kitchen_station (location_id) where is_default;

-- 2) Semilla: marca la prep principal (menor display_order) de cada local que
--    aún no tenga defecto. Idempotente (si ya hay uno, no toca nada).
do $$
declare
  loc record;
  target uuid;
begin
  for loc in (select distinct location_id from kitchen_station where is_active) loop
    -- ¿ya tiene defecto este local?
    if exists (select 1 from kitchen_station
               where location_id = loc.location_id and is_default) then
      continue;
    end if;
    -- elige la prep de menor display_order; si no hay prep, la primera activa
    select id into target from kitchen_station
      where location_id = loc.location_id and is_active and kind = 'prep'
      order by display_order limit 1;
    if target is null then
      select id into target from kitchen_station
        where location_id = loc.location_id and is_active
        order by display_order limit 1;
    end if;
    if target is not null then
      update kitchen_station set is_default = true, updated_at = now() where id = target;
    end if;
  end loop;
end $$;

-- 3) kds_board: el station_id de cada línea ahora hace fallback a la estación
--    por defecto del local cuando no hay override ni ruteo por familia. Además
--    el bloque `stations` expone is_default (para Ajustes y para el botón Servir).
--    CREATE OR REPLACE; mantiene canal por COALESCE, ventana 2 h, menu_item_id,
--    y derivación de local por token (kiosco).
create or replace function public.kds_board(
  p_location_id uuid default null,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_location_id uuid := p_location_id;
  v_device     kds_device;
  v_station_filter uuid[] := null;
  v_default_station uuid;
  v_result     jsonb;
begin
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is null then
      raise exception 'kds_board: token de dispositivo no válido';
    end if;
    if v_location_id is null then
      v_location_id := v_device.location_id;
    elsif v_device.location_id <> v_location_id then
      raise exception 'kds_board: el token no corresponde a esta ubicación';
    end if;
    v_account_id := v_device.account_id;
    v_station_filter := v_device.station_ids;
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    if v_location_id is null then
      raise exception 'kds_board: falta location o token';
    end if;
    select account_id into v_account_id from locations where id = v_location_id;
    if v_account_id is null then
      raise exception 'kds_board: ubicación inexistente';
    end if;
    if not belongs_to_account(v_account_id) then
      raise exception 'kds_board: sin acceso a esta ubicación';
    end if;
  end if;

  -- estación por defecto del local (fallback de ruteo)
  select id into v_default_station from kitchen_station
   where location_id = v_location_id and is_default and is_active limit 1;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref, s.status,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.opened_at, s.closed_at, s.sold_at,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id = v_account_id
      and s.status <> 'cancelled'
      and not exists (
        select 1 from kds_ticket_station_state st
        join kitchen_station k on k.id = st.station_id
        where st.sale_id = s.id and k.kind = 'expo' and st.status = 'done'
      )
      and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '2 hours')
  ),
  lineas as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id,
           coalesce(
             ri.kds_station_id,
             (select fr.station_id from kitchen_family_route fr
               where fr.account_id = v_account_id and fr.family_id = ri.family_id limit 1),
             v_default_station                                   -- ← fallback
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
           b.name as brand, coalesce(ch.name, v.external_channel_text) as channel, v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           (select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
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
    'location_id', v_location_id,
    'station_filter', to_jsonb(v_station_filter),
    'default_station_id', v_default_station,
    'expo_station_id', (select id from kitchen_station
                         where location_id = v_location_id and kind='expo' and is_active
                         order by display_order limit 1),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'kind', k.kind,
                'display_order', k.display_order, 'is_default', k.is_default
              ) order by k.display_order), '[]'::jsonb)
      from kitchen_station k
      where k.account_id = v_account_id and k.location_id = v_location_id and k.is_active
    ),
    'now', now(),
    'tickets', coalesce(jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null), '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$$;
