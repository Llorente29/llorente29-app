-- supabase/migrations/20260619T0940_lastapp_push_toggle.sql
-- ============================================================================
-- Toggle de EMPUJE de estados a Last (Folvy -> Last -> Glovo/Uber).
-- ============================================================================
-- Cuando Folvy avanza un pedido (Empezar/Listo/Completar), puede notificar a Last
-- vía PUT /orders/{tabId}/status, y Last lo reenvía a la plataforma. Eso permite
-- que Folvy SUSTITUYA la tablet de Last (sin empuje, la plataforma penaliza por
-- falta de avisos y harían falta dos tablets).
--
-- ARRANCA APAGADO (default false): construir/desplegar sin riesgo de empujar a
-- Glovo por accidente. Se ENCIENDE a mano cuando el cliente quiere que Folvy
-- gobierne los estados. También sirve a clientes que prefieran seguir confirmando
-- en Last (lo dejan apagado).
--
-- A nivel INTEGRACIÓN (toda la cuenta/organización Last). Si en el futuro se
-- necesita por local, se mueve a lastapp_location_map (declarado, no hoy).
-- ============================================================================

ALTER TABLE public.lastapp_integration
  ADD COLUMN IF NOT EXISTS push_status_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lastapp_integration.push_status_enabled IS
  'Si true, Folvy empuja los cambios de order_status a Last (PUT /orders/{tabId}/status). Apagado por defecto.';
