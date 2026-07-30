-- 20260730T1730_set_product_availability_v6_stock_group.sql
-- ============================================================================
-- 86 — v6: FIX DE FONDO del cruce entre marcas (Fase B).
--
-- BUG REAL (confirmado leyendo el código, no hipotético): la cascada "hermanos
-- cross-brand" de v5 incluía CUALQUIER menu_item que compartiera external_id,
-- SIN mirar si era una colisión real (Coca-Cola, producto físico compartido a
-- propósito) o un accidente de Last (Doritos Chili de la marca A y Doritos
-- Pollo Fajita de la marca B compartiendo el mismo id de Last por casualidad).
-- Y como hubrise-catalog-publish/availability-dispatch usaban ese external_id
-- SIN namespacing como sku_ref, agotar en A también agotaba en B.
--
-- FIX: la cascada por "producto compartido" ya NO usa external_id crudo — usa
-- stock_group_id (Fase B, grupo EXPLÍCITO). Sin grupo, el item NUNCA cruza de
-- marca (solo se afecta a sí mismo, o a sus hermanos por recipe_item_id, que
-- es una cascada DISTINTA y sin cambios — receta compartida a propósito, no
-- tiene el problema de colisión de Last).
--
--   · recipe_item_id  -> cascada cross-brand IDÉNTICA a siempre (sin cambios).
--   · stock_group_id  -> NUEVO: cascada cross-brand a los demás miembros del
--     MISMO grupo explícito (Fase B). Sustituye la vieja cascada por external_id.
--   · sin grupo        -> el 86 se queda en ESTE item (por-marca, aislado).
--
-- Además: se pasa `affected_menu_item_ids` al despachador (nuevo campo), para
-- que availability-dispatch resuelva el ref de HubRise de CADA item afectado
-- vía _shared/hubriseSku.ts (namespaced), en vez de usar external_id crudo.
--
-- Resto (Vault, aviso multi-integrador, empuje) IDÉNTICO a v5
-- (20260730T1530). Misma firma -> sin DROP.
--
-- AVISO DEL RUNNER (esta sesión): el SQL editor se ha tragado statements de
-- scripts multi-sentencia reportando "Success" (índice, trigger y el delete
-- del reset — ver 20260730T1712/1713/1750). Puede volver a pasar aquí:
-- BEGIN/COMMIT + GUARD final contra pg_proc/to_regprocedure que aborta si
-- alguna de las 3 funciones no quedó creada con la firma esperada. Verificar
-- también a mano el cuerpo de cada función tras ejecutar.
-- Aplicada: —
-- ============================================================================

begin;

-- ── 1) RPC de oficina (con sesión) — v6 ─────────────────────────────────────
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
  v_stock_group_id uuid;
  v_product_name   text;
  v_user           uuid := auth.uid();
  v_matriculas     text[];
  v_affected_ids   uuid[];
  v_brands         int;
  v_ext_locs       text[];
  v_channels       int;
  v_secret         text;
