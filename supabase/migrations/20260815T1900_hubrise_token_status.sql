-- 20260815T1900_hubrise_token_status.sql
-- ENCARGO CODE — módulo de conexión HubRise, FASE 1.3 (salud de token).
-- Aplicada por MCP (verificada 2026-08-15: columnas + CHECK confirmados vía
-- information_schema / pg_constraint independiente del "Success" del editor).
--
-- token_status: 'ok' (último ping respondió sin 401) | 'invalid' (401
-- confirmado) | 'unknown' (aún no pingueado, o el ping falló por causa
-- distinta de 401 — nunca se marca invalid a ciegas por un fallo de red/5xx
-- transitorio). Lo actualiza la Edge Function `hubrise-connection-health`
-- (cron 30 min, ver 20260815T1910_hubrise_connection_health_cron.sql).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_integration' and column_name='token_status'
  ) then
    alter table public.external_integration
      add column token_status text not null default 'unknown';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_integration' and column_name='token_checked_at'
  ) then
    alter table public.external_integration
      add column token_checked_at timestamptz;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'external_integration_token_status_check'
  ) then
    alter table public.external_integration
      add constraint external_integration_token_status_check
      check (token_status in ('ok','invalid','unknown'));
  end if;
end $$;
