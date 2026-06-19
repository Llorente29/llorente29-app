-- supabase/migrations/20260619T0930_set_order_status.sql
-- ============================================================================
-- RPC set_order_status · avanza el ciclo de plataforma de un pedido en el feed.
-- ============================================================================
-- El feed de Pedidos muestra order_status pero hasta ahora NADIE lo movía: un
-- pedido entraba 'accepted' y se quedaba inerte. Esta RPC permite avanzarlo a
-- mano desde la pantalla Pedidos (Empezar -> Listo -> Completar, o cancelar),
-- para CUALQUIER canal (Last, HubRise, futuros). Es la "ruta completa" del pedido.
--
-- ALCANCE (honesto): mueve SOLO el estado OPERATIVO INTERNO de Folvy
-- (sale.order_status). NO toca el ciclo contable (sale.status open/closed) ni el
-- consumo de stock —eso lo gobierna el cierre real del canal (el webhook, con
-- close_sale)—, y NO notifica todavía a la plataforma (decirle a Glovo "listo"
-- es la "capa de empuje" por canal, frente posterior). Aquí: la verdad operativa
-- del pedido dentro de Folvy, para que cocina/encargado sepan en qué punto está.
--
-- Más adelante el KDS llamará a esta MISMA RPC al marcar listo (puente KDS->feed),
-- sin reescribir nada: el botón manual y el KDS son dos fuentes del mismo avance.
--
-- Guard de usuario (manager/admin de la cuenta) -> NO probar en SQL Editor
-- (auth.uid() null); se prueba desde la app. Transición libre entre estados
-- válidos: es acción humana deliberada (permite corregir/reabrir); el front solo
-- ofrece las transiciones sensatas.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_order_status(
  p_sale_id uuid,
  p_new_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acc uuid;
  v_cur text;
BEGIN
  SELECT account_id, order_status INTO v_acc, v_cur FROM sale WHERE id = p_sale_id;
  IF v_acc IS NULL THEN
    RAISE EXCEPTION 'set_order_status: venta inexistente';
  END IF;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_acc)) THEN
    RAISE EXCEPTION 'set_order_status: sin acceso a la cuenta %', v_acc;
  END IF;

  IF p_new_status IS NULL OR p_new_status NOT IN (
    'new','received','accepted','in_preparation','awaiting_collection',
    'awaiting_shipment','in_delivery','completed','rejected','cancelled','delivery_failed'
  ) THEN
    RAISE EXCEPTION 'set_order_status: estado no válido %', p_new_status;
  END IF;

  UPDATE sale
  SET order_status = p_new_status,
      updated_at   = now()
  WHERE id = p_sale_id;

  RETURN p_new_status;
END;
$function$;

COMMIT;
