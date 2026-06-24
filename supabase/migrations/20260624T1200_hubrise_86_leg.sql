-- 20260624T1200_hubrise_86_leg.sql
-- ============================================================================
-- 86 vía HubRise — leg de inventario (PATCH /catalogs/{cat}/location/inventory).
-- ADITIVO: NO toca el camino de Last. Idempotente. DDL + CREATE OR REPLACE de
-- las dos RPC (misma firma → sin DROP). No se ejecuta ninguna SECURITY DEFINER
-- dentro de la transacción que la crea.
--
-- Qué hace:
--   1) Columnas de conexión HubRise en external_integration (nullable; solo las
--      usan filas source='hubrise'). El token vive en BBDD por conexión (escala
--      a N marcas; no más Secret único).
--   2) set_product_availability v3 y set_product_availability_by_token v2:
--      añaden 'location_id' y 'available_until' al body del net.http_post, para
--      que el despachador resuelva las conexiones HubRise por local y aplique el
--      timer (expires_at). El camino de Last queda IDÉNTICO.
--
-- Aplicada: 2026-06-24
-- ============================================================================

-- ── 1) Columnas de conexión HubRise ────────────────────────────────────────
alter table public.external_integration add column if not exists access_token         text;
alter table public.external_integration add column if not exists external_catalog_id  text;
alter table public.external_integration add column if not exists external_location_id text;
alter table public.external_integration add column if not exists connection_name      text;

comment on column public.external_integration.access_token         is 'HubRise: X-Access-Token por conexión (location-bound). NULL en lastapp (usa token_secret_name).';
comment on column public.external_integration.external_catalog_id  is 'HubRise: catalog_id de la conexión (texto, ej. mm92j).';
comment on column public.external_integration.external_location_id is 'HubRise: location_id externo (texto, ej. zy9j2-0). Casa con external_location_map.external_location_id.';
comment on column public.external_integration.connection_name      is 'HubRise: nombre de conexión/marca (name=BrandName de la autorización).';


-- ── 2a) RPC de oficina (con sesión) — v3 ────────────────────────────────────
-- Cambio único vs v2: el body del despachador añade location_id + available_until.
create or replace function public.set_product_availability(
  p_menu_item_id    uuid,
  p_is_available    boolean,
  p_location_id     uuid        default null,
  p_reason          text        default 'manual',
  p_available_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id     uuid;
  v_recipe_item_id uuid;
  v_external_id    text;
  v_user           uuid := auth.uid();
  v_matriculas     text[];
  v_brands         int;
  v_ext_locs       text[];
  v_channels       int;
begin
  select mi.account_id, mi.recipe_item_id, mi.external_id
    into v_account_id, v_recipe_item_id, v_external_id
  from menu_item mi
  where mi.id = p_menu_item_id;

  if v_account_id is null then
    raise exception 'set_product_availability: producto % no encontrado', p_menu_item_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_product_availability: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_product_availability: reason no válido %', p_reason;
  end if;

  select array_agg(distinct mi.external_id) filter (where mi.external_id is not null),
         count(distinct mi.brand_id)
    into v_matriculas, v_brands
  from menu_item mi
  where mi.account_id = v_account_id
    and (
      (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
      or (v_external_id is not null and mi.external_id = v_external_id)
      or mi.id = p_menu_item_id
    );

  delete from product_availability pa
  where pa.account_id = v_account_id
    and (
      (v_external_id    is not null and pa.external_id    = v_external_id)
      or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
    )
    and pa.location_id is not distinct from p_location_id;

  if not p_is_available then
    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id,
       is_available, reason, available_until, set_by)
    values
      (v_account_id, v_external_id, v_recipe_item_id, p_location_id,
       false, p_reason, p_available_until, v_user);
  end if;

  if p_location_id is null then
    select array_agg(distinct elm.external_location_id)
      into v_ext_locs
    from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active;
  else
    select array_agg(distinct elm.external_location_id)
      into v_ext_locs
    from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
      and elm.location_id = p_location_id;
  end if;

  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));

    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
      headers := jsonb_build_object(
        'Content-Type',                   'application/json',
        'x-availability-dispatch-secret', 'fv_avl_240b04bce3cb5513f29a71f778654ab8'
      ),
      body    := jsonb_build_object(
        'account_id',            v_account_id,
        'matriculas',            to_jsonb(v_matriculas),
        'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
        'location_id',           p_location_id,      -- NUEVO: el despachador resuelve conexiones HubRise por local
        'available_until',       p_available_until,  -- NUEVO: timer (expires_at) para el 86 de HubRise
        'enable',                p_is_available,
        'reason',                p_reason
      )
    );
  end if;

  return jsonb_build_object(
    'brands',             coalesce(v_brands, 0),
    'channels',           coalesce(v_channels, 0),
    'matriculas',         coalesce(array_length(v_matriculas, 1), 0),
    'location_id',        p_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0)
  );
