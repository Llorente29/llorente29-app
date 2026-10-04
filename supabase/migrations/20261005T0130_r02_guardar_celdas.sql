-- ============================================================================
-- R02 · 4/4 · GUARDAR UNA CELDA (y arreglo R01 de la herencia)
-- ----------------------------------------------------------------------------
-- SOLO AÑADE: cuatro funciones nuevas que llama la pantalla «Quién reparte» y
-- la etiqueta de reparto del pedido. Ninguna existe hoy.
--
-- POR QUÉ RPC Y NO UPSERT DESDE LA WEB
--   · La herencia por tipo de marca vive en channel_delivery_policy, que tiene
--     dos índices únicos PARCIALES (uno con location_id nulo y otro por
--     local). El R01: la pantalla hacía `upsert(..., onConflict:
--     'account_id,channel_slug,ownership_type')` y Postgres no encuentra
--     ninguna restricción que case con ese ON CONFLICT, porque las únicas
--     que hay llevan WHERE. Aquí el ON CONFLICT lleva la condición del índice
--     que toca en cada caso, y la prueba crea una fila por cuenta y otra por
--     local (supabase/staging/sql/20261005_r02_prueba_resolucion.sql).
--   · Quién decide y cuándo lo pone el servidor, no la web.
--   · La pantalla tiene que decir qué pasa DESPUÉS de guardar («se aplica a
--     los pedidos siguientes»): la función devuelve la resolución nueva.
--
-- PERMISOS: lo mismo que las políticas de las dos tablas: admin o encargado
-- de la cuenta.
-- ============================================================================

