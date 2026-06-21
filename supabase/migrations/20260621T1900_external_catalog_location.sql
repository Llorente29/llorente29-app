-- 20260621T1900_external_catalog_location.sql
-- Añade external_location_id a external_catalog_product: la location (Last) del
-- catálogo, que es el header `locationID` que exigen los endpoints de catálogo y
-- de pedidos de Last (verificado: GET /catalogs/{id} y PUT /orders/{tabId}/status
-- van con locationID). Necesario para el empuje del 86:
--   PUT /catalogs/{catalogId}/products/{productId}  { enable: false }
-- La rellena lastapp-sync-catalog (catalogLocation[catId]); un re-sync de ambas
-- orgs backfillea las filas existentes (Cloudtown) por el upsert idempotente.
-- Idempotente. Aplicada: 2026-06-21

alter table public.external_catalog_product
  add column if not exists external_location_id uuid;

comment on column public.external_catalog_product.external_location_id is
  'Location (Last) del catálogo; header locationID para los endpoints de catálogo/pedidos. La rellena lastapp-sync-catalog.';
