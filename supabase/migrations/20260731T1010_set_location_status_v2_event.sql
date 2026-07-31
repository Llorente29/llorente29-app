-- 20260731T1010_set_location_status_v2_event.sql
-- ============================================================================
-- DISPONIBILIDAD · C1 — CAP. C: cablear `set_location_status` /
-- `set_location_status_by_token` al log de analítica `availability_event`
-- (migración anterior, 20260731T1000).
--
-- CAMBIOS respecto a la v1 (20260730T1620), cero cambio de comportamiento
-- existente, solo ADITIVO:
--   · Nuevo parámetro opcional `p_reason_code` (default null, validado contra
--     el enum). Mientras la UI (C2) no lo envíe, queda null -> retrocompatible.
--   · Tras escribir en location_status_log (sin tocar esa lógica), un INSERT
--     en availability_event como efecto lateral fire-and-forget: envuelto en
--     un sub-bloque BEGIN/EXCEPTION propio que loggea warning y sigue — un
--     fallo de analítica JAMÁS debe romper el cierre/apertura del local.
--   · scope='location', target_id=location_id, action deriva de mode
--     (normal->open, busy|paused->close), origin fijo por CAMINO (oficina en
--     la RPC de sesión, cocina en la de token — nunca un parámetro de
--     cliente). reason_code/reason_note/resume_at solo se escriben en 'close'
--     (en 'open' no hay "motivo", solo se reabre).
--
-- Misma firma base + 1 parámetro con default -> sin DROP, sin romper
-- llamadas existentes (Supabase JS llama con objeto nombrado, no posicional).
--
-- AVISO DEL RUNNER (heredado de esta sesión de trabajo, ver 1712/1713/1750):
-- BEGIN/COMMIT + GUARD final por to_regprocedure — no dar nada por hecho.
-- Aplicada: —
-- ============================================================================

begin;

-- ── 1) RPC de oficina (con sesión) ──────────────────────────────────────────
create or replace function public.set_location_status(
  p_location_id uuid,
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
  v_account_id uuid;
  v_loc_name   text;
  v_user       uuid := auth.uid();
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
  v_action     text;
begin
  select account_id, name into v_account_id, v_loc_name from locations where id = p_location_id;
  if v_account_id is null then
    raise exception 'set_location_status: local % no encontrado', p_location_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_location_status: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_mode not in ('normal', 'busy', 'paused') then
    raise exception 'set_location_status: mode no válido %', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_location_status: reason_code no válido %', p_reason_code;
  end if;

  update locations
  set hubrise_status_mode      = p_mode,
      hubrise_status_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      hubrise_status_reason    = case when p_mode = 'normal' then null else p_reason end,
      hubrise_status_set_at    = now(),
      hubrise_status_set_by    = v_user
  where id = p_location_id;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = p_location_id
  limit 1;

  v_patch := jsonb_build_object('order_acceptance', jsonb_strip_nulls(jsonb_build_object(
    'mode', p_mode, 'resume_at', p_resume_at, 'reason', p_reason
  )));

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, p_location_id, v_ext_loc, 'order_acceptance', v_patch, p_mode, p_resume_at, p_reason, 'web', v_user)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre/apertura.
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'location', p_location_id, v_loc_name, p_location_id, v_action, 'oficina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       v_user, 'web',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_location_status: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: estado guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', p_location_id, 'mode', p_mode, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_location_status: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', p_location_id, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', p_location_id, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;


-- ── 2) RPC por token (estación de tablet) ───────────────────────────────────
create or replace function public.set_location_status_by_token(
  p_device_token text,
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
  v_device     kds_device;
  v_account_id uuid;
  v_location   uuid;
  v_loc_name   text;
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
  v_action     text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_location_status_by_token: token de dispositivo no válido';
  end if;
  v_account_id := v_device.account_id;
  v_location   := v_device.location_id;
  update kds_device set last_seen_at = now() where id = v_device.id;

  if p_mode not in ('normal', 'busy', 'paused') then
    raise exception 'set_location_status_by_token: mode no válido %', p_mode;
  end if;

  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception 'set_location_status_by_token: reason_code no válido %', p_reason_code;
  end if;

  select name into v_loc_name from locations where id = v_location;

  update locations
  set hubrise_status_mode      = p_mode,
      hubrise_status_resume_at = case when p_mode = 'normal' then null else p_resume_at end,
      hubrise_status_reason    = case when p_mode = 'normal' then null else p_reason end,
      hubrise_status_set_at    = now(),
      hubrise_status_set_by    = null
  where id = v_location;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = v_location
  limit 1;

  v_patch := jsonb_build_object('order_acceptance', jsonb_strip_nulls(jsonb_build_object(
    'mode', p_mode, 'resume_at', p_resume_at, 'reason', p_reason
  )));

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
  values
    (v_account_id, v_location, v_ext_loc, 'order_acceptance', v_patch, p_mode, p_resume_at, p_reason, 'tablet', null)
  returning id into v_log_id;

  -- ANALÍTICA (C1) — fire-and-forget: nunca bloquea el cierre/apertura.
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;
  begin
    insert into availability_event
      (account_id, scope, target_id, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'location', v_location, v_loc_name, v_location, v_action, 'cocina',
       case when v_action = 'close' then p_reason_code else null end,
       case when v_action = 'close' then p_reason else null end,
       null, 'tablet',
       case when v_action = 'close' then p_resume_at else null end);
  exception when others then
    raise warning 'set_location_status_by_token: fallo insertando availability_event: %', sqlerrm;
  end;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: estado guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'set_location_status_by_token: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', v_location, 'mode', p_mode, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.set_location_status(uuid, text, timestamptz, text, text)') is null then
    raise exception 'set_location_status no quedó creada con la firma esperada (uuid, text, timestamptz, text, text)';
  end if;
  if to_regprocedure('public.set_location_status_by_token(text, text, timestamptz, text, text)') is null then
    raise exception 'set_location_status_by_token no quedó creada con la firma esperada (text, text, timestamptz, text, text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select proname, pg_get_functiondef(oid) from pg_proc
-- where proname in ('set_location_status','set_location_status_by_token')
--   and pronamespace = 'public'::regnamespace;
-- Confirmar que el cuerpo contiene 'availability_event' y 'p_reason_code'.
--
-- Cerrar y reabrir un local de prueba (web y token) y verificar:
-- select scope, action, origin, surface, reason_code, reason_note, actor_id, resume_at, occurred_at
-- from availability_event where scope = 'location' order by occurred_at desc limit 4;
-- Debe salir 1 fila 'close' + 1 fila 'open' por cada camino (web/token).
