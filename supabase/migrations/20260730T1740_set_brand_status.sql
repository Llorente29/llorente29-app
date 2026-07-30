-- 20260730T1740_set_brand_status.sql
-- ============================================================================
-- CAP. B — Cerrar marca. 86 masivo de los ref POR-MARCA de una marca (nunca
-- los compartidos: stock_group_id IS NULL de ese brand_id), vía la MISMA
-- maquinaria de disponibilidad de Fase 0 (availability-dispatch) — no se
-- reinventa un despachador nuevo, se reutiliza en modo batch.
--
-- Reutiliza (no rehace):
--   · availability-dispatch (empuje real a HubRise, mismo secret de Vault)
--   · location_status_log (Fase A) — se AMPLÍA para poder loguear por MARCA
--     además de por LOCAL: location_id pasa a nullable, +brand_id, +kind
--     'brand_closure'. Un solo registro auditable para las tres cosas.
--   · availability-watchdog ya escanea location_status_log sin filtrar por
--     kind -> los fallos de cierre de marca caen en la MISMA alarma sin tocar
--     el vigía.
--
-- Semáforo: columnas closure_* en `brand` (mismo patrón que
-- locations.hubrise_status_* de Cap. C).
--
-- NO toca product_availability (eso es la capa de 86 por producto, Fase 0;
-- cerrar marca es una acción de OTRO nivel — no genera N filas sintéticas ahí).
-- NO toca stock_group_id IS NOT NULL (compartidos): "cerrar una marca no mata
-- la Coca-Cola de las demás".
--
-- AVISO DEL RUNNER (esta sesión): el SQL editor se ha tragado statements de
-- scripts multi-sentencia reportando "Success" (índice, trigger y el delete
-- del reset — ver 20260730T1712/1713/1750). Este fichero tiene 2 ALTER TABLE
-- + 4 funciones: BEGIN/COMMIT + GUARD final que verifica columnas
-- (information_schema), constraints (pg_constraint) y funciones
-- (to_regprocedure) uno a uno — no se da nada por hecho. Verificar también a
-- mano el cuerpo de cada función tras ejecutar.
-- Aplicada: —
-- ============================================================================

begin;

-- ── 1) Semáforo de marca ────────────────────────────────────────────────────
alter table public.brand
  add column if not exists closure_mode      text not null default 'normal'
    check (closure_mode in ('normal', 'paused')),
  add column if not exists closure_resume_at timestamptz,
  add column if not exists closure_reason    text,
  add column if not exists closure_set_at    timestamptz,
  add column if not exists closure_set_by    uuid;

comment on column public.brand.closure_mode is
  'normal|paused — Cap. B "Cerrar marca". 86 masivo de los ref POR-MARCA (nunca los stock_group compartidos). paused = productos por-marca agotados en HubRise.';

-- ── 2) Ampliar location_status_log para cubrir marca (Fase A + Cap. B) ─────
alter table public.location_status_log
  alter column location_id drop not null,
  add column if not exists brand_id uuid references public.brand(id);

alter table public.location_status_log drop constraint if exists location_status_log_kind_check;
alter table public.location_status_log add constraint location_status_log_kind_check
  check (kind in ('order_acceptance', 'opening_hours', 'brand_closure'));

alter table public.location_status_log drop constraint if exists location_status_log_scope_chk;
alter table public.location_status_log add constraint location_status_log_scope_chk
  check (location_id is not null or brand_id is not null);

create index if not exists ix_location_status_log_brand_created
  on public.location_status_log (brand_id, created_at desc);

-- ── 3) RPC de oficina (con sesión) ──────────────────────────────────────────
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
      'account_id',            v_account_id,
      'matriculas',            to_jsonb(v_matriculas),
      'affected_menu_item_ids', to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
      'external_location_ids', to_jsonb(array[]::text[]),
      'location_id',           null,
      'available_until',       p_resume_at,
      'enable',                (p_mode = 'normal'),
      'reason',                'manual'
    )
  );

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;


