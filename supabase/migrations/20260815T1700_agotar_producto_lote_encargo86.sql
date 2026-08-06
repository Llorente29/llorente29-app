-- supabase/migrations/20260815T1700_agotar_producto_lote_encargo86.sql
--
-- ENCARGO 86 · MULTI-SELECCIÓN + AGOTADO EN LOTE (un solo dispatch)
-- ============================================================================
-- Aplicada: (pendiente — la ejecuta Julio por SQL Editor / MCP apply_migration
--            y verifica; no marcar como aplicada por escribir este fichero)
--
-- RECON hecho contra producción antes de escribir esto (pg_get_functiondef en
-- vivo de set_product_availability, set_product_availability_by_token,
-- search_products_by_token, preview_scope_by_token + edge function
-- availability-dispatch + esquema de product_availability/brand/
-- brand_hubrise_catalog/external_catalog_product). El cuerpo de A.1 está
-- FUSIONADO sobre el original en producción, no reescrito desde el repo.
--
-- Bloque A.1 — refactor SIN cambio de comportamiento:
--   _set_product_availability_core: hace todo lo que hacía la RPC excepto el
--   net.http_post (hermanos, escritura/borrado en product_availability,
--   availability_integrator_notice, availability_event). set_product_availability
--   y set_product_availability_by_token pasan a ser: resolver cuenta + guard +
--   llamar al core + SU net.http_post de siempre (idéntico al de antes, cero
--   cambio de payload ni de condiciones). Firma de ambas INTACTA -> CREATE OR
--   REPLACE, sin DROP.
--
-- Bloque A.2/A.3 — RPC de lote (set_products_availability_bulk +
--   _by_token): motivo/vencimiento ÚNICOS, tope 50, guard de cuenta única,
--   bucle sobre el core acumulando matrículas/afectados, UN SOLO
--   net.http_post final con la unión (el despachador ya acepta arrays, no se
--   toca). Fallos individuales van a `failed`, nunca abortan el resto.
--
-- Bloque A.4 — búsqueda unificada (search_products_86 nueva para web +
--   search_products_by_token reescrita para tablet, misma firma): incluyen
--   combos, excluyen ya-agotados (anti-join product_availability) y marcas
--   inactivas (brand.is_active), devuelven is_combo. NOTA: las 17 marcas
--   duplicadas siguen is_active=true hoy (verificado en RECON) — archivarlas
--   es tarea aparte (fuera de este encargo); este filtro es la red que
--   mantiene la búsqueda limpia DESPUÉS de esa tarea.
--
-- Bloque C — contador de canales honesto: _scope_preview_core (nuevo)
--   calcula channelsLast (Last, como antes) Y brandsHubrise (marcas con fila
--   en brand_hubrise_catalog — hoy 0 en el contador viejo porque solo miraba
--   external_catalog_product source='lastapp', y Uber ya no está en Last).
--   preview_scope_by_token se reescribe para devolver ambos (firma intacta).
--   preview_scope_bulk_by_token es NUEVO: no estaba pedido explícitamente en
--   el encargo, pero AgotarProductoModal es compartido web+tablet y tablet no
--   tiene acceso directo a tablas (todo por token/RPC) — sin esta pieza la
--   tablet se queda descolgada del alcance agregado honesto en el flujo de
--   lote, exactamente el hueco que A.3 avisa de no dejar.
--
-- SEGURIDAD: _set_product_availability_core y _scope_preview_core son
-- SECURITY DEFINER pero NO repiten el guard admin/manager (lo hace el
-- wrapper que las llama, una sola vez). Por eso se les REVOCA EXECUTE de
-- public/anon/authenticated al final: sin esto, PostgREST las expondría como
-- RPC directas (todo function SECURITY DEFINER con GRANT a PUBLIC por
-- defecto es invocable por anon) y cualquiera podría agotar productos de
-- cualquier cuenta pasando su propio account_id — la fuga entre cuentas que
-- la regla de "toda SECURITY DEFINER con cuenta lleva guard" existe para
-- evitar. Las llamadas internas (wrapper -> core) siguen funcionando: un
-- SECURITY DEFINER ejecuta como su dueño, que sí tiene EXECUTE.
-- ============================================================================

