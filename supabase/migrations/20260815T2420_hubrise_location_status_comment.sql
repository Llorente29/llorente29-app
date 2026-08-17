-- 20260815T2420_hubrise_location_status_comment.sql
-- ENCARGO CODE — módulo de conexión HubRise, 2.4 (15/08/2026).
--
-- Nota de diseño en el propio contrato de la RPC, no solo en el fichero de
-- migración (Julio, 15/08): `brands` sale vacío para cualquier usuario que
-- no sea admin/manager de la cuenta -- RLS de brand_hubrise_catalog
-- (brand_hubrise_catalog_rw), no un bug de esta función. NO se fuerza a
-- SECURITY DEFINER para igualar el resultado entre roles: la pantalla de
-- integraciones de Fase 3 es admin-only (ajustes de cuenta, no herramienta
-- de turno) -- Fase 3 no debe diseñar para un rol ("worker") que nunca va a
-- entrar ahí.
comment on function public.hubrise_location_status(uuid) is
$cmt$Contrato de la pantalla de estado HubRise (Fase 3, ADMIN-ONLY).
5 estados por prioridad: local_inactivo > conectando > sin_conectar > token_invalido > conectado.
brands (via brand_hubrise_catalog) sale vacio para roles no admin/manager -- RLS de esa tabla,
intencional: la pantalla que consume esto es de ajustes de cuenta, no para "worker".$cmt$;

comment on function public._hubrise_location_pending_connect(uuid, uuid) is
$cmt$Helper SECURITY DEFINER interno de hubrise_location_status. Verifica autorizacion el mismo
(p_account_id = ANY(current_user_account_ids())) porque hubrise_oauth_state no tiene GRANT
para anon/authenticated (nonces efimeros, nunca legibles por clientes). No llamar directo desde frontend.$cmt$;
