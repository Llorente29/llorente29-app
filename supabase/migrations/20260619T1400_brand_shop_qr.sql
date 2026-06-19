-- supabase/migrations/20260619T1400_brand_shop_qr.sql
-- ============================================================================
-- D2 · URL de tienda propia (Folvy Shop) + caption del QR, POR MARCA.
-- ============================================================================
-- El ticket de bolsa de impresión lleva un QR a la tienda propia para desviar
-- tráfico de Glovo/Uber al canal directo (sin comisión). La URL es atributo de
-- MARCA (cada marca tiene su escaparate), no de canal (sales_channel es por
-- cuenta y representa plataformas). El texto que acompaña al QR lo decide cada
-- cliente -> qr_caption configurable por marca.
--
-- Dos columnas nuevas en brand. Idempotente. Sin BEGIN/COMMIT (DDL en SQL Editor).
-- No hay backfill: nacen NULL; el QR solo se pinta si shop_url tiene valor.
-- ============================================================================

alter table public.brand
  add column if not exists shop_url   text,
  add column if not exists qr_caption text;

comment on column public.brand.shop_url is
  'URL de la tienda propia (Folvy Shop) de esta marca. La consume el QR del ticket de bolsa. NULL = sin tienda, no se pinta QR.';
comment on column public.brand.qr_caption is
  'Texto libre que acompaña al QR en el ticket (configurable por el cliente). Si NULL, se usa un texto por defecto.';