begin;

-- ── A.1a — núcleo compartido (sin dispatch) ────────────────────────────────
create or replace function public._set_product_availability_core(
  p_menu_item_id uuid,
  p_is_available boolean,
  p_location_id uuid,
  p_reason text,
  p_available_until timestamptz,
  p_reason_code text,
  p_account_id uuid,
  p_actor uuid,
  p_origin text,
  p_surface text
) returns jsonb
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
  v_matriculas     text[];
  v_affected_ids   uuid[];
  v_brands         int;
  v_action         text;
  v_reason_code    text;
begin
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception '_set_product_availability_core: reason no válido %', p_reason;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception '_set_product_availability_core: reason_code no válido %', p_reason_code;
  end if;

  select mi.account_id, mi.recipe_item_id, mi.external_id, mi.name, mi.stock_group_id
    into v_account_id, v_recipe_item_id, v_external_id, v_product_name, v_stock_group_id
  from menu_item mi
  where mi.id = p_menu_item_id;

  if v_account_id is null then
    raise exception '_set_product_availability_core: producto % no encontrado', p_menu_item_id;
  end if;
  if v_account_id <> p_account_id then
    raise exception '_set_product_availability_core: producto % no pertenece a la cuenta %', p_menu_item_id, p_account_id;
  end if;

  -- hermanos: uno mismo + receta compartida + stock_group EXPLÍCITO (Fase B).
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
       false, p_reason, p_available_until, p_actor);

    if p_location_id is not null then
      insert into availability_integrator_notice
        (account_id, location_id, product_name, external_id, recipe_item_id,
         brands, integrators, reason, raised_by)
      select v_account_id, l.id, coalesce(v_product_name, '(producto)'), v_external_id, v_recipe_item_id,
             coalesce(v_brands, 0), l.availability_other_integrators, p_reason, p_actor
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
             coalesce(v_brands, 0), l.availability_other_integrators, p_reason, p_actor
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
       p_location_id, v_action, p_origin,
       v_reason_code, null,
       p_actor, p_surface,
       case when v_action = 'close' then p_available_until else null end);
  exception when others then
    raise warning '_set_product_availability_core: fallo insertando availability_event: %', sqlerrm;
  end;

  return jsonb_build_object(
    'matriculas',   coalesce(to_jsonb(v_matriculas), '[]'::jsonb),
    'affected_ids', coalesce(to_jsonb(v_affected_ids), '[]'::jsonb),
    'brands',       coalesce(v_brands, 0)
  );
end;
$function$;

-- ── A.1b — set_product_availability: firma intacta, cuerpo = core + dispatch ──
create or replace function public.set_product_availability(
  p_menu_item_id uuid,
  p_is_available boolean,
  p_location_id uuid default null,
  p_reason text default 'manual',
  p_available_until timestamptz default null,
  p_reason_code text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id   uuid;
  v_user         uuid := auth.uid();
  v_core         jsonb;
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_brands       int;
  v_ext_locs     text[];
  v_channels     int;
  v_secret       text;
begin
  select mi.account_id into v_account_id from menu_item mi where mi.id = p_menu_item_id;
  if v_account_id is null then
    raise exception 'set_product_availability: producto % no encontrado', p_menu_item_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_product_availability: sin acceso a la cuenta %', v_account_id;
  end if;

  v_core := public._set_product_availability_core(
    p_menu_item_id, p_is_available, p_location_id, p_reason, p_available_until, p_reason_code,
    v_account_id, v_user, 'oficina', 'web'
  );
  v_matriculas   := array(select jsonb_array_elements_text(v_core->'matriculas'));
  v_affected_ids := array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
  v_brands       := coalesce((v_core->>'brands')::int, 0);

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
    'brands',             v_brands,
    'channels',           coalesce(v_channels, 0),
    'matriculas',         coalesce(array_length(v_matriculas, 1), 0),
    'location_id',        p_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0)
  );
