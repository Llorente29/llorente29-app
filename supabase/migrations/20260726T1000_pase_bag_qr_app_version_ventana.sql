-- ============================================================================
-- Folvy · CÓDIGO DE PASE (release del papel) — soporte de BBDD
-- Encargo: ENCARGO_CODE código de pase · ticket de bolsa (26/07/2026)
--
-- Tres piezas, ninguna toca order_for_print ni los triggers de auto-impresión:
--
--   B) kitchen_time_config.bag_qr  → QR con el sale_id en el ticket de bolsa.
--      Se entrega APAGADO en todos los locales. El renderizador vive en la APK,
--      así que todo lo nuevo del papel nace apagable desde BBDD (mismo patrón
--      que bag_on_ready): encender/apagar = un UPDATE, sin DDL ni APK.
--      El flag viaja a la tablet dentro del job (claim_print_jobs.config).
--
--   C) kds_device.app_version / platform / app_version_at → fin de la ceguera
--      de flota: saber qué versión corre cada tablet. Lo escribe la app al
--      arrancar vía report_device_app_version (por token, sin login).
--
--   D) station_update_window(token) → ¿es seguro aplicar ahora una actualización
--      en esta estación? Devuelve las señales de BBDD (trabajos de impresión
--      pendientes, pedidos en curso, minutos desde la última venta). La señal de
--      inactividad táctil la aporta el cliente (UpdateGate); aquí va lo que sólo
--      la BBDD sabe. NUNCA un modal en mitad del pase.
--
-- IDEMPOTENTE: aplicar dos veces no rompe nada. Transaccional: o todo o nada.
-- Aplicar a mano en el SQL Editor (db push no opera contra este proyecto).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- B) Flag del QR de bolsa (por local). Nace en false: papel idéntico al de hoy.
-- ----------------------------------------------------------------------------
alter table public.kitchen_time_config
  add column if not exists bag_qr boolean not null default false;

comment on column public.kitchen_time_config.bag_qr is
  'Ticket de bolsa: imprimir QR con el sale_id (asociación pedido↔cámara del frente de visión). Off por defecto; se enciende con un UPDATE, sin APK.';

-- ----------------------------------------------------------------------------
-- C) Versión de la app por dispositivo.
-- ----------------------------------------------------------------------------
alter table public.kds_device
  add column if not exists app_version    text,
  add column if not exists platform       text,
  add column if not exists app_version_at timestamptz;

comment on column public.kds_device.app_version is
  'versionName/versionCode de la APK instalada, reportado por la propia app al arrancar.';
comment on column public.kds_device.platform is
  'Plataforma del dispositivo: android | ios | web.';
comment on column public.kds_device.app_version_at is
  'Cuándo reportó por última vez su versión (para detectar tablets rezagadas).';

