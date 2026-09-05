-- 20260819T1230_espejo_catalogo_nombre_y_destinos.sql
-- Aplicada el 27/08/2026 (escrita el 19/08, quedo pendiente).
-- external_catalog_product.external_channel guardaba UN canal por catalogo, "el
-- primero que Last mencione", pero en Last un catalogo se asigna a VARIOS
-- destinos a la vez. El rotulo bailaba entre sincronizaciones sin que nadie
-- tocara nada. Dos columnas ADITIVAS: nada se borra, nada se renombra.
-- Tiene que correr ANTES de desplegar last-catalog-sync; al reves, cada upsert
-- falla entero y el cron de las 12:00 UTC se cae.

alter table public.external_catalog_product
  add column if not exists catalog_name      text,
  add column if not exists external_channels text[];

comment on column public.external_catalog_product.catalog_name is
  'Nombre del catalogo en Last (p.ej. "SMASH BROTHERS BURGER 20"). Lo escribe lastapp-sync-catalog.';

comment on column public.external_catalog_product.external_channels is
  'TODOS los destinos del catalogo, ordenados (local, delivery, glovo, uber...). '
  'external_channel es solo el primero, y se conserva por compatibilidad.';

create index if not exists ix_ecp_channels
  on public.external_catalog_product using gin (external_channels);