end;
$function$;

-- ── A.1c — set_product_availability_by_token: firma intacta, cuerpo = core + dispatch ──
create or replace function public.set_product_availability_by_token(
  p_device_token text,
  p_menu_item_id uuid,
  p_is_available boolean,
  p_reason text default 'manual',
  p_available_until timestamptz default null,
  p_reason_code text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device       kds_device;
  v_account_id   uuid;
  v_location_id  uuid;
  v_mi_account   uuid;
  v_core         jsonb;
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_brands       int;
  v_ext_locs     text[];
  v_channels     int;
  v_secret       text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_product_availability_by_token: token de dispositivo no válido';
  end if;
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;
  update kds_device set last_seen_at = now() where id = v_device.id;

  select mi.account_id into v_mi_account from menu_item mi where mi.id = p_menu_item_id;
  if v_mi_account is null then
    raise exception 'set_product_availability_by_token: producto % no encontrado', p_menu_item_id;
  end if;
  if v_mi_account <> v_account_id then
    raise exception 'set_product_availability_by_token: el producto no pertenece a la cuenta del dispositivo';
  end if;

  v_core := public._set_product_availability_core(
    p_menu_item_id, p_is_available, v_location_id, p_reason, p_available_until, p_reason_code,
    v_account_id, null, 'cocina', 'tablet'
  );
  v_matriculas   := array(select jsonb_array_elements_text(v_core->'matriculas'));
  v_affected_ids := array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
  v_brands       := coalesce((v_core->>'brands')::int, 0);

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
    'brands',             v_brands,
    'channels',           coalesce(v_channels, 0),
    'matriculas',         coalesce(array_length(v_matriculas, 1), 0),
    'location_id',        v_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0)
  );
end;
$function$;

-- ── A.2 — RPC de lote (web/sesión) ──────────────────────────────────────────
create or replace function public.set_products_availability_bulk(
  p_menu_item_ids uuid[],
  p_is_available boolean,
  p_location_id uuid default null,
  p_reason text default 'manual',
  p_available_until timestamptz default null,
  p_reason_code text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user        uuid := auth.uid();
  v_account_id  uuid;
  v_n_found     int;
  v_n_mismatch  int;
  v_mi          uuid;
  v_core        jsonb;
  v_all_matr    text[] := array[]::text[];
  v_all_ids     uuid[] := array[]::uuid[];
  v_failed      jsonb  := '[]'::jsonb;
  v_products_ok int    := 0;
  v_ext_locs    text[];
  v_channels    int;
  v_secret      text;
begin
  if p_menu_item_ids is null or array_length(p_menu_item_ids, 1) is null then
    raise exception 'set_products_availability_bulk: la selección está vacía';
  end if;
  if array_length(p_menu_item_ids, 1) > 50 then
    raise exception 'set_products_availability_bulk: máximo 50 productos por operación (recibidos %)', array_length(p_menu_item_ids, 1);
  end if;
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_products_availability_bulk: reason no válido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_products_availability_bulk: reason_code no válido %', p_reason_code;
  end if;

  select mi.account_id into v_account_id from menu_item mi where mi.id = p_menu_item_ids[1];
  if v_account_id is null then
    raise exception 'set_products_availability_bulk: producto % no encontrado', p_menu_item_ids[1];
  end if;

  select count(*), count(*) filter (where account_id <> v_account_id)
    into v_n_found, v_n_mismatch
  from menu_item where id = any(p_menu_item_ids);
  if v_n_found <> array_length(p_menu_item_ids, 1) then
    raise exception 'set_products_availability_bulk: algún producto de la selección no existe';
  end if;
  if v_n_mismatch > 0 then
    raise exception 'set_products_availability_bulk: todos los productos deben pertenecer a la misma cuenta';
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_products_availability_bulk: sin acceso a la cuenta %', v_account_id;
  end if;

  foreach v_mi in array p_menu_item_ids loop
    begin
      v_core := public._set_product_availability_core(
        v_mi, p_is_available, p_location_id, p_reason, p_available_until, p_reason_code,
        v_account_id, v_user, 'oficina', 'web'
      );
      v_all_matr := v_all_matr || array(select jsonb_array_elements_text(v_core->'matriculas'));
      v_all_ids  := v_all_ids  || array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
      v_products_ok := v_products_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('menu_item_id', v_mi, 'error', sqlerrm);
    end;
  end loop;

  select array_agg(distinct x) into v_all_matr from unnest(v_all_matr) x;
  select array_agg(distinct x) into v_all_ids  from unnest(v_all_ids) x;

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

  if v_all_matr is not null and array_length(v_all_matr, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_all_matr)
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
          'matriculas',               to_jsonb(v_all_matr),
          'affected_menu_item_ids',   to_jsonb(coalesce(v_all_ids, array[]::uuid[])),
          'external_location_ids',    to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id',              p_location_id,
          'available_until',          p_available_until,
          'enable',                   p_is_available,
          'reason',                   p_reason
        )
      );
    else
      raise warning 'set_products_availability_bulk: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object(
    'products',    v_products_ok,
    'brands',      coalesce((select count(distinct brand_id) from menu_item where id = any(v_all_ids)), 0),
    'channels',    coalesce(v_channels, 0),
    'matriculas',  coalesce(v_all_matr, array[]::text[]),
    'failed',      v_failed
  );