begin
  select mi.account_id, mi.recipe_item_id, mi.external_id, mi.name, mi.stock_group_id
    into v_account_id, v_recipe_item_id, v_external_id, v_product_name, v_stock_group_id
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

  -- hermanos: SIEMPRE uno mismo + receta compartida (sin cambios) + stock_group
  -- EXPLÍCITO (Fase B — sustituye la vieja cascada por external_id crudo).
  with sib as (
    select mi.id, mi.brand_id, mi.external_id
    from menu_item mi
    where mi.account_id = v_account_id
      and (
        mi.id = p_menu_item_id
        or (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
        or (v_stock_group_id is not null and mi.stock_group_id = v_stock_group_id)
      )
  )
  select array_agg(distinct external_id) filter (where external_id is not null),
         count(distinct brand_id),
         array_agg(distinct id)
    into v_matriculas, v_brands, v_affected_ids
  from sib;

  -- (1) FIX DE SCOPE (v5, sin cambios): escribir/borrar product_availability según dirección.
  if p_is_available then
    if p_location_id is null then
      delete from product_availability pa
      where pa.account_id = v_account_id
        and (
          (v_external_id    is not null and pa.external_id    = v_external_id)
          or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
        );
    else
      delete from product_availability pa
      where pa.account_id = v_account_id
        and (
          (v_external_id    is not null and pa.external_id    = v_external_id)
          or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
        )
        and (pa.location_id = p_location_id or pa.location_id is null);
    end if;
  else
    delete from product_availability pa
    where pa.account_id = v_account_id
      and (
        (v_external_id    is not null and pa.external_id    = v_external_id)
        or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
      )
      and pa.location_id is not distinct from p_location_id;

    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id,
       is_available, reason, available_until, set_by)
    values
      (v_account_id, v_external_id, v_recipe_item_id, p_location_id,
       false, p_reason, p_available_until, v_user);

    -- (3) AVISO MULTI-INTEGRADOR (v5, sin cambios de lógica; v_brands ahora más preciso).
    if p_location_id is not null then
      insert into availability_integrator_notice
        (account_id, location_id, product_name, external_id, recipe_item_id,
         brands, integrators, reason, raised_by)
      select v_account_id, l.id, coalesce(v_product_name, '(producto)'), v_external_id, v_recipe_item_id,
             coalesce(v_brands, 0), l.availability_other_integrators, p_reason, v_user
      from locations l
      where l.id = p_location_id
        and l.account_id = v_account_id
        and coalesce(array_length(l.availability_other_integrators, 1), 0) > 0
        and not exists (
          select 1 from availability_integrator_notice x
          where x.location_id = l.id and x.ack_at is null
            and coalesce(x.external_id, '')      = coalesce(v_external_id, '')
            and coalesce(x.recipe_item_id::text, '') = coalesce(v_recipe_item_id::text, '')
        );
    else
      insert into availability_integrator_notice
        (account_id, location_id, product_name, external_id, recipe_item_id,
         brands, integrators, reason, raised_by)
      select v_account_id, l.id, coalesce(v_product_name, '(producto)'), v_external_id, v_recipe_item_id,
             coalesce(v_brands, 0), l.availability_other_integrators, p_reason, v_user
      from locations l
      where l.account_id = v_account_id
        and l.active
        and coalesce(array_length(l.availability_other_integrators, 1), 0) > 0
        and not exists (
          select 1 from availability_integrator_notice x
          where x.location_id = l.id and x.ack_at is null
            and coalesce(x.external_id, '')      = coalesce(v_external_id, '')
            and coalesce(x.recipe_item_id::text, '') = coalesce(v_recipe_item_id::text, '')
        );
    end if;
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

    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'availability_dispatch_secret';

    if v_secret is not null then
      perform net.http_post(
        url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object(
          'Content-Type',                   'application/json',
          'x-availability-dispatch-secret', v_secret
        ),
        body    := jsonb_build_object(
          'account_id',              v_account_id,
          'matriculas',               to_jsonb(v_matriculas),
          'affected_menu_item_ids',   to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
          'external_location_ids',    to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id',              p_location_id,
          'available_until',          p_available_until,
          'enable',                   p_is_available,
          'reason',                   p_reason
        )
      );
    else
      raise warning 'set_product_availability: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
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


-- ── 2) RPC por token (estación de tablet) — v4 ──────────────────────────────
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
  v_stock_group_id uuid;
  v_product_name   text;
  v_matriculas     text[];
  v_affected_ids   uuid[];
  v_brands         int;
  v_ext_locs       text[];
  v_channels       int;
  v_secret         text;
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

  select mi.account_id, mi.recipe_item_id, mi.external_id, mi.name, mi.stock_group_id
    into v_mi_account, v_recipe_item_id, v_external_id, v_product_name, v_stock_group_id
  from menu_item mi
  where mi.id = p_menu_item_id;

  if v_mi_account is null then
    raise exception 'set_product_availability_by_token: producto % no encontrado', p_menu_item_id;
  end if;
  if v_mi_account <> v_account_id then
    raise exception 'set_product_availability_by_token: el producto no pertenece a la cuenta del dispositivo';
  end if;

  with sib as (
    select mi.id, mi.brand_id, mi.external_id
    from menu_item mi
    where mi.account_id = v_account_id
      and (
        mi.id = p_menu_item_id
        or (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
        or (v_stock_group_id is not null and mi.stock_group_id = v_stock_group_id)
      )
  )
  select array_agg(distinct external_id) filter (where external_id is not null),
         count(distinct brand_id),
         array_agg(distinct id)
    into v_matriculas, v_brands, v_affected_ids
  from sib;

  if p_is_available then
    delete from product_availability pa
    where pa.account_id = v_account_id
      and (
        (v_external_id    is not null and pa.external_id    = v_external_id)
        or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
      )
      and (pa.location_id = v_location_id or pa.location_id is null);
  else
    delete from product_availability pa
    where pa.account_id = v_account_id
      and (
        (v_external_id    is not null and pa.external_id    = v_external_id)
        or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
      )
      and pa.location_id is not distinct from v_location_id;

    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id,
       is_available, reason, available_until, set_by)
    values
      (v_account_id, v_external_id, v_recipe_item_id, v_location_id,
       false, p_reason, p_available_until, null);

    insert into availability_integrator_notice
      (account_id, location_id, product_name, external_id, recipe_item_id,
       brands, integrators, reason, raised_by)
    select v_account_id, l.id, coalesce(v_product_name, '(producto)'), v_external_id, v_recipe_item_id,
           coalesce(v_brands, 0), l.availability_other_integrators, p_reason, null
    from locations l
    where l.id = v_location_id
      and coalesce(array_length(l.availability_other_integrators, 1), 0) > 0
      and not exists (
        select 1 from availability_integrator_notice x
        where x.location_id = l.id and x.ack_at is null
          and coalesce(x.external_id, '')      = coalesce(v_external_id, '')
          and coalesce(x.recipe_item_id::text, '') = coalesce(v_recipe_item_id::text, '')
      );
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

    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'availability_dispatch_secret';

    if v_secret is not null then
      perform net.http_post(
        url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object(
          'Content-Type',                   'application/json',
          'x-availability-dispatch-secret', v_secret
        ),
        body    := jsonb_build_object(
          'account_id',              v_account_id,
          'matriculas',               to_jsonb(v_matriculas),
          'affected_menu_item_ids',   to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
          'external_location_ids',    to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id',              v_location_id,
          'available_until',          p_available_until,
          'enable',                   p_is_available,
          'reason',                   p_reason
        )
      );
    else
      raise warning 'set_product_availability_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
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


