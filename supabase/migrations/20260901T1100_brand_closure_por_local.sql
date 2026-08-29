-- 20260901T1100_brand_closure_por_local.sql
-- ============================================================================
-- PREPARADA EL 29/08. NO APLICADA. Se aplica el lunes 01/09 con calma.
--
-- PROBLEMA (pasó hoy, 29/08, en servicio)
-- Cerrar una marca la cierra en TODOS los locales. Camichi cerró Meraki Pita en
-- Carabanchel y se apagó también en Alcalá. En availability_event hay 7 eventos
-- sobre esa marca entre las 11:23 y las 12:13 alternando close/open/close:
-- alguien peleándose con un interruptor que no hace lo que dice.
--
-- CAUSA — no es un filtro que falte, es el grano de la tabla
-- El estado de cierre son cinco columnas de `brand`, y `brand` no tiene
-- location_id: una marca es UNA fila para toda la cuenta.
--   brand.closure_mode / closure_resume_at / closure_reason
--   brand.closure_set_at / closure_set_by
-- Y hay una segunda mitad, en el empuje: set_brand_status manda al despachador
--   'external_location_ids', to_jsonb(array[]::text[]),
--   'location_id',           null,
-- o sea, a todos los catálogos de la marca.
--
-- MODELO: (b), tabla nueva. FILA PRESENTE = CERRADA EN ESE LOCAL.
-- Es exactamente el patrón de product_availability, que ya funciona y ya es por
-- local para el 86. No se cuelga de brand_location_availability: esa es el
-- catálogo COMERCIAL (active_since / inactive_since) y mezclaría una pausa de
-- treinta minutos con una decisión de años; el día que alguien confunda las dos,
-- apaga una marca de un local para siempre.
-- Sin columna `mode`: si existiera, cabría una fila 'normal' y volveríamos a
-- tener dos verdades. La existencia de la fila ES el cierre.
--
-- EL DESPACHADOR NO SE TOCA
-- availability-dispatch ya resuelve por local desde hace tiempo: lee
-- external_location_map (index.ts:206-210) y filtra catálogos y conexiones
-- (:229, :252, :282, :301). Verificado el 29/08 que el mapa está completo:
-- Meraki Pita -> Alcalá 1b6p8-0 (cat dmmj9), Carabanchel 1b6p8-2 (cat x77xp).
-- Aquí sólo se le empieza a pasar el location_id que siempre supo leer.
--
-- LA TRAMPA DE LA REAPERTURA, DESARMADA
-- Hoy, reabrir empuja enable=true para TODAS las matrículas por-marca. Verificado
-- el 29/08: Meraki Pita tiene 9 productos con un 86 REAL y propio en Alcalá
-- (Kebab de Pollo Gyros, Kebab Mixto, Pita BOWL Mixto, Pita BOWL Pollo, Plato
-- Mixto Gyros, Plato Pollo Gyros, Plato Ternera Gyros, The Golden Chicken, The
-- Mixed Master). Al reabrir, HubRise los recibiría encendidos mientras Folvy
-- sigue diciendo agotado: dos verdades separándose EN SILENCIO, porque
-- set_brand_status no toca product_availability y desde Folvy no se ve nada.
-- (El décimo agotado, Coca-Cola Zero Lata, es stock_group compartido y ya estaba
-- excluido: cerrar la marca nunca lo tocó.)
-- Desde aquí, reabrir NO enciende un producto que tenga su propio 86 vivo en ese
-- local. La reapertura devuelve la marca, no pisa el 86 del cocinero.
--
-- brand.closure_* — POR ORDEN DE JULIO, NO SE BORRAN TODAVÍA
-- migrar -> dejar de escribirlas -> COMMENT marcándolas obsoletas con fecha ->
-- DROP en una segunda pasada, cuando esté verificado que el front tampoco las
-- lee. Se encontraron 5 lectores en base de datos y ninguna vista ni trigger,
-- pero el front no entra en ese barrido. Un DROP equivocado rompe producción;
-- una columna huérfana no rompe nada. El disparador del borrado está escrito
-- abajo, para que no se quede para siempre.
--
-- FIRMAS (regla 2: añadir un parámetro es DROP + CREATE, nunca REPLACE)
--   · set_brand_status_by_token: MISMA FIRMA. Saca el local del dispositivo.
--     La tablet de cocina, que es donde se cierra en servicio, queda arreglada
--     SIN desplegar app.
--   · set_brand_status: DROP de la de 5 args, CREATE de la de 6 con
--     p_location_id OBLIGATORIO (sin DEFAULT: un default null volvería a
--     significar "todos los locales", que es justo el fallo). Se deja una
--     función de 5 args que NO cierra nada y explica qué hacer, para que un
--     cliente viejo reciba un mensaje claro en vez de un 404 de PostgREST.
--   · brand_status: DROP de la de 2 args, CREATE de la de 3 con p_location_id
--     DEFAULT NULL (aquí null = "resumen de la marca", que es una respuesta
--     legítima, no un cierre a ciegas). Las llamadas de 2 args siguen valiendo.
--   · closed_brands / anomalous_brand_closures: misma firma, ahora una entrada
--     por (marca, local).
-- ============================================================================

