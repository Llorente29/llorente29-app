-- 20260815T1940_hubrise_desactivar_bridge_bendito_burrito.sql
-- ENCARGO CODE — módulo de conexión HubRise, FASE 1.4.
-- Aplicada por MCP (verificada 2026-08-15: las 3 filas quedan is_active=false,
-- push_status_enabled ya estaba en false; external_brand_map SIN TOCAR,
-- 12 filas antes y después).
--
-- Desactivar (NO borrar) las 3 filas '%Bridge - Bendito Burrito' de
-- external_integration. Verificado antes de tocar: Bendito Burrito ya publica
-- por brand_hubrise_catalog (catálogo j99jm, token escritor) — la vía
-- primaria del publicador y de availability-dispatch. Las 3 filas Bridge ya
-- llevaban push_status_enabled=false (no empujaban nada hoy); is_active=false
-- solo las saca de las consultas de fallback que SÍ filtran is_active=true
-- (availability-dispatch líneas 258 y 298), quitando ruido sin cambiar ningún
-- comportamiento vivo. NO se toca external_brand_map: sus homónimas atribuyen
-- la marca en los pedidos entrantes.

update public.external_integration
set is_active = false, updated_at = now()
where source = 'hubrise'
  and connection_name like '%Bridge - Bendito Burrito'
  and is_active = true;
