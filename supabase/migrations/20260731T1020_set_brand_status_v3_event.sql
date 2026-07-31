-- 20260731T1020_set_brand_status_v3_event.sql
-- ============================================================================
-- DISPONIBILIDAD · C1 — CAP. B: cablear `set_brand_status` /
-- `set_brand_status_by_token` al log de analítica `availability_event`
-- (20260731T1000). Sigue la v2_rollup (20260730T1770) como base — sin tocar
-- el fix del rollup a location_status_log.
--
-- CAMBIOS, cero cambio de comportamiento existente, solo ADITIVO:
--   · Nuevo parámetro opcional `p_reason_code` (default null, validado).
--   · Tras el INSERT en location_status_log (sin tocar esa lógica ni el
--     rollup vía location_status_log_id), un INSERT en availability_event
--     como efecto lateral fire-and-forget (sub-bloque BEGIN/EXCEPTION propio
--     — un fallo de analítica NUNCA rompe el cierre de marca).
--   · scope='brand', target_id=brand_id, action deriva de mode (normal->open,
--     paused->close). origin fijo por CAMINO (oficina|cocina). location_id:
--     en la RPC de token se rellena con el local del dispositivo (informativo
--     — de qué local salió la orden); en la de sesión queda null (el cierre
--     de marca es de CUENTA, no de local — set_brand_status no tiene
--     p_location_id).
--
-- Misma firma base + 1 parámetro con default -> sin DROP.
-- BEGIN/COMMIT + GUARD final (patrón de esta sesión, ver 1712/1713/1750/1770).
-- Aplicada: —
-- ============================================================================

begin;

-- ── RPC de oficina (con sesión) ─────────────────────────────────────────────
create or replace function public.set_brand_status(
  p_brand_id    uuid,
  p_mode        text,
  p_resume_at   timestamptz default null,
  p_reason      text        default null,
  p_reason_code text        default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id   uuid;
  v_brand_name   text;
  v_user         uuid := auth.uid();
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_count        int;
  v_secret       text;
  v_log_id       uuid;
  v_action       text;
begin
  select account_id, name into v_account_id, v_brand_name from brand where id = p_brand_id;
  if v_account_id is null then
    raise exception 'set_brand_status: marca % no encontrada', p_brand_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_brand_status: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_mode not in ('normal', 'paused') then
    raise exception 'set_brand_status: mode no válido % (solo normal|paused)', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_brand_status: reason_code no válido %', p_reason_code;
  end if;

  update brand
  set closure_mode      = p_mode,
      closure_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      closure_reason    = case when p_mode = 'normal' then null else p_reason end,
      closure_set_at    = now(),
      closure_set_by    = v_user
  where id = p_brand_id;

  -- Refs POR-MARCA de esta marca: SOLO stock_group_id IS NULL. Los compartidos
  -- (Coca-Cola, etc.) NUNCA se tocan aquí — cerrar la marca no los agota.
  select array_agg(distinct external_id) filter (where external_id is not null),
         array_agg(distinct id),
         count(*)
    into v_matriculas, v_affected_ids, v_count
  from menu_item
  where account_id = v_account_id
    and brand_id = p_brand_id
    and stock_group_id is null
    and external_id is not null
    and archived_at is null;

  insert into location_status_log
    (account_id, brand_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, p_brand_id, 'brand_closure',
     jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', coalesce(v_count, 0)),
     p_mode, p_resume_at, p_reason, 'web', v_user)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre de marca.
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'brand', p_brand_id, v_brand_name, null, v_action, 'oficina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       v_user, 'web',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_brand_status: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_matriculas is null or array_length(v_matriculas, 1) = 0 then
    update location_status_log
    set ok = true, error = 'Sin productos por-marca que empujar (todo compartido o sin matrícula)', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', 0, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'availability_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret availability_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_brand_status: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', false);
  end if;

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
      'external_location_ids',    to_jsonb(array[]::text[]),
      'location_id',              null,
      'available_until',          p_resume_at,
      'enable',                   (p_mode = 'normal'),
      'reason',                   'manual',
      'location_status_log_id',   v_log_id
    )
  );

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;


