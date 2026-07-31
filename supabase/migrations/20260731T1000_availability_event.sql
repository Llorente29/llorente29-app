-- 20260731T1000_availability_event.sql
-- ============================================================================
-- DISPONIBILIDAD · C1 — CIMIENTO DE DATOS. Log de eventos append-only,
-- grado-analítica, que cubre los TRES scopes (producto/marca/local) con
-- taxonomía de ORIGEN (quién/qué camino) y MOTIVO tipificado (por qué).
--
-- NO sustituye a `location_status_log` (ese sigue siendo el log de DESPACHO
-- HubRise: patch_body, ok/http_status/error). Este es el espinazo de
-- ANALÍTICA que corre en paralelo — cimiento del panel de informes (C3).
--
-- Por qué hace falta (RECON 31/07):
--   · local/marca ya se auditan bien en location_status_log, pero orientado
--     al despacho, no al informe (sin taxonomía de origen ni motivo tipificado).
--   · producto (86): `product_availability` es tabla de ESTADO — la fila se
--     BORRA al reactivar (set_product_availability). Sin duración, sin
--     histórico, sin quién reactivó. CERO auditoría de producto hoy.
--
-- Duración: se computa emparejando close→open por (account_id, scope,
-- coalesce(target_id::text, target_ext)) cronológicamente — vista/consulta
-- del encargo C3, NO se almacena aquí. Un close sin open posterior = sigue
-- cerrado (duración = now() - occurred_at).
--
-- Escrituras SOLO por las RPC SECURITY DEFINER existentes (set_location_status
-- /_by_token, set_brand_status/_by_token, set_product_availability/_by_token
-- — próximas migraciones de este mismo encargo). Sin policy de insert: solo
-- lectura para managers/admins, mismo patrón que location_status_log.
--
-- source_log_id: puente de idempotencia con location_status_log.id, SOLO
-- para el backfill del histórico (próxima migración). NULL en todo evento
-- nuevo escrito por las RPC en vivo.
--
-- DDL pura, sin función DEFINER -> segura en el SQL Editor de una vez.
-- Aplicada: —
-- ============================================================================

create table if not exists public.availability_event (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,

  scope        text not null check (scope in ('product','brand','location')),
  target_id    uuid,               -- brand_id | location_id | null para producto
  target_ext   text,               -- producto: external_id (matrícula) o recipe_item_id; null si no aplica
  target_label text,               -- nombre denormalizado para el informe (marca/producto/local)
  location_id  uuid references public.locations(id),  -- local afectado (para filtrar informes por local); null si no aplica

  action       text not null check (action in ('close','open')),
                                   -- close = cerrar local/marca o agotar producto
                                   -- open  = reabrir local/marca o reactivar producto
  origin       text not null check (origin in ('cocina','oficina','plataforma','auto','sistema')),
  reason_code  text check (reason_code in
                 ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro')),
  reason_note  text,               -- libre opcional (lo que hoy es `reason`); solo relevante en 'close'

  actor_id     uuid,               -- set_by (user_profiles.id); null = tablet/token/sistema
  surface      text check (surface in ('web','tablet','system')),
  resume_at    timestamptz,        -- reapertura prevista (solo en close)
  channels     text[],             -- catálogos/canales afectados (opcional, para desglose futuro)

  occurred_at  timestamptz not null default now(),

  source_log_id uuid unique        -- puente de idempotencia con location_status_log.id (backfill). NULL en eventos nuevos.
);

create index if not exists ix_availability_event_acct_time
  on public.availability_event (account_id, occurred_at desc);
create index if not exists ix_availability_event_scope_target
  on public.availability_event (account_id, scope, target_id, target_ext, occurred_at);

alter table public.availability_event enable row level security;
drop policy if exists availability_event_read on public.availability_event;
create policy availability_event_read on public.availability_event
  for select using (
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(account_id)
  );
-- Escrituras SOLO por RPC SECURITY DEFINER. Sin policy de insert.

-- ── GUARD: no dar por hecho el CREATE ───────────────────────────────────────
do $$
begin
  if to_regclass('public.availability_event') is null then
    raise exception 'availability_event no quedó creada';
  end if;
end $$;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select column_name, data_type, is_nullable from information_schema.columns
-- where table_schema = 'public' and table_name = 'availability_event' order by ordinal_position;
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.availability_event'::regclass;
--
-- select * from pg_policies where tablename = 'availability_event';
