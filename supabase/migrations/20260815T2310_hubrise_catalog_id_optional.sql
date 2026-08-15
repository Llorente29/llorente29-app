-- 20260815T2310_hubrise_catalog_id_optional.sql
-- ENCARGO CODE — módulo de conexión HubRise, punto 1 de 2.1 (15/08/2026).
-- Aplicada por MCP (verificada: pg_get_constraintdef confirma el CHECK sin
-- external_catalog_id; la fila 'Folvy' de producción pasó de 'n/a' a NULL).
--
-- external_catalog_id deja de ser obligatorio para source='hubrise'. Pedir
-- scope de catálogo solo para rellenar una columna sería pedir permiso que
-- no necesitamos (contra la guía de HubRise) y ese catálogo por defecto de
-- la location no significa nada en nuestra arquitectura: los catálogos
-- reales están en brand_hubrise_catalog, por marca.
--
-- Inventario verificado antes de tocar (ningún lector asume NOT NULL):
--   - hubrise-catalog-publish/index.ts (ruta de fallback): `if (!integ.external_catalog_id) continue;`
--   - availability-dispatch/index.ts (dos rutas de fallback): mismo patrón `continue`
--   - brands_for_closure() (SQL): filtra con `ei.external_catalog_id is not null` en el WHERE
-- Los demás matches del grep son de otras tablas (brand_hubrise_catalog,
-- catalog_publish_target, catalog_image_map, external_catalog_product).
--
-- Dos partes en la misma migración: relajar el CHECK, y limpiar el dato
-- falso 'n/a' (texto literal, no NULL) de la fila Folvy de producción.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'external_integration_source_shape_chk'
  ) then
    alter table public.external_integration
      drop constraint external_integration_source_shape_chk;
  end if;

  alter table public.external_integration
    add constraint external_integration_source_shape_chk
    check (
      (source = 'lastapp' and external_org_id is not null and token_secret_name is not null)
      or (source = 'hubrise' and access_token is not null and external_location_id is not null)
      or (source not in ('lastapp', 'hubrise'))
    );

  update public.external_integration
    set external_catalog_id = null
    where source = 'hubrise' and external_catalog_id = 'n/a';
end $$;
