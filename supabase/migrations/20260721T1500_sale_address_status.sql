-- 20260721T1500_sale_address_status.sql
-- Frente Fiabilidad de dirección (F1). Marca interna de discrepancia entre lo que
-- escribió el cliente (address) y el geocoder de la plataforma (geocodedAddress).
--   'ok'           -> coinciden (o no hay con qué comparar)
--   'needs_review' -> la calle del cliente no aparece en el geocoded (~6% de own_delivery)
-- Aditiva, con default 'ok': no rompe la ingesta actual ni las filas existentes.

ALTER TABLE public.sale
  ADD COLUMN IF NOT EXISTS address_status text NOT NULL DEFAULT 'ok';

COMMENT ON COLUMN public.sale.address_status IS
  'Fiabilidad de la direccion: ok | needs_review (address del cliente vs geocodedAddress de la plataforma). Badge interno, sin bloqueo.';
