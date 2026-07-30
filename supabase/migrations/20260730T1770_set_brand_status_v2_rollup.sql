-- 20260730T1770_set_brand_status_v2_rollup.sql
-- ============================================================================
-- CAP. B — FIX: location_status_log (kind=brand_closure) se quedaba con
-- ok/http_status/resolved_at siempre NULL. Causa: set_brand_status(_by_token)
-- reutiliza availability-dispatch (Fase 0), que loguea el resultado en
-- availability_push_log — pero nadie volvía a escribir en la fila de
-- location_status_log que se creó al principio. Cap. A/D no tienen este
-- problema porque llaman a hubrise-location-dispatch, que SÍ recibe un
-- log_id y actualiza esa fila exacta.
--
-- FIX: se manda location_status_log_id (=v_log_id) en el cuerpo del
-- net.http_post a availability-dispatch (v6, 20260730T1761 — ya sabe hacer
-- el rollup si recibe ese campo). Único cambio respecto a la v1 de 1740:
-- +'location_status_log_id' en los dos jsonb_build_object del cuerpo. Resto
-- IDÉNTICO.
--
-- Misma firma -> sin DROP. AVISO DEL RUNNER (esta sesión, ver 1712/1713/1750):
-- BEGIN/COMMIT + GUARD final por to_regprocedure — no dar nada por hecho.
-- Aplicada: —
-- ============================================================================

begin;

-- ── RPC de oficina (con sesión) ─────────────────────────────────────────────
create or replace function public.set_brand_status(
  p_brand_id    uuid,
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
  v_account_id   uuid;
  v_user         uuid := auth.uid();
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_count        int;
  v_secret       text;
  v_log_id       uuid;
begin
  select account_id into v_account_id from brand where id = p_brand_id;
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
  p_reason       text        default null
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
  v_matriculas   text[];
  v_affected_ids uuid[];
  v_count        int;
  v_secret       text;
  v_log_id       uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_brand_status_by_token: token de dispositivo no válido';
  end if;
  v_account_id := v_device.account_id;
  update kds_device set last_seen_at = now() where id = v_device.id;

  select account_id into v_brand_acc from brand where id = p_brand_id;
  if v_brand_acc is null then
    raise exception 'set_brand_status_by_token: marca % no encontrada', p_brand_id;
  end if;
  if v_brand_acc <> v_account_id then
    raise exception 'set_brand_status_by_token: la marca no pertenece a la cuenta del dispositivo';
  end if;

  if p_mode not in ('normal', 'paused') then
    raise exception 'set_brand_status_by_token: mode no válido % (solo normal|paused)', p_mode;
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
  if to_regprocedure('public.set_brand_status(uuid, text, timestamptz, text)') is null then
    raise exception 'set_brand_status no quedó creada con la firma esperada';
  end if;
  if to_regprocedure('public.set_brand_status_by_token(text, uuid, text, timestamptz, text)') is null then
    raise exception 'set_brand_status_by_token no quedó creada con la firma esperada';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select pg_get_functiondef(oid) from pg_proc
-- where proname = 'set_brand_status' and pronamespace = 'public'::regnamespace;
-- Confirmar que el cuerpo contiene 'location_status_log_id'.
--
-- Tras cerrar una marca de prueba: select id, kind, mode, ok, error, resolved_at
-- from location_status_log where kind='brand_closure' order by created_at desc limit 1;
-- ok/resolved_at ya NO deben quedar NULL.