begin;

-- ── 1. La tabla ─────────────────────────────────────────────────────────────
create table if not exists public.brand_closure (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid        not null references public.accounts(id)  on delete cascade,
  brand_id     uuid        not null references public.brand(id)     on delete cascade,
  location_id  uuid        not null references public.locations(id) on delete cascade,
  resume_at    timestamptz,
  reason       text,
  reason_code  text,
  set_at       timestamptz not null default now(),
  set_by       uuid,
  surface      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint brand_closure_una_por_marca_y_local unique (brand_id, location_id)
);

comment on table public.brand_closure is
  'Cierre operativo de una marca EN UN LOCAL. Fila presente = cerrada ahi; fila '
  'ausente = abierta. Mismo patron que product_availability. NO confundir con '
  'brand_location_availability, que es el catalogo comercial (donde opera la marca).';

create index if not exists brand_closure_account_idx  on public.brand_closure (account_id);
create index if not exists brand_closure_location_idx on public.brand_closure (location_id);

alter table public.brand_closure enable row level security;

drop policy if exists brand_closure_read on public.brand_closure;
create policy brand_closure_read on public.brand_closure
  for select using (public.current_user_is_admin()
                    or public.current_user_is_admin_or_manager_of(account_id));

grant select on public.brand_closure to authenticated, anon, service_role;

-- ── 2. Migrar el estado que hay AHORA — A MANO, NO POR TRADUCCION ──────────
-- Traducir `closure_mode='paused'` a "cerrada en todos los locales activos"
-- seria repetir el fallo al migrarlo. Meraki Pita figura cerrada en global,
-- pero ALCALA NO DEBE QUEDAR CERRADA: su escaparate se restauro hoy 29/08 a las
-- 14:27 acotando el enable=true a 1b6p8-0, y esta vendiendo. Solo Carabanchel
-- sigue cerrada, que es lo que cocina queria.
--
-- Por eso va una sola fila, escrita con nombre y apellidos, y una GUARDA que
-- para si el mundo no es el que se verifico el 29/08 a las 18:00.
--
-- Ids verificados uno a uno contra brand_location_availability,
-- brand_hubrise_catalog, external_location_map y kds_device, porque `locations`
-- tiene FILAS DUPLICADAS POR NOMBRE: hay otra "Foodint Carabanchel"
-- (a4f9c286-...) y otra "Foodint Alcala" (8a78366c-...) que solo llevan mapeos
-- zy9j2-* y ningun catalogo de esta marca. Anclar por nombre habria cerrado el
-- local equivocado.
--   Carabanchel 92d7656e-082e-452a-8ebc-236b2d6ebf5f -> 1b6p8-2 / cat x77xp
--   Alcala      38158159-cd71-4056-950b-53425afac1ce -> 1b6p8-0 / cat dmmj9  (NO se cierra)
do $mig$
declare
  v_brand uuid := 'cc89c6eb-afb8-4308-884e-9aac83986b22';  -- Meraki Pita (la real: 184 ventas/30d)
  v_loc   uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';  -- Foodint Carabanchel
  v_acc   uuid;
  v_n     int;
  v_marcas text;
