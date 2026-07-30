-- 20260730T1620_set_location_status.sql
-- ============================================================================
-- CAP. C — Cerrar local / Reabrir. RPC doble puerta (sesión | token, mismo
-- patrón que Fase 0) + lectura de estado + despacho al PATCH /locations/:id
-- de HubRise (order_acceptance).
--
--   set_location_status(location_id, mode, resume_at?, reason?)          -- web
--   set_location_status_by_token(device_token, mode, resume_at?, reason?) -- tablet
--   location_status(location_id?, token?)                                -- lectura
--
-- mode: 'normal'|'busy'|'paused'. El botón "Cerrar local" de este encargo usa
-- SIEMPRE 'paused' (busy = "acepto con retraso", otra función, no pedida
-- aquí). resume_at/reason se limpian al volver a 'normal'.
--
-- DEGRADACIÓN: si el local no tiene fila activa en external_location_map
-- (source=hubrise) — hoy Carabanchel/Plaza Castilla — el estado se escribe
-- igual en Folvy (semáforo interno funciona) pero NO se dispara el PATCH.
-- location_status_log deja constancia igual (external_location_id=NULL,
-- ok=true, error informativo) y devuelve connected=false para que la UI
-- pueda avisar "local no conectado a delivery".
--
-- SEGURIDAD: el secret del despachador (hubrise-location-dispatch, próxima
-- migración/edge) sale del Vault, NUNCA en claro. PRERREQUISITO (manual, una
-- vez, ejecutar ANTES de esta migración o el push queda en warning):
--   select vault.create_secret('fv_locst_7c1a3f6e0d9b48e2a5c6f10d7b3e8a92', 'location_status_dispatch_secret');
--
-- DDL sin BEGIN/COMMIT. Crea las funciones pero no las ejecuta -> segura en
-- el SQL Editor de una vez. Aplicada: —
-- ============================================================================

-- ── 1) RPC de oficina (con sesión) ──────────────────────────────────────────
create or replace function public.set_location_status(
  p_location_id uuid,
  p_mode        text,
  p_resume_at   timestamptz default null,
  p_reason      text        default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_user       uuid := auth.uid();
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
begin
  select account_id into v_account_id from locations where id = p_location_id;
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
  p_reason       text        default null
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
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_patch      jsonb;
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


-- ── 3) Lectura del estado (doble puerta) ────────────────────────────────────
create or replace function public.location_status(
  p_location_id uuid default null,
  p_token       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device      kds_device;
  v_loc         uuid;
  v_account     uuid;
  v_name        text;
  v_mode        text;
  v_resume_at   timestamptz;
  v_reason      text;
  v_set_at      timestamptz;
  v_ext_loc     text;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'location_status: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
    v_account := v_device.account_id;
  else
    if p_location_id is null then raise exception 'location_status: falta location_id'; end if;
    v_loc := p_location_id;
    v_account := public.kds_authorize(v_loc, null);
  end if;

  select l.name, l.hubrise_status_mode, l.hubrise_status_resume_at, l.hubrise_status_reason, l.hubrise_status_set_at
    into v_name, v_mode, v_resume_at, v_reason, v_set_at
  from locations l where l.id = v_loc;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = v_loc
  limit 1;

  return jsonb_build_object(
    'location_id',   v_loc,
    'location_name', v_name,
    'mode',          coalesce(v_mode, 'normal'),
    'resume_at',     v_resume_at,
    'reason',        v_reason,
    'set_at',        v_set_at,
    'connected',     v_ext_loc is not null
  );
end;
$function$;
