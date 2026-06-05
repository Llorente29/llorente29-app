-- Aplicada: 2026-06-06 en SQL Editor
-- IVA del envío al cliente configurable (10% accesorio a comida por defecto,
-- 21% si la gestoría lo trata como transporte independiente).
ALTER TABLE channel_rate
  ADD COLUMN IF NOT EXISTS own_customer_fee_vat_pct numeric NOT NULL DEFAULT 10;

ALTER TABLE brand_channel_rate
  ADD COLUMN IF NOT EXISTS own_customer_fee_vat_pct numeric NOT NULL DEFAULT 10;