begin
  select count(*), string_agg(name, ', ' order by name)
    into v_n, v_marcas
  from brand where closure_mode is distinct from 'normal';

  if v_n <> 1 then
    raise exception 'ABORTA: hay % marca(s) con closure_mode <> normal (%). El 29/08 a las 18:00 habia exactamente 1. '
                    'Parar y decidir A MANO en que locales va cada una: traducirlo automaticamente repetiria el fallo.',
                    v_n, coalesce(v_marcas, '-');
  end if;

  if not exists (select 1 from brand where id = v_brand and closure_mode is distinct from 'normal') then
    raise exception 'ABORTA: la unica marca cerrada no es Meraki Pita (%). Es: %. Parar y preguntar.', v_brand, v_marcas;
  end if;

  select account_id into v_acc from brand where id = v_brand;

  if not exists (select 1 from locations where id = v_loc and account_id = v_acc) then
    raise exception 'ABORTA: el local % no existe o no es de la cuenta de la marca', v_loc;
  end if;
  if not exists (select 1 from brand_location_availability
                  where brand_id = v_brand and location_id = v_loc and is_active = true) then
    raise exception 'ABORTA: la marca no opera en el local % segun brand_location_availability', v_loc;
  end if;

  insert into public.brand_closure
    (account_id, brand_id, location_id, resume_at, reason, set_at, set_by, surface)
  select v_acc, v_brand, v_loc, b.closure_resume_at, b.closure_reason,
         coalesce(b.closure_set_at, now()), b.closure_set_by, 'migracion'
  from brand b where b.id = v_brand
  on conflict (brand_id, location_id) do nothing;

  raise notice 'migrada 1 fila: Meraki Pita cerrada SOLO en Foodint Carabanchel. Alcala queda ABIERTA.';
end
$mig$;