end;
$function$;

-- ── A.3 — gemela por token (tablet) ─────────────────────────────────────────
create or replace function public.set_products_availability_bulk_by_token(
  p_device_token text,
  p_menu_item_ids uuid[],
  p_is_available boolean,
  p_reason text default 'manual',
  p_available_until timestamptz default null,
  p_reason_code text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_location_id uuid;
  v_n_found     int;
  v_mi          uuid;
  v_core        jsonb;
  v_all_matr    text[] := array[]::text[];
  v_all_ids     uuid[] := array[]::uuid[];
  v_failed      jsonb  := '[]'::jsonb;
  v_products_ok int    := 0;
  v_ext_locs    text[];
  v_channels    int;
  v_secret      text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_products_availability_bulk_by_token: token de dispositivo no válido';
  end if;
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;

  if p_menu_item_ids is null or array_length(p_menu_item_ids, 1) is null then
    raise exception 'set_products_availability_bulk_by_token: la selección está vacía';
  end if;
  if array_length(p_menu_item_ids, 1) > 50 then
    raise exception 'set_products_availability_bulk_by_token: máximo 50 productos por operación (recibidos %)', array_length(p_menu_item_ids, 1);
  end if;
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_products_availability_bulk_by_token: reason no válido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_products_availability_bulk_by_token: reason_code no válido %', p_reason_code;
  end if;

  select count(*) into v_n_found
  from menu_item where id = any(p_menu_item_ids) and account_id = v_account_id;
  if v_n_found <> array_length(p_menu_item_ids, 1) then
    raise exception 'set_products_availability_bulk_by_token: algún producto de la selección no existe en esta cuenta';
  end if;

  update kds_device set last_seen_at = now() where id = v_device.id;

  foreach v_mi in array p_menu_item_ids loop
    begin
      v_core := public._set_product_availability_core(
        v_mi, p_is_available, v_location_id, p_reason, p_available_until, p_reason_code,
        v_account_id, null, 'cocina', 'tablet'
      );
      v_all_matr := v_all_matr || array(select jsonb_array_elements_text(v_core->'matriculas'));
      v_all_ids  := v_all_ids  || array(select (jsonb_array_elements_text(v_core->'affected_ids'))::uuid);
      v_products_ok := v_products_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('menu_item_id', v_mi, 'error', sqlerrm);
    end;
  end loop;

  select array_agg(distinct x) into v_all_matr from unnest(v_all_matr) x;
  select array_agg(distinct x) into v_all_ids  from unnest(v_all_ids) x;

  select array_agg(distinct elm.external_location_id)
    into v_ext_locs
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
    and elm.location_id = v_location_id;

  if v_all_matr is not null and array_length(v_all_matr, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_all_matr)
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
          'matriculas',               to_jsonb(v_all_matr),
          'affected_menu_item_ids',   to_jsonb(coalesce(v_all_ids, array[]::uuid[])),
          'external_location_ids',    to_jsonb(coalesce(v_ext_locs, array[]::text[])),
          'location_id',              v_location_id,
          'available_until',          p_available_until,
          'enable',                   p_is_available,
          'reason',                   p_reason
        )
      );
    else
      raise warning 'set_products_availability_bulk_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    end if;
  end if;

  return jsonb_build_object(
    'products',    v_products_ok,
    'brands',      coalesce((select count(distinct brand_id) from menu_item where id = any(v_all_ids)), 0),
    'channels',    coalesce(v_channels, 0),
    'matriculas',  coalesce(v_all_matr, array[]::text[]),
    'failed',      v_failed
  );
