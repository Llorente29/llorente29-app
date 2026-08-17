-- 20260815T2300_hubrise_revoke_token_columns.sql
-- ENCARGO CODE — módulo de conexión HubRise, punto 0 de 2.1 (15/08/2026).
-- Aplicada por MCP (verificada con information_schema.column_privileges
-- independiente: SELECT/INSERT de anon+authenticated sobre access_token y
-- token_secret_name, cero filas tras el REVOKE; service_role intacto).
--
-- external_integration.access_token / token_secret_name eran legibles y
-- escribibles por anon/authenticated: la policy lastapp_integration_read da
-- SELECT a cualquier usuario de la cuenta (account_id = ANY(current_user_account_ids()),
-- sin exigir admin), y los GRANTs de columna no lo acotaban más. Cualquier
-- empleado logueado podía leer el token real de HubRise (o el nombre del
-- secret de Last) de su cuenta con una llamada directa al cliente Supabase,
-- sin pasar por ningún código de Folvy.
--
-- Verificado antes de tocar: NINGÚN frontend usa estas columnas para nada
-- (grep completo de "external_integration" en src/ → un solo fichero,
-- lastappIntegrationService.ts, que solo lee token_secret_name — el NOMBRE
-- del secret, nunca el valor, por diseño explícito en su propio comentario).
-- El REVOKE no rompe nada existente.
--
-- Sustituye, como respuesta al riesgo real medido, a una migración a Vault
-- (que sigue siendo mejor y queda como DEUDA DECLARADA — ver comentario en
-- _shared/hubriseToken.ts: consolidar las lecturas duplicadas de
-- hubrise-catalog-publish/availability-dispatch en el helper compartido y
-- migrar a Vault, ANTES de conectar el cliente 2, no antes — tocar esos dos
-- ficheros en mitad de la certificación de Carabanchel mete riesgo donde no
-- toca). service_role (el único que de verdad necesita estas columnas: los
-- Edge Functions) queda intacto, no se toca.
--
-- NOTA (matiz verificado, no escondido): el REVOKE cierra SELECT/INSERT del
-- todo (eran solo a nivel de columna). UPDATE sigue siendo técnicamente
-- posible para anon/authenticated porque existe un GRANT UPDATE a nivel de
-- TABLA COMPLETA preexistente sobre external_integration (ajeno a esta
-- migración) que un REVOKE de columna no anula. Mitigado por la policy
-- lastapp_integration_write, que exige current_user_is_admin_of(account_id)
-- para cualquier escritura — un admin de la cuenta podría sobrescribir el
-- token a ciegas, pero no cualquier empleado, y no puede LEERLO. Cerrar esto
-- del todo exige tocar el GRANT de tabla completa (afecta a otras columnas
-- legítimamente editables por admin) — no incluido aquí, pendiente de
-- decisión si se quiere ir más allá.
do $$
begin
  revoke select, insert, update (access_token, token_secret_name)
    on public.external_integration
    from anon, authenticated;
end $$;
