-- ============================================================================
-- 86 POR TOKEN DE DISPOSITIVO — set_product_availability_by_token
-- ----------------------------------------------------------------------------
-- Variante de set_product_availability para la Estación de Tablet / kiosco, que
-- NO tiene sesión de usuario (auth.uid() es null). La autorización la da el
-- TOKEN del dispositivo (kds_device.token), igual que kds_board: se valida con
-- kds_resolve_device y la cuenta + el local salen del PROPIO dispositivo.
--
-- Diferencias con la de sesión:
--   · Sin guard por auth.uid(): la frontera es el token (dispositivo físico en
--     la cocina). Se valida que el menu_item pertenezca a la cuenta del token
--     (no se puede agotar producto de otra cuenta con un token ajeno).
--   · El local NO es parámetro: es SIEMPRE el del dispositivo (v_device.location_id).
--     Así la tablet agota solo en su local, sin selector (anti-error en cocina).
--   · set_by queda null (no hay usuario); el rastro es el dispositivo (futuro:
--     guardar device_id si se quiere trazar qué tablet agotó).
--
-- Todo lo demás (cascada cross-brand, product_availability, empuje al
-- despachador acotado por local) es IDÉNTICO a la RPC de sesión.
-- DEUDA conocida (heredada): el secret del despachador va en claro (patrón
-- order-advance); rotar/centralizar en su momento.
-- ============================================================================

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
  -- 1) validar token y derivar cuenta + local del dispositivo
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

  -- 2) identidad del producto físico + verificación de pertenencia a la cuenta del token
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

  -- 3) matrículas hermanas (cascada cross-brand: mismo escandallo O misma matrícula)
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

  -- 4) escribir / borrar la fila de disponibilidad por (producto físico × local del dispositivo)
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

  -- 5) external_location_id de Last para ese local (1→N propia+cedida)
  select array_agg(distinct elm.external_location_id)
    into v_ext_locs
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  -- 6) canales reales + empuje fire-and-forget al despachador, ACOTADO al local del dispositivo
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
