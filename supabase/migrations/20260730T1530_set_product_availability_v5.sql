-- 20260730T1530_set_product_availability_v5.sql
-- ============================================================================
-- 86 — v5 de set_product_availability y set_product_availability_by_token.
-- Misma firma que v3/v2 (20260624T1200_hubrise_86_leg) → sin DROP. Tres arreglos:
--
-- (1) FIX DE SCOPE (bug real, reproducido: reactivar en global dejaba pegado un
--     86 hecho por local). Antes el DELETE de product_availability filtraba
--     `location_id is not distinct from p_location_id` en los DOS sentidos
--     (agotar Y reactivar), así que reactivar en global (p_location_id=NULL)
--     solo borraba la fila global, dejando intactas las filas por-local.
--       · AGOTAR: sin cambios — sigue reemplazando solo la fila de SU alcance
--         exacto (agotar en un local no debe tocar el 86 de otro local).
--       · REACTIVAR: ahora nunca se queda corto —
--           - global (location_id=NULL)  -> borra TODAS las filas del producto
--             (cualquier local + la global).
--           - un local                   -> borra la fila de ESE local + la
--             global (si existe) que también lo afectaba.
--
-- (2) SEGURIDAD: el secret del despachador sale del Vault (nombre
--     'availability_dispatch_secret') en vez de ir en claro en el cuerpo del
--     net.http_post — mismo patrón que 20260705T1500_ping_cron_vault. El
--     valor es el MISMO secreto que ya usa la Edge (AVAILABILITY_DISPATCH_SECRET),
--     así que no hace falta redesplegarla.
--     PRERREQUISITO (manual, NO versionable, ejecutar UNA vez):
--       select vault.create_secret(
--         'fv_avl_240b04bce3cb5513f29a71f778654ab8',
--         'availability_dispatch_secret'
--       );
--
-- (3) AVISO MULTI-INTEGRADOR: al AGOTAR (p_is_available=false), si el/los
--     local(es) afectados declaran otros integradores (locations.
--     availability_other_integrators), se inserta un aviso en
--     availability_integrator_notice (20260730T1520) para que el operario lo
--     desconecte también allí. Con p_location_id=NULL (global) se avisa a
--     TODOS los locales activos de la cuenta que tengan integradores
--     declarados (un 86 global afecta a todos). Deduplicado: no se apila un
--     aviso nuevo si ya hay uno vivo (sin acuse) para el mismo producto×local.
--     Reactivar NO emite aviso (solo se pide para el 86, no para el rearranque).
--
-- Resto (cascada cross-brand, empuje al despachador) IDÉNTICO a v3/v2.
-- DDL sin BEGIN/COMMIT. Crea las funciones pero no las ejecuta -> segura en
-- el SQL Editor de una vez.
-- Aplicada: —
-- ============================================================================

-- ── 1) RPC de oficina (con sesión) — v5 ─────────────────────────────────────
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
  v_product_name   text;
  v_user           uuid := auth.uid();
  v_matriculas     text[];
  v_brands         int;
  v_ext_locs       text[];
  v_channels       int;
  v_secret         text;
begin
  select mi.account_id, mi.recipe_item_id, mi.external_id, mi.name
    into v_account_id, v_recipe_item_id, v_external_id, v_product_name
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

  -- matrículas hermanas (cascada cross-brand: mismo escandallo O misma matrícula)
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

  -- (1) FIX DE SCOPE: escribir/borrar product_availability según dirección.
  if p_is_available then
    if p_location_id is null then
      -- reactivar en global: borra TODAS las filas del producto (todos los locales)
      delete from product_availability pa
      where pa.account_id = v_account_id
        and (
          (v_external_id    is not null and pa.external_id    = v_external_id)
          or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
        );
    else
      -- reactivar en un local: borra la fila de ESE local + la global que le afectaba
      delete from product_availability pa
      where pa.account_id = v_account_id
        and (
          (v_external_id    is not null and pa.external_id    = v_external_id)
          or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
        )
        and (pa.location_id = p_location_id or pa.location_id is null);
    end if;
  else
    -- agotar: reemplaza solo la fila de ESTE alcance exacto (no toca otros locales)
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

    -- (3) AVISO MULTI-INTEGRADOR: fan-out a locales afectados con integradores declarados.
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

  -- external_location_id de Last para ese local (1→N propia+cedida); NULL = todas
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

  -- canales reales que se tocarán (catálogos por canal de esas matrículas en ese local)
  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));

    -- (2) secret del Vault (fuera del cuerpo de la RPC)
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
          'account_id',            v_account_id,
          'matriculas',            to_jsonb(v_matriculas),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id',           p_location_id,
          'available_until',       p_available_until,
          'enable',                p_is_available,
          'reason',                p_reason
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


-- ── 2) RPC por token (estación de tablet) — v3 ──────────────────────────────
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
  v_product_name   text;
  v_matriculas     text[];
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

  select mi.account_id, mi.recipe_item_id, mi.external_id, mi.name
    into v_mi_account, v_recipe_item_id, v_external_id, v_product_name
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

  -- (1) FIX DE SCOPE: la tablet solo opera en SU local, así que "reactivar"
  -- aquí siempre es el caso "un local": borra la fila de ese local + la global.
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

    -- (3) AVISO MULTI-INTEGRADOR (siempre un único local: el del dispositivo)
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

  -- external_location_id de Last para ese local (1→N propia+cedida)
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

    -- (2) secret del Vault (fuera del cuerpo de la RPC)
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
          'account_id',            v_account_id,
          'matriculas',            to_jsonb(v_matriculas),
          'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id',           v_location_id,
          'available_until',       p_available_until,
          'enable',                p_is_available,
          'reason',                p_reason
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
