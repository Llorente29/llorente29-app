-- 20260815T2410_hubrise_external_integration_grant_repair.sql
-- ENCARGO CODE — módulo de conexión HubRise, reparación tras el punto 0 (15/08/2026).
--
-- Dos daños encontrados y corregidos aquí:
--
-- 1) token_secret_name se cerró de más en 20260815T2300 (punto 0). Esa
--    columna NO es sensible: guarda el NOMBRE de un secret de entorno, no su
--    valor (documentado en el propio lastappIntegrationService.ts: "el VALOR
--    del token NUNCA pasa por aquí"). Rompía la única pantalla que la usa
--    ("Integraciones Last.app" en CuentaDetallePage → IntegrationsSection,
--    listIntegrations()). Se restaura SELECT + INSERT solo para
--    `authenticated` — NO para `anon`: `anon` la tenía antes, pero un rol
--    sin cuenta no obtiene filas por RLS de todos modos (lastapp_integration_read/
--    write exigen account_id/current_user_is_admin_of), así que devolverle
--    el privilegio sería restaurar de más.
--
-- 2) Hallazgo NUEVO, no causado por el punto 0 (verificado por Julio):
--    anon/authenticated no tenían GRANT INSERT en NINGUNA columna de
--    external_integration -- ni siquiera las que nunca se tocaron. Coherente
--    con el hallazgo de 20260815T2350 (tampoco tenían SELECT de tabla): esta
--    tabla nunca tuvo los GRANT base de INSERT/SELECT que sí tienen
--    locations/sale/external_location_map/brand_hubrise_catalog -- un REVOKE
--    de columna (como el del punto 0) nunca pudo causar esto, son ACLs
--    independientes (pg_class.relacl vs pg_attribute.attacl).
--
--    Inventario antes de reparar (único escritor de cliente, verificado por
--    grep completo de src/): createIntegration() en lastappIntegrationService.ts
--    hace UN SOLO INSERT, exactamente estas 7 columnas (nunca UPDATE):
--      account_id, source, external_org_id, organization_name,
--      token_secret_name, ownership_type, is_active
--    (id/created_at/updated_at/push_status_enabled usan DEFAULT, Postgres
--    solo exige privilegio INSERT sobre columnas con valor explícito en la
--    sentencia). Se restaura INSERT exactamente sobre esas 7, solo para
--    `authenticated`, excluyendo access_token explícitamente.
--
-- access_token: SIN CAMBIOS -- sigue cerrado a SELECT e INSERT para
-- anon/authenticated. El cierre del punto 0 para esta columna era correcto y
-- se mantiene intacto.
do $$
begin
  grant select (token_secret_name) on public.external_integration to authenticated;

  grant insert (
    account_id, source, external_org_id, organization_name,
    token_secret_name, ownership_type, is_active
  ) on public.external_integration to authenticated;
end $$;