end;
$function$;


-- ── 2b) RPC por token (estación de tablet) — v2 ─────────────────────────────
-- Cambio único: el body del despachador añade location_id (= local del
-- dispositivo) + available_until.
create or replace function public.set_product_availability_by_token(
  p_device_token    text,
  p_menu_item_id    uuid,
  p_is_available    boolean,
  p_reason          text default 'manual',
  p_available_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device         kds_device;
  v_account_id     uuid;
  v_location_id    uuid;
  v_mi_account     uuid;
  v_recipe_item_id uuid;
  v_external_id    text;
  v_matriculas     text[];
  v_brands         int;
  v_ext_locs       text[];
  v_channels       int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_product_availability_by_token: token de dispositivo no válido';
  end if;
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;
  update kds_device set last_seen_at = now() where id = v_device.id;

  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_product_availability_by_token: reason no válido %', p_reason;
  end if;

  select mi.account_id, mi.recipe_item_id, mi.external_id
    into v_mi_account, v_recipe_item_id, v_external_id
  from menu_item mi
  where mi.id = p_menu_item_id;

  if v_mi_account is null then
    raise exception 'set_product_availability_by_token: producto % no encontrado', p_menu_item_id;
  end if;
  if v_mi_account <> v_account_id then
    raise exception 'set_product_availability_by_token: el producto no pertenece a la cuenta del dispositivo';
  end if;

  select array_agg(distinct mi.external_id) filter (where mi.external_id is not null),
         count(distinct mi.brand_id)
    into v_matriculas, v_brands
  from menu_item mi
  where mi.account_id = v_account_id
    and (
      (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
      or (v_external_id is not null and mi.external_id = v_external_id)
      or mi.id = p_menu_item_id
    );

  delete from product_availability pa
  where pa.account_id = v_account_id
    and (
      (v_external_id    is not null and pa.external_id    = v_external_id)
      or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
    )
    and pa.location_id is not distinct from v_location_id;

  if not p_is_available then
    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id,
       is_available, reason, available_until, set_by)
    values
      (v_account_id, v_external_id, v_recipe_item_id, v_location_id,
       false, p_reason, p_available_until, null);
  end if;

  select array_agg(distinct elm.external_location_id)
    into v_ext_locs
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));

    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
      headers := jsonb_build_object(
        'Content-Type',                   'application/json',
        'x-availability-dispatch-secret', 'fv_avl_240b04bce3cb5513f29a71f778654ab8'
      ),
      body    := jsonb_build_object(
        'account_id',            v_account_id,
        'matriculas',            to_jsonb(v_matriculas),
        'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
        'location_id',           v_location_id,      -- NUEVO: local del dispositivo
        'available_until',       p_available_until,  -- NUEVO: timer (expires_at)
        'enable',                p_is_available,
        'reason',                p_reason
      )
    );
  end if;

  return jsonb_build_object(
    'brands',             coalesce(v_brands, 0),
    'channels',           coalesce(v_channels, 0),
    'matriculas',         coalesce(array_length(v_matriculas, 1), 0),
    'location_id',        v_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0)
  );
end;
$function$;