end;
$function$;

-- ── A.4 — búsqueda unificada, tablet (firma intacta) ────────────────────────
-- + combos, − ya-agotados (anti-join product_availability), − marcas
-- inactivas (brand.is_active), + is_combo.
create or replace function public.search_products_by_token(p_device_token text, p_query text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_term   text := btrim(coalesce(p_query, ''));
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'search_products_by_token: token no válido';
  end if;
  if length(v_term) < 2 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with rows as (
      select mi.id, mi.external_id, mi.recipe_item_id, mi.brand_id, mi.name, mi.product_type,
             coalesce(mi.recipe_item_id::text, mi.external_id, mi.id::text) as pkey
      from menu_item mi
      join brand b on b.id = mi.brand_id
      where mi.account_id = v_device.account_id
        and b.is_active
        and mi.name ilike '%' || v_term || '%'
        and not exists (
          select 1 from product_availability pa
          where pa.account_id = v_device.account_id
            and (
              (mi.external_id    is not null and pa.external_id    = mi.external_id)
              or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id)
            )
            and (pa.location_id = v_device.location_id or pa.location_id is null)
        )
      limit 200
    ),
    grouped as (
      select pkey,
             (array_agg(id order by id))[1]             as menu_item_id,
             (array_agg(name order by id))[1]           as name,
             (array_agg(external_id order by id))[1]    as external_id,
             (array_agg(recipe_item_id order by id))[1] as recipe_item_id,
             bool_or(product_type = 'combo')            as is_combo,
             count(distinct brand_id)                   as brands
      from rows
      group by pkey
    )
    select jsonb_agg(jsonb_build_object(
             'menuItemId',   menu_item_id,
             'name',         name,
             'externalId',   external_id,
             'recipeItemId', recipe_item_id,
             'brands',       brands,
             'isCombo',      is_combo
           ) order by name)
    from grouped
  ), '[]'::jsonb);
end;
$function$;

