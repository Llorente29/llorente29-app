-- 20260602T0100_sale_service_type.sql
-- Economía de Plataformas (EP1): captura del tipo de reparto por venta.
-- Aplicada: 2026-06-02 en Supabase (proyecto xzmpnchlguibclvxyynt) vía SQL Editor.
--
-- Origen del dato: Last.app envía `pickupType` en el payload `tab:closed`
--   ('delivery' = reparto de plataforma, 'ownDelivery' = reparto propio).
--   El webhook lo mapea a service_type. Mismo CHECK que brand_channel_rate.
--   Nullable: las ventas históricas (export, sin pickupType) quedan en null.
--
-- NOTA: registro del esquema YA APLICADO. NO re-ejecutar (la columna ya existe).

BEGIN;

ALTER TABLE public.sale
  ADD COLUMN service_type text
    CHECK (service_type IS NULL OR service_type IN ('platform_delivery','own_delivery','pickup'));

COMMIT;
