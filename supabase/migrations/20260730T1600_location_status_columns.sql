-- 20260730T1600_location_status_columns.sql
-- ============================================================================
-- CAP. C — ESTADO DEL LOCAL (Cerrar local / Reabrir). Columnas de "verdad
-- actual" en `locations`, mismo patrón que dispatch_mode/availability_auto_mode.
--
-- OJO NOMBRES: esto es DISTINTO de `order_acceptance_config` (tabla ya
-- existente, auto-ACEPTACIÓN de pedidos entrantes por canal×marca — otra
-- cosa). Aquí es el estado de apertura del LOCAL en HubRise (paused/busy/
-- normal). Para no chocar con ese nombre, las columnas van prefijadas
-- `hubrise_status_*` y el concepto en Folvy se llama "estado del local".
--
-- hubrise_status_mode 'normal'|'busy'|'paused' (default 'normal' = nunca
-- tocado). El botón "Cerrar local" solo usa 'paused' (busy = "acepto con
-- retraso", otra función que no pide este encargo). resume_at/reason solo
-- tienen sentido si mode <> 'normal' (el RPC los limpia al reabrir).
--
-- DDL pura, segura para ejecutar de una vez.
-- Aplicada: —
-- ============================================================================

alter table public.locations
  add column if not exists hubrise_status_mode      text not null default 'normal'
    check (hubrise_status_mode in ('normal', 'busy', 'paused')),
  add column if not exists hubrise_status_resume_at  timestamptz,
  add column if not exists hubrise_status_reason     text,
  add column if not exists hubrise_status_set_at     timestamptz,
  add column if not exists hubrise_status_set_by     uuid;

comment on column public.locations.hubrise_status_mode is
  'normal|busy|paused — estado de aceptación de pedidos del local en HubRise (Cap. C). NO confundir con order_acceptance_config (auto-aceptación por canal×marca).';
comment on column public.locations.hubrise_status_resume_at is
  'Reapertura programada (HubRise reabre solo al llegar esta hora). NULL = indefinido o normal.';
