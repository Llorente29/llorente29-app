-- ============================================================================
-- ESPEJO DE CATALOGOS DE LAST · nombre del catalogo y TODOS sus destinos
-- ============================================================================
-- POR QUE (19/08/2026, encontrado probando la escritura de precio en Last):
--
-- external_catalog_product.external_channel guarda UN canal por catalogo, y lo
-- elige "el primero que Last mencione". Pero en Last un mismo catalogo se
-- asigna a VARIOS destinos a la vez: el panel de Alcala muestra
-- "SMASH BROTHERS BURGER -> A domicilio, Glovo, Para llevar, Local".
-- Resultado: la columna no dice "este catalogo es de Glovo", dice "el primer
-- destino que salio". Se comprobo en vivo que el rotulo BAILA entre
-- sincronizaciones sin que nadie toque nada (094ea1ca paso de 'default' a
-- 'shop' en diez minutos), y que aparecen canales inexistentes ('deliveroo' en
-- un local que no tiene integracion de Deliveroo).
--
-- Consecuencia practica: no se puede saber que catalogo corresponde a que
-- plataforma, que es exactamente lo que hace falta para poner precio por canal.
--
-- QUE HACE ESTO: dos columnas ADITIVAS. Nada se borra, nada se renombra.
--   · catalog_name       -> el nombre del catalogo en Last ("SMASH BROTHERS
--                           BURGER 20"), que hoy no se guardaba en ningun sitio.
--   · external_channels  -> TODOS los destinos del catalogo, ordenados.
--
-- ✅ APLICADA el 27/08/2026 (escrita el 19/08). Y `last-catalog-sync` v11
-- desplegada justo despues, en el orden obligado: migracion -> verificacion
-- estructural -> deploy.
--
-- (Historico) NO APLICADA TODAVIA. El codigo que escribe estas columnas ya esta escrito,
-- en `last-catalog-sync` (collectBrandChannelByCatalog acumula todos los
-- destinos en vez de quedarse con el primero, y resolveLocationCatalogs guarda
-- el nombre del catalogo). Ese despliegue ESPERA A ESTA MIGRACION.
--
-- `last-catalog-sync` es la que corre el cron horario (0 12-23 * * *) y la que
-- mantiene el espejo. Se recupero al repo el 19/08 (antes estaba desplegada sin
-- codigo en ningun sitio). La vieja, `lastapp-sync-catalog`, quedo retirada el
-- mismo dia: responde 410 y dice cual usar.
--
-- Ejecutar esta migracion ANTES de desplegar el codigo que escribe las columnas;
-- al reves, cada upsert falla entero y el cron de las 12:00 UTC se cae.
--
-- external_channel SE QUEDA COMO ESTA (primer destino) por compatibilidad: lo
-- lee availabilityService.ts para contar canales distintos. A partir de ahora
-- sera el primero POR ORDEN ALFABETICO en vez de "el que llegara antes", asi
-- que deja de bailar entre sincronizaciones.
--
-- Las columnas quedan NULAS hasta que corra lastapp-sync-catalog. No rompe
-- ninguna lectura existente: nadie las consulta todavia.
-- ============================================================================

begin;

alter table public.external_catalog_product
  add column if not exists catalog_name      text,
  add column if not exists external_channels text[];

comment on column public.external_catalog_product.catalog_name is
  'Nombre del catalogo en Last (p.ej. "SMASH BROTHERS BURGER 20"). Lo escribe lastapp-sync-catalog.';

comment on column public.external_catalog_product.external_channels is
  'TODOS los destinos del catalogo, ordenados (local, delivery, glovo, uber...). '
  'external_channel es solo el primero, y se conserva por compatibilidad.';

-- Indice para la pregunta que motiva todo esto: "damelos catalogos de tal canal".
create index if not exists ix_ecp_channels
  on public.external_catalog_product using gin (external_channels);

commit;

-- ── VERIFICACION (ejecutar aparte, despues) ─────────────────────────────────
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='external_catalog_product'
--    and column_name in ('catalog_name','external_channels');
