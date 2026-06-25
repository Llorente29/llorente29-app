-- Ticket pro · descuento por línea CANÓNICO (multi-TPV: Last + HubRise).
-- original_unit_price = precio sin descuento (para tachar). NULL = sin descuento.
-- discount_label = texto listo para imprimir ("Descuento 8,95 €"). NULL = sin descuento.
-- El ticket lee SOLO estas columnas; no sabe del formato de cada TPV.

ALTER TABLE sale_line
  ADD COLUMN IF NOT EXISTS original_unit_price numeric,
  ADD COLUMN IF NOT EXISTS discount_label text;