-- ── 3. El nucleo, sin guardas (patron de la casa: los cores no llaman a
--       auth.uid(), para que sirvan tambien sin sesion) ─────────────────────
create or replace function public._set_brand_closure_core(
  p_brand_id     uuid,
  p_location_ids uuid[],
  p_mode         text,
  p_resume_at    timestamptz,
  p_reason       text,
  p_reason_code  text,
  p_account_id   uuid,
  p_actor        uuid,
  p_origin       text,
  p_surface      text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_brand_name text;
  v_action     text;
  v_secret     text;
  v_log_id     uuid;
  v_loc        uuid;
  v_matriculas text[];
  v_ids        uuid[];
  v_count      int;
  v_total      int := 0;
  v_locales    int := 0;
begin
  if p_mode not in ('normal', 'paused') then
    raise exception '_set_brand_closure_core: mode no valido % (solo normal|paused)', p_mode;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception '_set_brand_closure_core: reason_code no valido %', p_reason_code;
  end if;
  if p_location_ids is null or array_length(p_location_ids, 1) is null then
    raise exception '_set_brand_closure_core: sin locales sobre los que actuar';
  end if;

  select name into v_brand_name from brand where id = p_brand_id;
  v_action := case when p_mode = 'normal' then 'open' else 'close' end;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'availability_dispatch_secret';

  foreach v_loc in array p_location_ids loop
    v_locales := v_locales + 1;

    -- 3a. El estado. La fila ES el cierre.
    if p_mode = 'paused' then
      insert into brand_closure
        (account_id, brand_id, location_id, resume_at, reason, reason_code, set_at, set_by, surface)
      values
        (p_account_id, p_brand_id, v_loc, p_resume_at, p_reason, p_reason_code, now(), p_actor, p_surface)
      on conflict (brand_id, location_id) do update
        set resume_at   = excluded.resume_at,
            reason      = excluded.reason,
            reason_code = excluded.reason_code,
            set_at      = now(),
            set_by      = excluded.set_by,
            surface     = excluded.surface,
            updated_at  = now();
    else
      delete from brand_closure
       where brand_id = p_brand_id and location_id = v_loc;
    end if;

    -- 3b. Que matriculas se empujan.
    -- Refs POR-MARCA: SOLO stock_group_id IS NULL. Los compartidos (Coca-Cola,
    -- etc.) NUNCA se tocan aqui: cerrar la marca no los agota.
    -- Y AL REABRIR, ademas, se excluyen los que tienen su propio 86 vivo en ESTE
    -- local: la reapertura devuelve la marca, no pisa el 86 del cocinero.
    select array_agg(distinct mi.external_id) filter (where mi.external_id is not null),
           array_agg(distinct mi.id),
           count(*)
      into v_matriculas, v_ids, v_count
    from menu_item mi
    where mi.account_id    = p_account_id
      and mi.brand_id      = p_brand_id
      and mi.stock_group_id is null
      and mi.external_id   is not null
      and mi.archived_at   is null
      and ( p_mode = 'paused'
            or not exists (
                 select 1 from product_availability pa
                  where pa.account_id = mi.account_id
                    and pa.is_available = false
                    and (pa.available_until is null or pa.available_until > now())
                    and (pa.location_id = v_loc or pa.location_id is null)
                    and ( (mi.external_id    is not null and pa.external_id    = mi.external_id)
                       or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) ) ) );

    v_total := v_total + coalesce(v_count, 0);

    -- 3c. El log de esta pata.
    insert into location_status_log
      (account_id, brand_id, location_id, kind, patch_body, mode, resume_at, reason, surface, set_by)
    values
      (p_account_id, p_brand_id, v_loc, 'brand_closure',
       jsonb_build_object('brand_id', p_brand_id, 'location_id', v_loc,
                          'mode', p_mode, 'items', coalesce(v_count, 0)),
       p_mode, p_resume_at, p_reason, p_surface, p_actor)
    returning id into v_log_id;

    -- 3d. Analitica, fire-and-forget: nunca bloquea el cierre.
    --     Ahora location_id es REAL, no informativo.
    begin
      insert into availability_event
        (account_id, scope, target_id, target_label, location_id, action, origin,
         reason_code, reason_note, actor_id, surface, resume_at)
      values
        (p_account_id, 'brand', p_brand_id, v_brand_name, v_loc, v_action, p_origin,
         case when v_action = 'close' then p_reason_code else null end,
         case when v_action = 'close' then p_reason      else null end,
         p_actor, p_surface,
         case when v_action = 'close' then p_resume_at   else null end);
    exception when others then
      raise warning '_set_brand_closure_core: fallo insertando availability_event: %', sqlerrm;
    end;

    -- 3e. El empuje, YA CON LOCAL.
    if v_matriculas is null or array_length(v_matriculas, 1) = 0 then
      update location_status_log
         set ok = true,
             error = 'Sin productos por-marca que empujar en este local (todo compartido, sin matricula, o con 86 propio al reabrir)',
             resolved_at = now()
       where id = v_log_id;
    elsif v_secret is null then
      update location_status_log
         set ok = false, error = 'secret availability_dispatch_secret ausente en Vault', resolved_at = now()
       where id = v_log_id;
      raise warning '_set_brand_closure_core: secret ausente en Vault, no se empuja al despachador';
    else
      perform net.http_post(
        url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
        headers := jsonb_build_object(
          'Content-Type',                   'application/json',
          'x-availability-dispatch-secret', v_secret
        ),
        body    := jsonb_build_object(
          'account_id',              p_account_id,
          'matriculas',              to_jsonb(v_matriculas),
          'affected_menu_item_ids',  to_jsonb(coalesce(v_ids, array[]::uuid[])),
          'external_location_ids',   to_jsonb(array[]::text[]),
          'location_id',             v_loc,
          'available_until',         p_resume_at,
          'enable',                  (p_mode = 'normal'),
          'reason',                  'manual',
          'location_status_log_id',  v_log_id
        )
      );
    end if;
  end loop;

  return jsonb_build_object('brand_id', p_brand_id, 'mode', p_mode,
                            'locations', v_locales, 'items', v_total);
end;
$function$;