-- ── A.4 — búsqueda unificada, web (nueva, espejo de la anterior) ───────────
create or replace function public.search_products_86(
  p_account_id uuid,
  p_query text,
  p_location_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_term text := btrim(coalesce(p_query, ''));
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'search_products_86: sin acceso a la cuenta %', p_account_id;
  end if;
  if length(v_term) < 2 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with rows as (
      select mi.id, mi.external_id, mi.recipe_item_id, mi.brand_id, mi.name, mi.product_type,
             coalesce(mi.recipe_item_id::text, mi.external_id, mi.id::text) as pkey
      from menu_item mi
      join brand b on b.id = mi.brand_id
      where mi.account_id = p_account_id
        and b.is_active
        and mi.name ilike '%' || v_term || '%'
        and not exists (
          select 1 from product_availability pa
          where pa.account_id = p_account_id
            and (
              (mi.external_id    is not null and pa.external_id    = mi.external_id)
              or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id)
            )
            and (pa.location_id = p_location_id or pa.location_id is null)
        )
      limit 200
    ),
    grouped as (
      select pkey,
             (array_agg(id order by id))[1]             as menu_item_id,
             (array_agg(name order by id))[1]           as name,
             (array_agg(external_id order by id))[1]    as external_id,
             (array_agg(recipe_item_id order by id))[1] as recipe_item_id,
             bool_or(product_type = 'combo')            as is_combo,
             count(distinct brand_id)                   as brands
      from rows
      group by pkey
    )
    select jsonb_agg(jsonb_build_object(
             'menuItemId',   menu_item_id,
             'name',         name,
             'externalId',   external_id,
             'recipeItemId', recipe_item_id,
             'brands',       brands,
             'isCombo',      is_combo
           ) order by name)
    from grouped
  ), '[]'::jsonb);
end;
$function$;