-- ── 3) preview_scope_by_token — misma corrección de cascada (tablet) ────────
-- Espejo del fix: la previsualización "N marcas · N canales" que ve el
-- operario ANTES de confirmar el 86 debe coincidir con lo que de verdad va a
-- pasar (nunca prometer más marcas de las que realmente se van a tocar).
create or replace function public.preview_scope_by_token(
  p_device_token text,
  p_menu_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device      kds_device;
  v_recipe_item uuid;
  v_external_id text;
  v_stock_group uuid;
  v_matriculas  text[];
  v_brands      int;
  v_ext_locs    text[];
  v_channels    int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'preview_scope_by_token: token no válido';
  end if;

  select mi.recipe_item_id, mi.external_id, mi.stock_group_id
    into v_recipe_item, v_external_id, v_stock_group
  from menu_item mi
  where mi.id = p_menu_item_id and mi.account_id = v_device.account_id;

  with sib as (
    select mi.id, mi.brand_id, mi.external_id
    from menu_item mi
    where mi.account_id = v_device.account_id
      and (
        mi.id = p_menu_item_id
        or (v_recipe_item is not null and mi.recipe_item_id = v_recipe_item)
        or (v_stock_group is not null and mi.stock_group_id = v_stock_group)
      )
  )
  select array_agg(distinct external_id) filter (where external_id is not null),
         count(distinct brand_id)
    into v_matriculas, v_brands
  from sib;

  select array_agg(distinct elm.external_location_id)
    into v_ext_locs
  from external_location_map elm
  where elm.account_id = v_device.account_id and elm.source = 'lastapp'
    and elm.is_active and elm.location_id = v_device.location_id;

  if v_matriculas is not null and array_length(v_matriculas,1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_device.account_id
      and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
  end if;

  return jsonb_build_object('brands', coalesce(v_brands,0), 'channels', coalesce(v_channels,0));
end;
$function$;

-- ── GUARD: no dar por hecho el CREATE — verificar contra pg_proc que las 3
-- funciones quedaron creadas con la firma exacta esperada.
do $$
begin
  if to_regprocedure('public.set_product_availability(uuid, boolean, uuid, text, timestamptz)') is null then
    raise exception 'set_product_availability no quedó creada con la firma esperada (uuid, boolean, uuid, text, timestamptz)';
  end if;
  if to_regprocedure('public.set_product_availability_by_token(text, uuid, boolean, text, timestamptz)') is null then
    raise exception 'set_product_availability_by_token no quedó creada con la firma esperada (text, uuid, boolean, text, timestamptz)';
  end if;
  if to_regprocedure('public.preview_scope_by_token(text, uuid)') is null then
    raise exception 'preview_scope_by_token no quedó creada con la firma esperada (text, uuid)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar a mano el CUERPO de cada función) ──────
-- select proname, pg_get_functiondef(oid) from pg_proc
-- where proname in ('set_product_availability','set_product_availability_by_token','preview_scope_by_token')
--   and pronamespace = 'public'::regnamespace;
-- Confirmar que el cuerpo contiene 'stock_group_id' (la cascada v6) y
-- 'affected_menu_item_ids' (en las dos primeras) — no la versión v5 vieja.