-- ── 4. Tablet: MISMA FIRMA, ahora saca el local del dispositivo ─────────────
-- Es la puerta que se usa en servicio. Queda arreglada sin desplegar la app.
create or replace function public.set_brand_status_by_token(
  p_device_token text,
  p_brand_id     uuid,
  p_mode         text,
  p_resume_at    timestamptz default null,
  p_reason       text        default null,
  p_reason_code  text        default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device    kds_device;
  v_brand_acc uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_brand_status_by_token: token de dispositivo no valido';
  end if;
  if v_device.location_id is null then
    raise exception 'set_brand_status_by_token: el dispositivo % no tiene local asignado; '
                    'cerrar una marca es por local y sin local no se puede decidir', v_device.id;
  end if;

  select account_id into v_brand_acc from brand where id = p_brand_id;
  if v_brand_acc is null then
    raise exception 'set_brand_status_by_token: marca % no encontrada', p_brand_id;
  end if;
  if v_brand_acc <> v_device.account_id then
    raise exception 'set_brand_status_by_token: la marca no pertenece a la cuenta del dispositivo';
  end if;

  return public._set_brand_closure_core(
    p_brand_id, array[v_device.location_id], p_mode, p_resume_at, p_reason,
    p_reason_code, v_device.account_id, null, 'cocina', 'tablet');
end;
$function$;

-- ── 5. Oficina: DROP + CREATE, con el local OBLIGATORIO ─────────────────────
-- Sin DEFAULT a proposito. Un default null volveria a significar "todos los
-- locales", que es exactamente el fallo que esta migracion arregla.
drop function if exists public.set_brand_status(uuid, text, timestamptz, text, text);

create or replace function public.set_brand_status(
  p_brand_id    uuid,
  p_mode        text,
  p_location_id uuid,
  p_resume_at   timestamptz default null,
  p_reason      text        default null,
  p_reason_code text        default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_loc_acc    uuid;
begin
  select account_id into v_account_id from brand where id = p_brand_id;
  if v_account_id is null then
    raise exception 'set_brand_status: marca % no encontrada', p_brand_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_brand_status: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_location_id is null then
    raise exception 'set_brand_status: falta el local. Cerrar una marca es POR LOCAL: '
                    'en la vista consolidada no se puede decidir en cual.';
  end if;

  select account_id into v_loc_acc from locations where id = p_location_id;
  if v_loc_acc is null then
    raise exception 'set_brand_status: local % no encontrado', p_location_id;
  end if;
  if v_loc_acc <> v_account_id then
    raise exception 'set_brand_status: el local no pertenece a la cuenta de la marca';
  end if;

  return public._set_brand_closure_core(
    p_brand_id, array[p_location_id], p_mode, p_resume_at, p_reason,
    p_reason_code, v_account_id, auth.uid(), 'oficina', 'web');
end;
$function$;

-- Cliente viejo: mensaje claro en vez de un 404 de PostgREST. NO cierra nada.
create or replace function public.set_brand_status(
  p_brand_id    uuid,
  p_mode        text,
  p_resume_at   timestamptz default null,
  p_reason      text        default null,
  p_reason_code text        default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'set_brand_status: esta version cierra la marca en TODOS los locales y '
                  'esta retirada desde el 01/09/2026. Actualiza la aplicacion: ahora hay que '
                  'indicar el local. Desde la tablet de cocina no hace falta hacer nada.';
end;
$function$;

comment on function public.set_brand_status(uuid, text, timestamptz, text, text) is
  'RETIRADA 01/09/2026. Solo lanza excepcion. Existe para que un cliente viejo reciba '
  'un mensaje que se entiende. BORRAR cuando no queden llamadas de 5 argumentos: '
  'select count(*) from availability_event where scope=''brand'' and location_id is null '
  'and occurred_at > now() - interval ''30 days'';';


-- ── 6. Lectores ─────────────────────────────────────────────────────────────
-- brand_status: DROP + CREATE para admitir el local. Aqui p_location_id SI
-- lleva DEFAULT NULL, porque null significa "resumen de la marca", que es una
-- respuesta legitima y honesta -- no un cierre a ciegas.
drop function if exists public.brand_status(uuid, text);

create or replace function public.brand_status(
  p_brand_id    uuid,
  p_token       text default null,
  p_location_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account uuid;
  v_name    text;
  v_loc     uuid := p_location_id;
  v_device  kds_device;
  v_row     brand_closure;
  v_locs    jsonb;
  v_total   int;
  v_cerr    int;
begin
  select account_id, name into v_account, v_name from brand where id = p_brand_id;
  if v_account is null then
    raise exception 'brand_status: marca % no encontrada', p_brand_id;
  end if;

  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'brand_status: token de dispositivo no valido';
    end if;
    if v_device.account_id <> v_account then
      raise exception 'brand_status: la marca no pertenece a la cuenta del dispositivo';
    end if;
    v_loc := coalesce(v_loc, v_device.location_id);
  else
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'brand_status: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  -- Desglose por local. Regla 7: nunca se devuelve solo una palabra; se devuelve
  -- la lista, para que ninguna pantalla pueda decir "abierta" escondiendo que
  -- esta cerrada en otro sitio.
  select coalesce(jsonb_agg(jsonb_build_object(
           'location_id',   l.id,
           'location_name', l.name,
           'closed',        (bc.id is not null),
           'resume_at',     bc.resume_at,
           'reason',        bc.reason,
           'set_at',        bc.set_at
         ) order by l.name), '[]'::jsonb),
         count(*), count(bc.id)
    into v_locs, v_total, v_cerr
  from brand_location_availability bla
  join locations l on l.id = bla.location_id and coalesce(l.active, true) = true
  left join brand_closure bc on bc.brand_id = p_brand_id and bc.location_id = l.id
  where bla.brand_id = p_brand_id and bla.is_active = true;

  if v_loc is not null then
    select * into v_row from brand_closure
     where brand_id = p_brand_id and location_id = v_loc;
    return jsonb_build_object(
      'brand_id',      p_brand_id,
      'brand_name',    v_name,
      'location_id',   v_loc,
      'mode',          case when v_row.id is not null then 'paused' else 'normal' end,
      'resume_at',     v_row.resume_at,
      'reason',        v_row.reason,
      'set_at',        v_row.set_at,
      'closed_count',  v_cerr,
      'total_count',   v_total,
      'locations',     v_locs);
  end if;

  -- Sin local: resumen honesto. 'paused' SOLO si esta cerrada en todos.
  return jsonb_build_object(
    'brand_id',     p_brand_id,
    'brand_name',   v_name,
    'location_id',  null,
    'mode',         case when v_total > 0 and v_cerr = v_total then 'paused' else 'normal' end,
    'resume_at',    null,
    'reason',       null,
    'set_at',       null,
    'closed_count', v_cerr,
    'total_count',  v_total,
    'locations',    v_locs);
end;
$function$;

-- closed_brands: una entrada por (marca, local). Con token, solo el local del
-- dispositivo. La cocina de Alcala no tiene por que ver los cierres de Carabanchel.
create or replace function public.closed_brands(
  p_account_id uuid default null,
  p_token      text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_account uuid;
  v_loc     uuid := null;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'closed_brands: token de dispositivo no valido';
    end if;
    v_account := v_device.account_id;
    v_loc     := v_device.location_id;
  else
    if p_account_id is null then
      raise exception 'closed_brands: falta account_id';
    end if;
    v_account := p_account_id;
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'closed_brands: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id',      b.id,
           'brand_name',    b.name,
           'location_id',   l.id,
           'location_name', l.name,
           'mode',          'paused',
           'resume_at',     bc.resume_at,
           'reason',        bc.reason,
           'set_at',        bc.set_at
         ) order by b.name, l.name), '[]'::jsonb)
    into v_result
  from brand_closure bc
  join brand b     on b.id = bc.brand_id
  join locations l on l.id = bc.location_id
  where bc.account_id = v_account
    and (v_loc is null or bc.location_id = v_loc)
    and (bc.resume_at is null or bc.resume_at > now());

  return v_result;
end;
$function$;

-- anomalous_brand_closures: cierres olvidados, tambien por (marca, local).
create or replace function public.anomalous_brand_closures(
  p_account_id uuid default null,
  p_token      text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_account uuid;
  v_loc     uuid := null;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'anomalous_brand_closures: token de dispositivo no valido';
    end if;
    v_account := v_device.account_id;
    v_loc     := v_device.location_id;
  else
    if p_account_id is null then
      raise exception 'anomalous_brand_closures: falta account_id';
    end if;
    v_account := p_account_id;
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'anomalous_brand_closures: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id',      b.id,
           'brand_name',    b.name,
           'location_id',   l.id,
           'location_name', l.name,
           'resume_at',     bc.resume_at,
           'set_at',        bc.set_at,
           'reason',        bc.reason,
           'kind',          case when bc.resume_at is null then 'indefinite' else 'expired' end
         ) order by b.name, l.name), '[]'::jsonb)
    into v_result
  from brand_closure bc
  join brand b     on b.id = bc.brand_id
  join locations l on l.id = bc.location_id
  where bc.account_id = v_account
    and (v_loc is null or bc.location_id = v_loc)
    and ( (bc.resume_at is null     and bc.set_at    < now() - interval '24 hours')
       or (bc.resume_at is not null and bc.resume_at < now()) );

  return v_result;
