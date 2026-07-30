-- 20260730T1610_location_status_log.sql
-- ============================================================================
-- REGISTRO AUDITABLE (§9-C) — una tabla para las DOS capacidades de local que
-- hacen PATCH /locations/:id a HubRise: Cap. C (order_acceptance: cerrar/
-- reabrir) y Cap. D (opening_hours: horario semanal). Mismo endpoint HubRise,
-- mismo registro. `patch_body` guarda el cuerpo EXACTO enviado (auditoría
-- real, no reconstruida). `kind` distingue para poder filtrar/leer bonito.
--
-- Quién/scope/inicio/resume_at/motivo/superficie/resultado — todo en una fila:
--   quién     -> set_by (sesión) / null (tablet, dispositivo del local)
--   scope     -> location_id (siempre un local, nunca "todos": Cap C/D son
--                 100% por local, no cascada cross-brand como el 86)
--   inicio    -> created_at
--   resume_at -> columna propia (solo relevante en order_acceptance)
--   motivo    -> reason
--   superficie-> surface ('web'|'tablet')
--   resultado -> ok/http_status/error, rellenados por el despachador
--                (ok=NULL mientras está en vuelo — fire-and-forget, igual
--                que Fase 0)
--
-- SECURITY DEFINER con guard propio en las RPC que escriben aquí (próxima
-- migración). Esta es DDL pura. Aplicada: —
-- ============================================================================

create table if not exists public.location_status_log (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null,
  location_id           uuid not null references public.locations(id),
  external_location_id  text,             -- NULL = local sin conexión HubRise (degradado)

  kind                  text not null check (kind in ('order_acceptance', 'opening_hours')),
  patch_body            jsonb not null,   -- cuerpo exacto que se envió (o se habría enviado)

  mode                  text,             -- solo kind='order_acceptance': normal|busy|paused
  resume_at             timestamptz,      -- solo kind='order_acceptance'
  reason                text,

  surface               text not null check (surface in ('web', 'tablet')),
  set_by                uuid,             -- user_profiles.id (sesión) o null (tablet/token)

  ok                    boolean,          -- NULL = pendiente (fire-and-forget en vuelo)
  http_status           int,
  error                 text,

  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

create index if not exists ix_location_status_log_location_created
  on public.location_status_log (location_id, created_at desc);

create index if not exists ix_location_status_log_failures
  on public.location_status_log (created_at desc)
  where ok is false;

alter table public.location_status_log enable row level security;

drop policy if exists location_status_log_read on public.location_status_log;
create policy location_status_log_read on public.location_status_log
  for select using (
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(account_id)
  );
