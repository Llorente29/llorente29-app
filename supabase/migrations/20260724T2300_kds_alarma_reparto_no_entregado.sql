-- supabase/migrations/20260724T2300_kds_alarma_reparto_no_entregado.sql
-- ============================================================================
-- CAPA 2 — ALARMA de reparto NO ENTREGADO en el KDS (banner + sonido + "Enterado").
-- ============================================================================
-- Superficie ÚNICA de alarma (la reutilizarán también el vigía de Capa 4 y la
-- reconciliación de Capa 5): tres columnas en `sale`.
--   delivery_alarm_at     -> cuándo se levantó la alarma (null = sin alarma viva)
--   delivery_alarm_kind   -> 'failed' | 'canceled' | (futuro) 'stalled_*' | 'reconcile_*'
--   delivery_alarm_ack_at -> cuándo alguien pulsó "Enterado" (null = sigue sonando)
--
-- La alarma por FALLO se levanta sola vía trigger cuando delivery_state pasa a
-- failed/canceled — venga de donde venga (catcher-webhook, RPC de reparto propio,
-- trigger espejo). El KDS la lee sin filtrar por order_status/status: SALTA aunque
-- Last haya cerrado la comanda como 'completed' (caso Martin).
--
-- RPCs doble-puerta (sesión | token) calcadas de kds_board/kds_bump:
--   kds_alarms(location_id, token?)  -> alarmas vivas del local (sin reconocer)
--   kds_ack_alarm(sale_id, token?)   -> "Enterado": sella delivery_alarm_ack_at
--
-- SECURITY DEFINER con guard propio (kds_authorize). DDL sin BEGIN/COMMIT. Idempotente.
-- NO toca cancelled_at (un no-entregado NO es una cancelación).
-- ============================================================================

-- ── 1. Columnas de alarma ────────────────────────────────────────────────────
alter table public.sale add column if not exists delivery_alarm_at     timestamptz;
alter table public.sale add column if not exists delivery_alarm_kind   text;
alter table public.sale add column if not exists delivery_alarm_ack_at timestamptz;

-- Índice parcial: solo las alarmas VIVAS (levantadas y sin reconocer) por local.
create index if not exists sale_delivery_alarm_open_idx
  on public.sale (location_id, delivery_alarm_at)
  where delivery_alarm_at is not null and delivery_alarm_ack_at is null;

-- ── 2. Trigger: levantar la alarma al TRANSICIONAR a fallo/cancelación ────────
-- BEFORE UPDATE (modifica NEW, sin recursión). Reabre el ack (ack_at=null) para que
-- una re-caída vuelva a sonar. Solo reacciona al CAMBIO de delivery_state a un fallo
-- (una cancelación de pedido normal via status='cancelled' NO toca delivery_state,
-- así que no dispara falsas alarmas).
create or replace function public.tg_sale_delivery_alarm()
returns trigger
language plpgsql
as $$
begin
  if new.delivery_state is distinct from old.delivery_state
     and new.delivery_state in ('failed', 'canceled', 'cancelled') then
    new.delivery_alarm_at     := now();
    new.delivery_alarm_kind   := new.delivery_state;
    new.delivery_alarm_ack_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sale_delivery_alarm on public.sale;
create trigger trg_sale_delivery_alarm
  before update on public.sale
  for each row
  execute function public.tg_sale_delivery_alarm();

-- ── 3. kds_alarms: alarmas vivas del local (doble puerta) ─────────────────────
create or replace function public.kds_alarms(p_location_id uuid, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device  kds_device;
  v_loc     uuid;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'kds_alarms: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    if p_location_id is null then raise exception 'kds_alarms: falta location_id'; end if;
    v_loc := p_location_id;
    perform public.kds_authorize(v_loc, null); -- valida sesión (belongs_to_account)
  end if;

  select coalesce(jsonb_agg(row_to_json(a) order by a.raised_at desc), '[]'::jsonb)
  into v_result
  from (
    select s.id                                                             as sale_id,
           s.delivery_alarm_kind                                            as kind,
           s.delivery_alarm_at                                              as raised_at,
           s.delivery_state,
           s.order_status,
           coalesce(s.platform_order_code, s.external_tab_ref, s.external_ref) as code,
           s.customer_name,
           s.delivery_address,
           s.rider_name,
           s.rider_phone
    from sale s
    where s.location_id = v_loc
      and s.delivery_alarm_at is not null
      and s.delivery_alarm_ack_at is null
  ) a;

  return jsonb_build_object('location_id', v_loc, 'now', now(), 'alarms', v_result);
end;
$$;

-- ── 4. kds_ack_alarm: "Enterado" (sella el reconocimiento) ────────────────────
create or replace function public.kds_ack_alarm(p_sale_id uuid, p_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc uuid;
begin
  select location_id into v_loc from sale where id = p_sale_id;
  if v_loc is null then raise exception 'kds_ack_alarm: venta inexistente'; end if;
  perform public.kds_authorize(v_loc, p_token);
  update sale
  set delivery_alarm_ack_at = now(),
      updated_at            = now()
  where id = p_sale_id
    and delivery_alarm_ack_at is null;
end;
$$;
