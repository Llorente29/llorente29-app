-- supabase/migrations/20260724T2310_reparto_fallo_a_incidencias.sql
-- ============================================================================
-- CAPA 3 — Un fallo de REPARTO PROPIO llega a Incidencias (order_status).
-- ============================================================================
-- Hoy el trigger espejo delivery_assignment -> sale escribe delivery_state pero
-- NUNCA order_status, así que un reparto propio fallido se queda en 'in_delivery'
-- (Activos) para siempre. Aquí se añade: cuando la asignación pasa a failed/canceled,
-- el pedido va a order_status='delivery_failed' (Incidencias) — con la MISMA regla
-- no-gateada que el catcher-webhook (Capa 1): se levanta AUNQUE Last lo haya cerrado
-- como 'completed'; solo se respeta un terminal DELIBERADO (cancelado/rechazado) o un
-- fallo ya marcado. El cambio de delivery_state dispara además la alarma del KDS (Capa 2).
--
-- NO se toca cancelled_at (un no-entregado NO es cancelación). CREATE OR REPLACE de
-- la función del trigger (la migración original ya está aplicada). DDL sin BEGIN/COMMIT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_mirror_delivery_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_state text;
  v_name  text;
  v_phone text;
  v_veh   text;
BEGIN
  v_state := CASE NEW.state
    WHEN 'offered'     THEN 'matching'
    WHEN 'accepted'    THEN 'matched'
    WHEN 'picked_up'   THEN 'in_delivery'
    WHEN 'in_delivery' THEN 'in_delivery'
    WHEN 'delivered'   THEN 'delivered'
    WHEN 'failed'      THEN 'failed'
    WHEN 'canceled'    THEN 'canceled'
    ELSE NEW.state
  END;

  IF NEW.courier_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.transport_type
      INTO v_name, v_phone, v_veh
      FROM public.courier c WHERE c.id = NEW.courier_id;
  END IF;

  UPDATE public.sale s SET
    carrier_code       = 'own_fleet',
    delivery_state     = v_state,
    -- NUEVO (Capa 3): fallo/cancelación de reparto → Incidencias. No-gateado a
    -- "abierto" (Last puede haberlo cerrado como completed); solo se respeta un
    -- terminal deliberado. Cualquier otro estado deja order_status intacto.
    order_status       = CASE
                           WHEN NEW.state IN ('failed','canceled')
                                AND s.order_status NOT IN ('cancelled','rejected','delivery_failed')
                           THEN 'delivery_failed'
                           ELSE s.order_status
                         END,
    rider_name         = COALESCE(v_name, s.rider_name),
    rider_phone        = COALESCE(v_phone, s.rider_phone),
    rider_transport_type = COALESCE(v_veh, s.rider_transport_type),
    has_courier        = (NEW.courier_id IS NOT NULL),
    transport_price    = COALESCE(NEW.transport_price, s.transport_price),
    dispatch_error     = NULL
  WHERE s.id = NEW.sale_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_delivery_assignment ON public.delivery_assignment;
CREATE TRIGGER trg_mirror_delivery_assignment
  AFTER INSERT OR UPDATE ON public.delivery_assignment
  FOR EACH ROW EXECUTE FUNCTION public.tg_mirror_delivery_assignment();