end;
$function$;

-- ── 7. Las cinco columnas viejas: marcadas, no borradas ─────────────────────
-- Nadie las escribe ya. Se dejan hasta verificar que el front tampoco las lee.
comment on column public.brand.closure_mode is
  'OBSOLETA desde 01/09/2026: el cierre es POR LOCAL y vive en brand_closure. '
  'Ya no la escribe nadie. BORRAR en una segunda pasada (ver disparador abajo).';
comment on column public.brand.closure_resume_at is
  'OBSOLETA desde 01/09/2026: ver brand_closure.resume_at.';
comment on column public.brand.closure_reason is
  'OBSOLETA desde 01/09/2026: ver brand_closure.reason.';
comment on column public.brand.closure_set_at is
  'OBSOLETA desde 01/09/2026: ver brand_closure.set_at.';
comment on column public.brand.closure_set_by is
  'OBSOLETA desde 01/09/2026: ver brand_closure.set_by.';

-- DISPARADOR DEL BORRADO, escrito para que no se quede para siempre.
-- Se hace el DROP cuando las TRES cosas sean ciertas:
--   1) ninguna funcion de base de datos las nombra:
--      select p.proname from pg_proc p
--       where p.pronamespace='public'::regnamespace
--         and p.prosrc ~ 'closure_mode|closure_resume_at|closure_reason|closure_set_at|closure_set_by';
--      -- esperado: CERO filas.
--   2) el front tampoco, en la version desplegada:
--      grep -rn "closure_mode\|closure_resume_at\|closure_reason" src/
--      -- esperado: solo comentarios.
--   3) han pasado al menos 30 dias desde el 01/09/2026 sin una sola llamada de
--      5 argumentos (ver el COMMENT de set_brand_status retirada).
-- Entonces:
--   alter table public.brand
--     drop column closure_mode, drop column closure_resume_at,
--     drop column closure_reason, drop column closure_set_at,
--     drop column closure_set_by;