-- ── RPC por token (estación de tablet) ──────────────────────────────────────
create or replace function public.set_brand_status_by_token(
  p_device_token text,
  p_brand_id     uuid,
  p_mode         text,
  p_resume_at    timestamptz default null,
  p_reason       text        default null,
  p_reason_code  text        default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device       kds_device;
  v_account_id   uuid;
  v_brand_acc    uuid;
  v_brand_name   text;
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_count        int;
  v_secret       text;
  v_log_id       uuid;
  v_action       text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_brand_status_by_token: token de dispositivo no válido';
  end if;
  v_account_id := v_device.account_id;
  update kds_device set last_seen_at = now() where id = v_device.id;

  select account_id, name into v_brand_acc, v_brand_name from brand where id = p_brand_id;
  if v_brand_acc is null then
    raise exception 'set_brand_status_by_token: marca % no encontrada', p_brand_id;
  end if;
  if v_brand_acc <> v_account_id then
    raise exception 'set_brand_status_by_token: la marca no pertenece a la cuenta del dispositivo';
  end if;

  if p_mode not in ('normal', 'paused') then
    raise exception 'set_brand_status_by_token: mode no válido % (solo normal|paused)', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_brand_status_by_token: reason_code no válido %', p_reason_code;
  end if;

  update brand
  set closure_mode      = p_mode,
      closure_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      closure_reason    = case when p_mode = 'normal' then null else p_reason end,
      closure_set_at    = now(),
      closure_set_by    = null
  where id = p_brand_id;

  select array_agg(distinct external_id) filter (where external_id is not null),
         array_agg(distinct id),
         count(*)
    into v_matriculas, v_affected_ids, v_count
  from menu_item
  where account_id = v_account_id
    and brand_id = p_brand_id
    and stock_group_id is null
    and external_id is not null
    and archived_at is null;

  insert into location_status_log
    (account_id, brand_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, p_brand_id, 'brand_closure',
     jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', coalesce(v_count, 0)),
     p_mode, p_resume_at, p_reason, 'tablet', null)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre de marca.
  -- location_id informativo = local del dispositivo (el cierre en sí es de cuenta).
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'brand', p_brand_id, v_brand_name, v_device.location_id, v_action, 'cocina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       null, 'tablet',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_brand_status_by_token: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_matriculas is null or array_length(v_matriculas, 1) = 0 then
    update location_status_log
    set ok = true, error = 'Sin productos por-marca que empujar (todo compartido o sin matrícula)', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', 0, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'availability_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret availability_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_brand_status_by_token: secret availability_dispatch_secret ausente en Vault, no se empuja al despachador';
    return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', false);
  end if;

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
      'external_location_ids',    to_jsonb(array[]::text[]),
      'location_id',              null,
      'available_until',          p_resume_at,
      'enable',                   (p_mode = 'normal'),
      'reason',                   'manual',
      'location_status_log_id',   v_log_id
    )
  );

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.set_brand_status(uuid, text, timestamptz, text, text)') is null then
    raise exception 'set_brand_status no quedó creada con la firma esperada (uuid, text, timestamptz, text, text)';
  end if;
  if to_regprocedure('public.set_brand_status_by_token(text, uuid, text, timestamptz, text, text)') is null then
    raise exception 'set_brand_status_by_token no quedó creada con la firma esperada (text, uuid, text, timestamptz, text, text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select proname, pg_get_functiondef(oid) from pg_proc
-- where proname in ('set_brand_status','set_brand_status_by_token')
--   and pronamespace = 'public'::regnamespace;
-- Confirmar que el cuerpo contiene 'availability_event' Y sigue conteniendo
-- 'location_status_log_id' (el fix del rollup de 1770 no debe perderse).
--
-- Cerrar y reabrir una marca de prueba (web y token) y verificar:
-- select scope, action, origin, surface, reason_code, reason_note, location_id, occurred_at
-- from availability_event where scope = 'brand' order by occurred_at desc limit 4;
-- Debe salir 1 fila 'close' + 1 fila 'open' por cada camino (web/token). En el
-- de token, location_id debe ser el local del dispositivo de prueba.