-- ── 4) RPC por token (estación de tablet) ───────────────────────────────────
-- La marca no es del dispositivo (un local puede tener varias marcas): se
-- pasa p_brand_id y se valida que pertenece a la CUENTA del dispositivo.
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
      'account_id',            v_account_id,
      'matriculas',            to_jsonb(v_matriculas),
      'affected_menu_item_ids', to_jsonb(coalesce(v_affected_ids, array[]::uuid[])),
      'external_location_ids', to_jsonb(array[]::text[]),
      'location_id',           null,
      'available_until',       p_resume_at,
      'enable',                (p_mode = 'normal'),
      'reason',                'manual'
    )
  );

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode, 'items', v_count, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;


-- ── 5) Lectura del estado de marca (doble puerta) ───────────────────────────
create or replace function public.brand_status(
  p_brand_id uuid,
  p_token    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account     uuid;
  v_device_acc  uuid;
  v_name        text;
  v_mode        text;
  v_resume_at   timestamptz;
  v_reason      text;
  v_set_at      timestamptz;
begin
  select account_id, name, closure_mode, closure_resume_at, closure_reason, closure_set_at
    into v_account, v_name, v_mode, v_resume_at, v_reason, v_set_at
  from brand where id = p_brand_id;

  if v_account is null then
    raise exception 'brand_status: marca % no encontrada', p_brand_id;
  end if;

  if p_token is not null then
    declare v_device kds_device;
    begin
      v_device := public.kds_resolve_device(p_token);
      if v_device.id is null then raise exception 'brand_status: token de dispositivo no válido'; end if;
      v_device_acc := v_device.account_id;
    end;
    if v_device_acc <> v_account then
      raise exception 'brand_status: la marca no pertenece a la cuenta del dispositivo';
    end if;
  else
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'brand_status: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  return jsonb_build_object(
    'brand_id',   p_brand_id,
    'brand_name', v_name,
    'mode',       coalesce(v_mode, 'normal'),
    'resume_at',  v_resume_at,
    'reason',     v_reason,
    'set_at',     v_set_at
  );
end;
$function$;


-- ── 6) Lista de marcas para el selector "Cerrar marca" (tablet, sin sesión) ──
-- La web ya lee `brand` directo (RLS de sesión); esto es solo para el token
-- de dispositivo, que no tiene sesión.
create or replace function public.brands_by_token(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_result jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'brands_by_token: token de dispositivo no válido';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::jsonb)
    into v_result
  from brand b
  where b.account_id = v_device.account_id and b.is_active and b.archived_at is null;

  return v_result;
end;
$function$;

-- ── GUARD: no dar por hecho ningún "Success" — verificar contra pg_catalog /
-- information_schema que TODOS los objetos de este fichero quedaron creados
-- de verdad: 2 columnas, 2 constraints, y las 4 funciones con su firma exacta.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'brand' and column_name = 'closure_mode'
  ) then
    raise exception 'brand.closure_mode no quedó creada';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'location_status_log' and column_name = 'brand_id'
  ) then
    raise exception 'location_status_log.brand_id no quedó creada';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'location_status_log_kind_check' and conrelid = 'public.location_status_log'::regclass
  ) then
    raise exception 'location_status_log_kind_check no quedó creado';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'location_status_log_scope_chk' and conrelid = 'public.location_status_log'::regclass
  ) then
    raise exception 'location_status_log_scope_chk no quedó creado';
  end if;

  if to_regprocedure('public.set_brand_status(uuid, text, timestamptz, text)') is null then
    raise exception 'set_brand_status no quedó creada con la firma esperada (uuid, text, timestamptz, text)';
  end if;
  if to_regprocedure('public.set_brand_status_by_token(text, uuid, text, timestamptz, text)') is null then
    raise exception 'set_brand_status_by_token no quedó creada con la firma esperada (text, uuid, text, timestamptz, text)';
  end if;
  if to_regprocedure('public.brand_status(uuid, text)') is null then
    raise exception 'brand_status no quedó creada con la firma esperada (uuid, text)';
  end if;
  if to_regprocedure('public.brands_by_token(text)') is null then
    raise exception 'brands_by_token no quedó creada con la firma esperada (text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar a mano el CUERPO de cada función) ──────
-- select proname, pg_get_functiondef(oid) from pg_proc
-- where proname in ('set_brand_status','set_brand_status_by_token','brand_status','brands_by_token')
--   and pronamespace = 'public'::regnamespace;
--
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='brand' and column_name like 'closure_%';
-- Debe listar closure_mode, closure_resume_at, closure_reason, closure_set_at, closure_set_by.