-- ── 8. GUARDA FINAL ─────────────────────────────────────────────────────────
do $ver$
declare v_n int;
begin
  if to_regclass('public.brand_closure') is null then
    raise exception 'brand_closure no quedo creada';
  end if;
  if to_regprocedure('public._set_brand_closure_core(uuid, uuid[], text, timestamptz, text, text, uuid, uuid, text, text)') is null then
    raise exception 'el core no quedo con la firma esperada';
  end if;
  if to_regprocedure('public.set_brand_status(uuid, text, uuid, timestamptz, text, text)') is null then
    raise exception 'set_brand_status por local no quedo con la firma esperada';
  end if;
  if to_regprocedure('public.set_brand_status_by_token(text, uuid, text, timestamptz, text, text)') is null then
    raise exception 'set_brand_status_by_token no quedo con la firma esperada';
  end if;
  if to_regprocedure('public.brand_status(uuid, text, uuid)') is null then
    raise exception 'brand_status por local no quedo con la firma esperada';
  end if;
  if to_regprocedure('public.brand_status(uuid, text)') is not null then
    raise exception 'la brand_status de 2 argumentos sigue viva: sobrecarga ambigua (regla 2)';
  end if;

  -- Ninguna funcion escribe ya las columnas viejas.
  select count(*) into v_n from pg_proc p
   where p.pronamespace='public'::regnamespace
     and p.prosrc ~ 'closure_mode\s*=|closure_set_at\s*=|closure_resume_at\s*=';
  if v_n > 0 then
    raise exception 'todavia hay % funcion(es) escribiendo brand.closure_*', v_n;
  end if;

  raise notice 'VERIFICACION OK: el cierre de marca es por local';
end
$ver$;

commit;

-- ── Comprobaciones DESPUES de aplicar (pegar el resultado, no el resumen) ────
--
-- 1) El estado migrado, una fila por marca y local:
-- select b.name, l.name, bc.resume_at, bc.set_at
--   from brand_closure bc join brand b on b.id=bc.brand_id
--   join locations l on l.id=bc.location_id order by 1,2;
--   -- esperado el 29/08: Meraki Pita en Alcala y en Carabanchel.
--
-- 2) Cerrar en un local NO cierra en el otro (probar y deshacer):
-- select public.set_brand_status('<marca>','paused','<local A>');
-- select public.brand_status('<marca>', null, '<local B>')->>'mode';  -- normal
-- select public.set_brand_status('<marca>','normal','<local A>');
--
-- 3) La trampa desarmada: al reabrir, los que tienen 86 propio NO se empujan.
--    Tras reabrir Meraki Pita en Alcala, en location_status_log la fila debe
--    decir items = (por-marca) - (los que tengan 86 vivo en Alcala).
--
-- 4) Nadie escribe ya las columnas viejas:
-- select proname from pg_proc where pronamespace='public'::regnamespace
--   and prosrc ~ 'closure_mode\s*=';   -- esperado: CERO filas.
