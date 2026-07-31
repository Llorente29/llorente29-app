-- 20260731T1030_set_product_availability_v7_event.sql
-- ============================================================================
-- DISPONIBILIDAD · C1 — 86 DE PRODUCTO: cablear `set_product_availability` /
-- `set_product_availability_by_token` al log de analítica `availability_event`
-- (20260731T1000). Base: v6 (20260730T1730_set_product_availability_v6_stock_group).
--
-- ESTE es el punto de escritura MÁS IMPORTANTE del encargo: hoy
-- `product_availability` es tabla de ESTADO — la fila se BORRA al reactivar
-- (rama `if p_is_available then ... delete ...`), así que el evento de
-- REAPERTURA se pierde por completo (cero histórico, cero "quién reactivó").
-- A partir de esta migración, TODA activación/desactivación deja una fila
-- append-only en availability_event, se borre o no la fila de estado.
--
-- CAMBIOS, cero cambio de comportamiento existente (cascada stock_group,
-- dispatch, aviso multi-integrador — todo IDÉNTICO a v6), solo ADITIVO:
--   · Nuevo parámetro opcional `p_reason_code` (default null, validado). Si
--     no se envía, se DERIVA del `p_reason` enum ya existente (manual|
--     stock_out|schedule), según la tabla del encargo:
--       stock_out -> sin_stock · schedule -> fin_servicio · manual -> otro
--     Si se envía explícito, prevalece sobre la derivación (para cuando C2
--     cablee un selector de motivo más fino que el enum de 3 valores).
--   · Tras escribir/borrar `product_availability` (sin tocar esa lógica), un
--     INSERT en availability_event como efecto lateral fire-and-forget
--     (sub-bloque BEGIN/EXCEPTION propio — un fallo de analítica NUNCA rompe
--     el 86). scope='product', target_ext=external_id (o recipe_item_id si
--     el producto no tiene matrícula), action: p_is_available=false->close
--     (agotar), true->open (reactivar — ESTE es el evento que antes se
--     perdía). reason_code/reason_note solo en 'close' (reactivar no tiene
--     "motivo").
--
-- Misma firma base + 1 parámetro con default -> sin DROP.
-- BEGIN/COMMIT + GUARD final (patrón de esta sesión, ver 1712/1713/1750/1730).
-- Aplicada: —
-- ============================================================================

begin;

-- ── 1) RPC de oficina (con sesión) — v7 ─────────────────────────────────────
create or replace function public.set_product_availability(
  p_menu_item_id    uuid,
  p_is_available    boolean,
  p_location_id     uuid        default null,
  p_reason          text        default 'manual',
  p_available_until timestamptz default null,
  p_reason_code     text        default null
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
  v_action         text;
  v_reason_code    text;
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

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_product_availability: reason_code no válido %', p_reason_code;
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

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el 86. Este es el evento
  -- que ANTES se perdía al reactivar (la fila de product_availability se borra).
  v_action := case when p_is_available then 'open' else 'close' end;
  v_reason_code := case when v_action = 'close' then coalesce(p_reason_code,
    case p_reason
      when 'stock_out' then 'sin_stock'
      when 'schedule'  then 'fin_servicio'
      when 'manual'    then 'otro'
      else null
    end) else null end;
  begin
    insert into availability_event
      (account_id, scope, target_ext, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'product', coalesce(v_external_id, v_recipe_item_id::text), v_product_name,
       p_location_id, v_action, 'oficina',
       v_reason_code, null,
       v_user, 'web',
       case when v_action = 'close' then p_available_until else null end);
  exception when others then
    raise warning 'set_product_availability: fallo insertando availability_event: %', sqlerrm;
  end;

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


-- ── 2) RPC por token (estación de tablet) — v5 ──────────────────────────────
create or replace function public.set_product_availability_by_token(
  p_device_token    text,
  p_menu_item_id    uuid,
  p_is_available    boolean,
  p_reason          text default 'manual',
  p_available_until timestamptz default null,
  p_reason_code     text default null
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
  v_action         text;
  v_reason_code    text;
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

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_product_availability_by_token: reason_code no válido %', p_reason_code;
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

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el 86.
  v_action := case when p_is_available then 'open' else 'close' end;
  v_reason_code := case when v_action = 'close' then coalesce(p_reason_code,
    case p_reason
      when 'stock_out' then 'sin_stock'
      when 'schedule'  then 'fin_servicio'
      when 'manual'    then 'otro'
      else null
    end) else null end;
  begin
    insert into availability_event
      (account_id, scope, target_ext, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'product', coalesce(v_external_id, v_recipe_item_id::text), v_product_name,
       v_location_id, v_action, 'cocina',
       v_reason_code, null,
       null, 'tablet',
       case when v_action = 'close' then p_available_until else null end);
  exception when others then
    raise warning 'set_product_availability_by_token: fallo insertando availability_event: %', sqlerrm;
  end;

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

-- ── GUARD: no dar por hecho el CREATE — verificar contra pg_proc que las
-- funciones quedaron creadas con la firma exacta esperada (preview_scope_by_token
-- NO cambia en esta migración, se deja tal cual quedó en v6).
do $$
begin
  if to_regprocedure('public.set_product_availability(uuid, boolean, uuid, text, timestamptz, text)') is null then
    raise exception 'set_product_availability no quedó creada con la firma esperada (uuid, boolean, uuid, text, timestamptz, text)';
  end if;
  if to_regprocedure('public.set_product_availability_by_token(text, uuid, boolean, text, timestamptz, text)') is null then
    raise exception 'set_product_availability_by_token no quedó creada con la firma esperada (text, uuid, boolean, text, timestamptz, text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar a mano el CUERPO de cada función) ──────
-- select proname, pg_get_functiondef(oid) from pg_proc
-- where proname in ('set_product_availability','set_product_availability_by_token')
--   and pronamespace = 'public'::regnamespace;
-- Confirmar que el cuerpo contiene 'availability_event' Y sigue conteniendo
-- 'stock_group_id' (no se ha perdido la cascada v6).
--
-- Agotar y REACTIVAR un producto de prueba (web y token) y verificar:
-- select scope, target_ext, target_label, action, origin, surface, reason_code, occurred_at
-- from availability_event where scope = 'product' order by occurred_at desc limit 4;
-- Debe salir 1 fila 'close' + 1 fila 'open' por cada camino — la fila 'open'
-- es la que ANTES no existía en ningún sitio (product_availability se borra).
