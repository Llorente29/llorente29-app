-- Aplicada: 2026-08-12 por MCP
--
-- ENCARGO last-catalog-sync v2 §4 — cron horario que invoca la Edge Function
-- last-catalog-sync para cada integración Last activa. Sin esto el espejo
-- depende de que alguien lo dispare a mano — así se quedó congelado 52 días
-- (21/06 -> 12/08) sin que nadie se enterase (ver
-- 20260812T1300_ecp_sellos_disponibilidad.sql y el watchdog de este mismo
-- encargo, 20260812T1410_last_catalog_watchdog.sql).
--
-- Multi-tenant: UNA llamada net.http_post POR (account_id, external_org_id)
-- activo en external_integration — nunca un barrido "global" sin org
-- explícita (Last respondería por la organización por defecto y daría una
-- foto FALSA del negocio propio).
--
-- Horario de servicio: 12-23 UTC. cron.timezone de este proyecto es GMT fijo
-- sin DST (ver nota igual en 20260816T0902_db_health_watchdog.sql) — en
-- verano (CEST, UTC+2) son las 14-01 Madrid. Deuda de precisión conocida y
-- no oculta; no se resuelve aquí.
--
-- Secreto: lastapp_internal_key en Vault, MISMO valor que el secret de Edge
-- Function LASTAPP_INTERNAL_KEY (fijado por Julio 12/08). Insertado por MCP
-- directamente en Vault, NO en esta migración — no se commitea un secreto en
-- texto plano al repo.

CREATE OR REPLACE FUNCTION public.last_catalog_sync_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_row    record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'lastapp_internal_key';
  if v_secret is null then
    raise warning 'last_catalog_sync_dispatch: secreto lastapp_internal_key ausente en Vault, no se dispara nada';
    return;
  end if;

  for v_row in
    select distinct account_id, external_org_id
    from public.external_integration
    where source = 'lastapp' and is_active = true
  loop
    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/last-catalog-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_secret),
      body    := jsonb_build_object('account_id', v_row.account_id, 'external_org_id', v_row.external_org_id),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$function$;

comment on function public.last_catalog_sync_dispatch() is
  'Dispara la Edge Function last-catalog-sync (net.http_post, fire-and-forget) '
  'para cada (account_id, external_org_id) activo en external_integration '
  'source=lastapp. Cron last-catalog-sync-hourly, horario de servicio 12-23 UTC.';

revoke all on function public.last_catalog_sync_dispatch() from public, anon, authenticated;

select cron.schedule(
  'last-catalog-sync-hourly',
  '0 12-23 * * *',
  $cron$select public.last_catalog_sync_dispatch()$cron$
);