-- Una celda marca × plataforma (× local). p_delivery_by NULL = quitar la
-- decisión: la celda vuelve a heredar.
create or replace function public.reparto_guardar_celda(
  p_account_id   uuid,
  p_brand_id     uuid,
  p_channel_slug text,
  p_location_id  uuid,
  p_delivery_by  text,
  p_source       text default 'manual'
)
returns table (delivery_by text, source text, decided_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local uuid := coalesce(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if not public.current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'Solo un administrador o encargado de la cuenta puede decidir quién reparte'
      using errcode = '42501';
  end if;
  if p_delivery_by is not null and p_delivery_by not in ('platform', 'own') then
    raise exception 'Quién reparte: «%» no es ni platform ni own', p_delivery_by using errcode = '22023';
  end if;
  if p_source not in ('manual', 'ai_accepted') then
    raise exception 'Quién reparte: origen «%» no válido desde la pantalla', p_source using errcode = '22023';
  end if;

  if p_delivery_by is null then
    delete from public.brand_delivery_policy p
     where p.account_id = p_account_id and p.brand_id = p_brand_id
       and p.channel_slug = p_channel_slug and p.location_id = v_local;
  else
    insert into public.brand_delivery_policy as p
      (account_id, brand_id, channel_slug, location_id, delivery_by, source, decided_by, decided_by_name, decided_at)
    values
      (p_account_id, p_brand_id, p_channel_slug, v_local, p_delivery_by, p_source,
       auth.uid(), public.conta_nombre_actor(), now())
    on conflict (account_id, brand_id, channel_slug, location_id) do update
      set delivery_by     = excluded.delivery_by,
          source          = excluded.source,
          decided_by      = excluded.decided_by,
          decided_by_name = excluded.decided_by_name,
          decided_at      = excluded.decided_at;
  end if;

  return query
    select r.delivery_by, r.source, r.decided_at
      from public.resolve_delivery_by(p_account_id, p_brand_id, p_channel_slug,
             case when v_local = '00000000-0000-0000-0000-000000000000'::uuid then null else v_local end) r;
end;
$$;

-- La herencia («Si no dices nada») por tipo de marca: de la cuenta
-- (p_location_id NULL) o de un local. ARREGLO R01: el ON CONFLICT lleva la
-- condición del índice parcial que toca.
create or replace function public.reparto_guardar_herencia(
  p_account_id     uuid,
  p_channel_slug   text,
  p_ownership_type text,
  p_location_id    uuid,
  p_delivery_by    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_st text;
  v_id uuid;
begin
  if not public.current_user_is_admin_or_manager_of(p_account_id) then
    raise exception 'Solo un administrador o encargado de la cuenta puede cambiar «Si no dices nada»'
      using errcode = '42501';
  end if;
  if p_delivery_by not in ('platform', 'own') then
    raise exception 'Quién reparte: «%» no es ni platform ni own', p_delivery_by using errcode = '22023';
  end if;
  if p_location_id is not null
     and not exists (select 1 from public.locations l where l.id = p_location_id and l.account_id = p_account_id) then
    raise exception 'El local % no es de la cuenta', p_location_id using errcode = '23514';
  end if;
  v_st := case p_delivery_by when 'own' then 'own_delivery' else 'platform_delivery' end;

  if p_location_id is null then
    insert into public.channel_delivery_policy as c
      (account_id, channel_slug, ownership_type, service_type, location_id, created_by, created_by_name)
    values (p_account_id, p_channel_slug, p_ownership_type, v_st, null, auth.uid(), public.conta_nombre_actor())
    on conflict (account_id, channel_slug, ownership_type) where location_id is null
    do update set service_type = excluded.service_type, updated_at = now()
    returning c.id into v_id;
  else
    insert into public.channel_delivery_policy as c
      (account_id, channel_slug, ownership_type, service_type, location_id, created_by, created_by_name)
    values (p_account_id, p_channel_slug, p_ownership_type, v_st, p_location_id, auth.uid(), public.conta_nombre_actor())
    on conflict (account_id, channel_slug, ownership_type, location_id) where location_id is not null
    do update set service_type = excluded.service_type, updated_at = now()
    returning c.id into v_id;
  end if;
  return v_id;
end;
$$;

-- Desde la etiqueta ámbar de un pedido: «Cambiar a “la reparte Uber”». Escribe
-- la celda de esa marca × plataforma (todos los locales, source manual) Y
-- recoloca ESE pedido, que es el que la persona tiene delante. Los demás
-- abiertos no se tocan (encargo §5).
create or replace function public.reparto_cambiar_desde_pedido(p_sale_id uuid, p_delivery_by text)
returns table (delivery_by text, source text, service_type text, channel_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
  v_slug text;
begin
  select s.id, s.account_id, s.brand_id, s.channel_id, s.status
    into v_sale from public.sale s where s.id = p_sale_id;
  if v_sale.id is null then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_sale.account_id) then
    raise exception 'Solo un administrador o encargado de la cuenta puede decidir quién reparte'
      using errcode = '42501';
  end if;
  if v_sale.brand_id is null then
    raise exception 'Este pedido no tiene marca: no se puede decidir quién lo reparte' using errcode = '23514';
  end if;
  select sc.slug into v_slug from public.sales_channel sc
   where sc.id = v_sale.channel_id and sc.account_id = v_sale.account_id;
  if coalesce(btrim(v_slug), '') = '' then
    raise exception 'Este pedido no tiene plataforma: no se puede decidir quién lo reparte' using errcode = '23514';
  end if;

  perform public.reparto_guardar_celda(v_sale.account_id, v_sale.brand_id, v_slug, null, p_delivery_by, 'manual');

  -- Recolocar ESTE pedido con la resolución nueva (el disparador de entrada
  -- solo recalcula un pedido abierto si se le pide a propósito).
  perform set_config('folvy.reparto_recalcular', 'on', true);
  update public.sale s
     set updated_at = now(),
         -- Si ya no lo repartimos nosotros, el motivo viejo deja de valer.
         dispatch_error = case when p_delivery_by = 'platform' then null else s.dispatch_error end,
         delivery_alarm_at = case when p_delivery_by = 'platform' and s.delivery_alarm_kind = 'no_despachado'
                                  then null else s.delivery_alarm_at end,
         delivery_alarm_kind = case when p_delivery_by = 'platform' and s.delivery_alarm_kind = 'no_despachado'
                                    then null else s.delivery_alarm_kind end
   where s.id = p_sale_id;
  perform set_config('folvy.reparto_recalcular', '', true);

  return query
    select r.delivery_by, r.source, s.service_type, v_slug
      from public.sale s
      cross join lateral public.resolve_delivery_by(s.account_id, s.brand_id, v_slug, s.location_id) r
     where s.id = p_sale_id;
end;
$$;

revoke all on function public.reparto_guardar_celda(uuid, uuid, text, uuid, text, text) from public, anon;
revoke all on function public.reparto_guardar_herencia(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.reparto_cambiar_desde_pedido(uuid, text) from public, anon;
grant execute on function public.reparto_guardar_celda(uuid, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.reparto_guardar_herencia(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.reparto_cambiar_desde_pedido(uuid, text) to authenticated;
