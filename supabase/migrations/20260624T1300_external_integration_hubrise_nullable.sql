-- 20260624T1300_external_integration_hubrise_nullable.sql
-- ============================================================================
-- Las columnas external_org_id y token_secret_name eran NOT NULL pensadas para
-- Last. HubRise identifica la conexión por external_location_id + connection_name
-- (texto) y guarda el token en access_token, así que esas dos no aplican.
-- Se hacen nullable; un CHECK garantiza la integridad por fuente.
-- Aplicada: 2026-06-24
-- ============================================================================
alter table public.external_integration alter column external_org_id    drop not null;
alter table public.external_integration alter column token_secret_name  drop not null;

-- Integridad por fuente: lastapp necesita org+secret; hubrise necesita token+catalog+location en BBDD.
alter table public.external_integration drop constraint if exists external_integration_source_shape_chk;
alter table public.external_integration add constraint external_integration_source_shape_chk check (
  (source = 'lastapp' and external_org_id is not null and token_secret_name is not null)
  or
  (source = 'hubrise' and access_token is not null and external_catalog_id is not null and external_location_id is not null)
  or
  (source not in ('lastapp','hubrise'))
);
