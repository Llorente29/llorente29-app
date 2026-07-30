-- 20260730T1540_availability_watchdog_cron.sql
-- ============================================================================
-- VIGÍA de disponibilidad — cron cada 15 min que invoca la Edge Function
-- `availability-watchdog` (nueva, se despliega junto a esta migración). Revisa
-- availability_push_log (columna `source`, migración 20260730T1510) buscando
-- fallos recientes del tramo HubRise y escala UNA alarma agregada a
-- `system-alert` (mismo patrón que hubrise-callback-ensure) — cierra el
-- agujero "nadie mira el log".
--
-- Sin secreto en la cabecera: mismo patrón que hubrise-callback-ensure (Edge
-- desplegada con --no-verify-jwt; no acepta parámetros externos, solo lee y
-- alerta). El propio availability-watchdog usa el secreto 'cron_secret' del
-- Vault (ya existente, ver 20260705T1500_ping_cron_vault) para autenticarse
-- contra system-alert.
--
-- IDEMPOTENTE: cron.schedule(job_name, ...) hace upsert por nombre.
-- REQUISITOS: extensiones pg_cron y pg_net (ya instaladas).
-- Aplicada: —
-- ============================================================================

select cron.schedule(
  'availability-watchdog',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-watchdog',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);