-- ── C — núcleo compartido del contador honesto (Last real + HubRise real) ──
create or replace function public._scope_preview_core(
  p_account_id uuid,
  p_matriculas text[],
  p_brand_ids uuid[],
  p_location_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ext_locs      text[];
  v_channels_last int;
  v_brands_hr     int;
begin
  -- cada tramo se calcula en su propio bloque: un fallo en Last no debe
  -- tapar un HubRise que sí se pudo calcular (y viceversa). null = no se
  -- pudo calcular ESE tramo; el caller lo pinta como "—", nunca como 0.
  begin
    select array_agg(distinct elm.external_location_id)
      into v_ext_locs
    from external_location_map elm
    where elm.account_id = p_account_id and elm.source = 'lastapp' and elm.is_active
      and (p_location_id is null or elm.location_id = p_location_id);

    if p_matriculas is not null and array_length(p_matriculas, 1) > 0 then
      select count(distinct ecp.external_channel)
        into v_channels_last
      from external_catalog_product ecp
      where ecp.account_id = p_account_id
        and ecp.organization_product_id::text = any(p_matriculas)
        and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
    else
      v_channels_last := 0;
    end if;
  exception when others then
    v_channels_last := null;
    raise warning '_scope_preview_core: fallo calculando channelsLast: %', sqlerrm;
  end;

  begin
    if p_brand_ids is not null and array_length(p_brand_ids, 1) > 0 then
      select count(distinct bhc.brand_id)
        into v_brands_hr
      from brand_hubrise_catalog bhc
      where bhc.account_id = p_account_id
        and bhc.brand_id = any(p_brand_ids)
        and (p_location_id is null or bhc.location_id = p_location_id);
    else
      v_brands_hr := 0;
    end if;
  exception when others then
    v_brands_hr := null;
    raise warning '_scope_preview_core: fallo calculando brandsHubrise: %', sqlerrm;
  end;

  return jsonb_build_object('channelsLast', v_channels_last, 'brandsHubrise', v_brands_hr);
end;
$function$;

-- ── C — preview_scope_by_token: firma intacta, ahora honesto (Last + HubRise) ──
create or replace function public.preview_scope_by_token(p_device_token text, p_menu_item_id uuid)
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
  v_brand_ids   uuid[];
  v_brands      int;
  v_core        jsonb;
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
         array_agg(distinct brand_id) filter (where brand_id is not null),
         count(distinct brand_id)
    into v_matriculas, v_brand_ids, v_brands
  from sib;

  v_core := public._scope_preview_core(v_device.account_id, v_matriculas, v_brand_ids, v_device.location_id);

  return jsonb_build_object(
    'brands',        coalesce(v_brands, 0),
    'channelsLast',  (v_core->>'channelsLast')::int,
    'brandsHubrise', (v_core->>'brandsHubrise')::int
  );
end;
$function$;

-- ── C — preview_scope_bulk_by_token: NUEVA, alcance agregado honesto para tablet ──
create or replace function public.preview_scope_bulk_by_token(p_device_token text, p_menu_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device     kds_device;
  v_matriculas text[];
  v_brand_ids  uuid[];
  v_brands     int;
  v_core       jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'preview_scope_bulk_by_token: token no válido';
  end if;
  if p_menu_item_ids is null or array_length(p_menu_item_ids, 1) is null then
    raise exception 'preview_scope_bulk_by_token: la selección está vacía';
  end if;

  with sib as (
    select mi.id, mi.brand_id, mi.external_id
    from menu_item mi
    where mi.account_id = v_device.account_id
      and (
        mi.id = any(p_menu_item_ids)
        or mi.recipe_item_id in (
          select recipe_item_id from menu_item
          where id = any(p_menu_item_ids) and account_id = v_device.account_id and recipe_item_id is not null
        )
        or mi.stock_group_id in (
          select stock_group_id from menu_item
          where id = any(p_menu_item_ids) and account_id = v_device.account_id and stock_group_id is not null
        )
      )
  )
  select array_agg(distinct external_id) filter (where external_id is not null),
         array_agg(distinct brand_id) filter (where brand_id is not null),
         count(distinct brand_id)
    into v_matriculas, v_brand_ids, v_brands
  from sib;

  v_core := public._scope_preview_core(v_device.account_id, v_matriculas, v_brand_ids, v_device.location_id);

  return jsonb_build_object(
    'brands',        coalesce(v_brands, 0),
    'channelsLast',  (v_core->>'channelsLast')::int,
    'brandsHubrise', (v_core->>'brandsHubrise')::int
  );
end;
$function$;

-- ── seguridad: los núcleos internos NO son RPC pública ──────────────────────
revoke execute on function public._set_product_availability_core(
  uuid, boolean, uuid, text, timestamptz, text, uuid, uuid, text, text
) from public, anon, authenticated;

revoke execute on function public._scope_preview_core(
  uuid, text[], uuid[], uuid
) from public, anon, authenticated;

-- ── guard: aborta si algún objeto no quedó creado con la firma esperada ────
do $$
begin
  if to_regprocedure('public._set_product_availability_core(uuid, boolean, uuid, text, timestamptz, text, uuid, uuid, text, text)') is null then
    raise exception 'guard: _set_product_availability_core no se creó';
  end if;
  if to_regprocedure('public.set_product_availability(uuid, boolean, uuid, text, timestamptz, text)') is null then
    raise exception 'guard: set_product_availability no se creó';
  end if;
  if to_regprocedure('public.set_product_availability_by_token(text, uuid, boolean, text, timestamptz, text)') is null then
    raise exception 'guard: set_product_availability_by_token no se creó';
  end if;
  if to_regprocedure('public.set_products_availability_bulk(uuid[], boolean, uuid, text, timestamptz, text)') is null then
    raise exception 'guard: set_products_availability_bulk no se creó';
  end if;
  if to_regprocedure('public.set_products_availability_bulk_by_token(text, uuid[], boolean, text, timestamptz, text)') is null then
    raise exception 'guard: set_products_availability_bulk_by_token no se creó';
  end if;
  if to_regprocedure('public.search_products_by_token(text, text)') is null then
    raise exception 'guard: search_products_by_token no se creó';
  end if;
  if to_regprocedure('public.search_products_86(uuid, text, uuid)') is null then
    raise exception 'guard: search_products_86 no se creó';
  end if;
  if to_regprocedure('public._scope_preview_core(uuid, text[], uuid[], uuid)') is null then
    raise exception 'guard: _scope_preview_core no se creó';
  end if;
  if to_regprocedure('public.preview_scope_by_token(text, uuid)') is null then
    raise exception 'guard: preview_scope_by_token no se creó';
  end if;
  if to_regprocedure('public.preview_scope_bulk_by_token(text, uuid[])') is null then
    raise exception 'guard: preview_scope_bulk_by_token no se creó';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