-- Reporte de versión desde la app (token de dispositivo, sin login).
-- Best-effort por diseño: si el token no vale, NO lanza excepción — un fallo de
-- telemetría jamás debe romper el arranque de una estación.
create or replace function public.report_device_app_version(
  p_device_token text,
  p_app_version  text,
  p_platform     text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    return false;
  end if;

  update kds_device
     set app_version    = nullif(btrim(coalesce(p_app_version, '')), ''),
         platform       = nullif(btrim(coalesce(p_platform, '')), ''),
         app_version_at = now(),
         updated_at     = now()
   where id = v_device.id;

  return true;
end;
$$;

comment on function public.report_device_app_version(text, text, text) is
  'La app reporta su versión instalada. Devuelve false (no excepción) si el token no es válido.';

-- ----------------------------------------------------------------------------
-- D) Ventana de actualización segura (señales de BBDD).
-- ----------------------------------------------------------------------------
--   safe = sin trabajos de impresión vivos  AND  sin pedidos en curso
--          AND  la última venta del local es más antigua que p_quiet_minutes.
--
-- Guardarraíl anti-bloqueo eterno: los trabajos 'sent' sólo cuentan si son
-- recientes (< 60 min). Un job zombi de anteanoche no puede congelar la flota
-- en una versión vieja para siempre.
create or replace function public.station_update_window(
  p_device_token  text,
  p_quiet_minutes integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device        kds_device;
  v_pending_jobs  integer := 0;
  v_active_orders integer := 0;
  v_last_sale_min integer;
  v_quiet         integer := greatest(0, coalesce(p_quiet_minutes, 20));
  v_reasons       text[] := '{}';
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    -- Token no válido: no afirmamos que sea seguro, pero tampoco reventamos.
    return jsonb_build_object('ok', false, 'safe', false, 'reasons', to_jsonb(array['token_no_valido']));
  end if;

  select count(*) into v_pending_jobs
    from print_job j
   where j.location_id = v_device.location_id
     and (
          j.status = 'pending'
       or (j.status = 'sent' and j.sent_at > now() - interval '60 minutes')
     );

  select count(*) into v_active_orders
    from sale s
   where s.location_id = v_device.location_id
     and s.order_status is not null
     and s.order_status not in ('completed', 'cancelled')
     and s.created_at > now() - interval '12 hours';

  select floor(extract(epoch from (now() - max(s.created_at))) / 60)::int
    into v_last_sale_min
    from sale s
   where s.location_id = v_device.location_id
     and s.created_at > now() - interval '24 hours';

  if v_pending_jobs > 0 then
    v_reasons := v_reasons || 'trabajos_de_impresion_vivos';
  end if;
  if v_active_orders > 0 then
    v_reasons := v_reasons || 'pedidos_en_curso';
  end if;
  if v_last_sale_min is not null and v_last_sale_min < v_quiet then
    v_reasons := v_reasons || 'venta_reciente';
  end if;

  return jsonb_build_object(
    'ok',                    true,
    'safe',                  (array_length(v_reasons, 1) is null),
    'reasons',               to_jsonb(v_reasons),
    'pending_jobs',          v_pending_jobs,
    'active_orders',         v_active_orders,
    'minutes_since_sale',    v_last_sale_min,
    'quiet_minutes',         v_quiet
  );
end;
$$;

comment on function public.station_update_window(text, integer) is
  'Señales de BBDD para decidir si una estación puede actualizarse AHORA sin interrumpir el servicio.';

-- ----------------------------------------------------------------------------
-- claim_print_jobs — MISMA firma y MISMO contrato; sólo añade `config` a cada
-- job (config.bag_qr). Consumidores antiguos (agente Node, APK vieja) ignoran
-- el campo extra: cero rotura. Reproduce verbatim la definición viva del
-- 26/07/2026 salvo el bloque marcado.
-- ----------------------------------------------------------------------------
create or replace function public.claim_print_jobs(p_device_token text, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device  kds_device;
  v_jobs    jsonb;
  v_config  jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'claim_print_jobs: token no válido';
  end if;

  if v_device.device_mode is distinct from 'estacion' then
    return '[]'::jsonb;
  end if;

  update kds_device set last_seen_at = now() where id = v_device.id;

  -- ⟵ NUEVO (26/07): config del papel gobernada por BBDD. Si el local no tiene
  --    fila en kitchen_time_config, todo apagado (papel de siempre).
  select jsonb_build_object('bag_qr', coalesce(k.bag_qr, false))
    into v_config
    from kitchen_time_config k
   where k.location_id = v_device.location_id;
  v_config := coalesce(v_config, jsonb_build_object('bag_qr', false));

  with pend as (
    select j.id
    from print_job j
    join printer p on p.id = j.printer_id
    where j.account_id  = v_device.account_id
      and j.location_id = v_device.location_id
      and j.status = 'pending'
      and p.is_active
      and p.transport = 'escpos_network'
    order by j.created_at
    limit p_limit
    for update skip locked
  ),
  upd as (
    update print_job j
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    from pend
    where j.id = pend.id
    returning j.id, j.printer_id, j.doc_type, j.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id',   u.id,
           'doc_type', u.doc_type,
           'payload',  u.payload,
           'config',   v_config,
           'printer',  jsonb_build_object(
                         'id',   p.id,
                         'name', p.name,
                         'ip',   p.config->>'ip',
                         'port', coalesce((p.config->>'port')::int, 9100)
                       )
         )), '[]'::jsonb)
  into v_jobs
  from upd u
  join printer p on p.id = u.printer_id;

  return v_jobs;
end;
$$;

-- ----------------------------------------------------------------------------
-- GRANTS — patrón de las RPC por token (la estación no tiene login: anon).
-- ----------------------------------------------------------------------------
grant execute on function public.claim_print_jobs(text, integer)                    to anon;
grant execute on function public.report_device_app_version(text, text, text)        to anon, authenticated;
grant execute on function public.station_update_window(text, integer)               to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICACIÓN (ejecutar tras aplicar; no forma parte de la transacción)
-- ============================================================================
-- 1) El flag existe y está APAGADO en todos los locales:
--    select location_id, bag_on_ready, bag_qr from public.kitchen_time_config;
--
-- 2) claim_print_jobs sigue devolviendo array y ahora trae config:
--    select public.claim_print_jobs('<token de una estación>', 0);
--    -- (limit 0 → no reclama nada; sólo comprueba que no lanza)
--
-- 3) Ventana de actualización de una estación:
--    select public.station_update_window('<token>');
--
-- 4) Encender el QR en un local (cuando se quiera, sin APK):
--    update public.kitchen_time_config set bag_qr = true where location_id = '<uuid>';
-- ============================================================================
