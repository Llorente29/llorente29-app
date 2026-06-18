-- 20260618T2400_sale_order_status.sql
-- Aplicada: 2026-06-18
--
-- CICLO DE VIDA DEL PEDIDO — fase 1a (fundamento).
--
-- `sale.status` es el estado CONTABLE de la venta (open/closed/cancelled) — intocable.
-- El estado del PEDIDO DE PLATAFORMA (delivery) es OTRA cosa y vive aparte en
-- `sale.order_status`, espejando los estados canónicos de HubRise. Lo mueve el cliente
-- desde la pestaña Pedidos (empujándolo a HubRise) y lo refresca el webhook de entrada
-- cuando la plataforma cambia el estado (p.ej. Uber → in_delivery/completed).
--
-- Estados canónicos HubRise (developers/api/orders). `awaiting_shipment` está deprecado
-- pero se ADMITE para no romper si llega de histórico (nunca se ENVÍA; en UI = awaiting_collection).
-- NULL = venta sin pedido de plataforma (manual/POS).

ALTER TABLE public.sale
  ADD COLUMN IF NOT EXISTS order_status text;

ALTER TABLE public.sale
  DROP CONSTRAINT IF EXISTS sale_order_status_check;

ALTER TABLE public.sale
  ADD CONSTRAINT sale_order_status_check CHECK (
    order_status IS NULL OR order_status IN (
      'new','received','accepted','in_preparation','awaiting_collection',
      'awaiting_shipment','in_delivery','completed','rejected','cancelled','delivery_failed'
    )
  );

-- Siembra desde raw_tab.status para los pedidos HubRise ya existentes.
-- raw_tab es TEXT → solo casteamos si parece JSON, y solo aplicamos valores conocidos
-- (evita violar el CHECK con un estado inesperado).
UPDATE public.sale s
SET order_status = (s.raw_tab::jsonb ->> 'status')
WHERE s.source = 'hubrise'
  AND s.order_status IS NULL
  AND s.raw_tab IS NOT NULL
  AND left(btrim(s.raw_tab), 1) = '{'
  AND (s.raw_tab::jsonb ->> 'status') IN (
    'new','received','accepted','in_preparation','awaiting_collection',
    'awaiting_shipment','in_delivery','completed','rejected','cancelled','delivery_failed'
  );
