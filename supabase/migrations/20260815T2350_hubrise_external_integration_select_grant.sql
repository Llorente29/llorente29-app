-- 20260815T1700_hubrise_external_integration_select_grant.sql
-- ENCARGO CODE — módulo de conexión HubRise, 2.4 (15/08/2026).
--
-- Hallazgo (probando hubrise_location_status con un usuario real
-- impersonado, no como superusuario -- MCP salta RLS/GRANT): external_integration
-- es la ÚNICA tabla entre locations/sale/external_location_map/brand_hubrise_catalog
-- sin GRANT SELECT de tabla para anon/authenticated (verificado con
-- pg_class.relacl, no con information_schema.column_privileges, que puede
-- mostrar privilegios heredados de forma engañosa). Sin ese GRANT base, la
-- policy RLS `lastapp_integration_read` (SELECT) es INERTE -- RLS solo
-- restringe FILAS, nunca sustituye el privilegio base de columna/tabla.
--
-- Esto es PREEXISTENTE a esta sesión (un REVOKE de columna, como el del
-- punto 0 de hoy, nunca puede tocar pg_class.relacl -- son ACLs
-- independientes). No lo causé yo, pero bloquea 2.4 (la RPC es SECURITY
-- INVOKER, tal como pidió Julio) y, aparte, probablemente ya bloquea
-- lastappIntegrationService.listIntegrations() en producción (mismo motivo).
--
-- Arreglo MÍNIMO para 2.4: GRANT SELECT columna a columna, EXCLUYENDO
-- explícitamente access_token y token_secret_name -- deja intacto el cierre
-- del punto 0 de hoy (declarado y cerrado por Julio esta misma sesión, no se
-- reabre aquí). token_secret_name queda fuera de este GRANT a propósito:
-- aunque el propio lastappIntegrationService.ts documenta que esa columna no
-- es sensible, reabrirla es una decisión de seguridad aparte que Julio debe
-- tomar explícitamente, no una consecuencia automática de arreglar 2.4.
do $$
begin
  grant select (
    id, account_id, external_org_id, organization_name, ownership_type,
    is_active, created_at, updated_at, push_status_enabled, source,
    external_catalog_id, external_location_id, connection_name,
    token_status, token_checked_at, location_id,
    external_account_name, external_location_name
  ) on public.external_integration to anon, authenticated;
end $$;
