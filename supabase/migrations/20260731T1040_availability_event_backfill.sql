-- 20260731T1040_availability_event_backfill.sql
-- ============================================================================
-- DISPONIBILIDAD · C1 — BACKFILL del histórico real de local+marca desde
-- `location_status_log` (Fase A/Cap. B/C) hacia `availability_event`.
--
-- Alcance:
--   · kind='order_acceptance' -> scope='location', target_id=location_id.
--   · kind='brand_closure'    -> scope='brand',    target_id=brand_id.
--   · kind='opening_hours' (Cap. D, horarios) QUEDA FUERA: no es un evento de
--     cierre/apertura de disponibilidad, es una edición de horario semanal
--     (mode es NULL en esas filas — no hay close/open que mapear).
--   · action: mode in ('paused','busy') -> 'close'; mode='normal' -> 'open'.
--   · origin: surface='web' -> 'oficina'; surface='tablet' -> 'cocina'.
--   · reason_note = location_status_log.reason (texto libre de siempre).
--     reason_code = NULL (no tipificado en el histórico, honesto — no se inventa).
--
-- Producto (86): SIN backfill. `product_availability` borra la fila al
-- reactivar -> no queda histórico que recuperar. Arranca de cero desde el
-- despliegue de esta migración (aceptado en el encargo, §6).
--
-- IDEMPOTENCIA: cada fila backfillada lleva source_log_id = location_status_log.id
-- (columna UNIQUE en availability_event, migración 20260731T1000). Re-ejecutar
-- este script es seguro: `on conflict (source_log_id) do nothing` no duplica.
--
-- DDL/DML sin función DEFINER -> segura en el SQL Editor de una vez, pero es
-- un INSERT masivo sobre datos reales: BEGIN/COMMIT + verificación de conteo
-- ANTES/DESPUÉS incluida abajo (ejecutar a mano, no dar el resultado por bueno
-- solo por "Success").
-- Aplicada: —
-- ============================================================================

begin;

insert into public.availability_event
  (account_id, scope, target_id, target_label, location_id, action, origin,
   reason_code, reason_note, actor_id, surface, resume_at, occurred_at, source_log_id)
select
  l.account_id,
  case when l.kind = 'brand_closure' then 'brand' else 'location' end,
  coalesce(l.brand_id, l.location_id),
  coalesce(br.name, loc.name),
  l.location_id,
  case
    when l.mode in ('paused', 'busy') then 'close'
    when l.mode = 'normal'            then 'open'
  end,
  case l.surface
    when 'web'    then 'oficina'
    when 'tablet' then 'cocina'
    else 'sistema'
  end,
  null,
  l.reason,
  l.set_by,
  l.surface,
  l.resume_at,
  l.created_at,
  l.id
from public.location_status_log l
left join public.brand     br  on br.id  = l.brand_id
left join public.locations loc on loc.id = l.location_id
where l.kind in ('order_acceptance', 'brand_closure')
  and l.mode in ('paused', 'busy', 'normal')
on conflict (source_log_id) do nothing;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar, NO fiarse del "Success") ─────────────
-- 1) Conteo esperado vs conteo backfillado:
-- select count(*) from location_status_log
-- where kind in ('order_acceptance','brand_closure') and mode in ('paused','busy','normal');
--
-- select count(*) from availability_event where source_log_id is not null;
-- Los dos números deben coincidir.
--
-- 2) Re-ejecutar el INSERT de arriba (el bloque begin/insert/commit completo)
-- una segunda vez y repetir el conteo de (1) — NO debe crecer.
--
-- 3) Muestreo de correctitud (comparar contra el log original):
-- select ae.scope, ae.action, ae.origin, ae.surface, ae.target_label, ae.occurred_at,
--        l.kind, l.mode, l.surface as log_surface, l.created_at as log_created_at
-- from availability_event ae
-- join location_status_log l on l.id = ae.source_log_id
-- order by ae.occurred_at desc limit 20;
