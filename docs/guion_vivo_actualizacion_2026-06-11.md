# Actualización para folvy_guion_vivo.md — cierre 11/06

## Cambiar la cabecera "Última actualización" por:

> **Última actualización**: 11 jun 2026 (CIERRE — CASADO DE VENTAS a 98,6% en Folvy Interno con MARCA ESTABLE POR UUID (no deducida de productos): catálogo de cedidas Cloudtown descargado (686 prod), índice `uq_menu_item_external` con `brand_id` (matrícula por marca), `seed_catalog_from_lastapp` + `adapt_lastapp_order` v3 (combos por marca deducida de hijos). PRINCIPIO NUEVO: guardar el 100% del ticket (`sale.raw_tab`); el webhook ya no descarta la cabecera. `external_brand_map` poblado y VALIDADO por Julio (42 UUID→16 marcas→3 locales físicos; 2 cuentas Last por local: propia+CTB cedidas). Marca histórica recuperada del log al 100%. Selector de local DESBLOQUEADO (era texto muerto en ShellTopBar). Pantalla por marca×local DISEÑADA (maquetas validadas), encargada a Code junto con el scope de local en toda la app.)

## En AHORA — añadir al principio (nuevo frente 0):

### 0. ⏳ CHECKPOINT (11/06): que Code ejecute el ENCARGO (scope local + pantalla marca×local) y validarlo
Encargo en `docs/ENCARGO_CLAUDE_CODE_local_y_pantalla_marca.md`. DOS trabajos:
- **TRABAJO A — scope de local en toda la app**: el selector global de local YA funciona (arreglado hoy: `ShellTopBar` montaba texto muerto, ahora monta `<LocationSelector/>`), pero NINGUNA página lo escucha. Conectar cada página de lista/dashboard a `useLocationScope().resolvedLocationId`. CRÍTICO: Kitchen/escandallos NO se filtra por local (es de marca); Supply/Team/APPCC SÍ. Code deja dudas anotadas para Julio.
- **TRABAJO B — pantalla casado por marca×local**: local del selector global, marca con selector propio, historia completa por marca (pendiente/casado/ignorado agrupado por producto), casado acotado a la marca, "ignorar" con motivo visible. Golea a tspoon. `salesReliabilityService` no filtra por marca/local → Code añade funciones.
Validar cuando Code entregue: build verde, semántica correcta por página, pantalla por marca funcionando.

### Mover el antiguo frente 0 (checkpoint recepción) y 0.bis (delivery/ingesta) un puesto abajo. El frente 1 (cobertura de escandallos) sigue tras los checkpoints.

## En HECHO — añadir:

- HECHO **CASADO DE VENTAS a 98,6% + MARCA ESTABLE POR UUID (11/06):** de ~77% a 98,6% en Folvy Interno. Catálogo cedidas Cloudtown descargado (686 prod, `lastapp-sync-catalog` redeployado). Índice `uq_menu_item_external` ahora incluye `brand_id` (matrícula única POR MARCA → desbloquea productos compartidos entre marcas). `seed_catalog_from_lastapp` (siembra cedidas sin escandallo, idempotente). `adapt_lastapp_order` v3: combos por marca DEDUCIDA de hijos casados (el combo no trae id propio). Residual 9 = `no_recipe` sin `organizationProductId` en origen (irrecuperable por matrícula, casable a mano por marca). **Implementa la INGESTA CANÓNICA diseñada el 10/06.**
- HECHO **RAW EVENT STORE — el ticket completo se guarda (11/06):** principio de Julio "guardar el 100% de lo que el TPV exporta, se use o no". `sale.raw_tab` + `lastapp-webhook` guarda el `tab` entero (antes solo `raw_products`, descartaba la cabecera con la marca). Arregla hoy (marca por ticket) y previene mañana (cualquier dato que se necesite ya está).
- HECHO **MAPA DE MARCAS ESTABLE `external_brand_map` (11/06, validado por Julio):** 42 UUID de Last (`locationBrandId`+`locationId`) → 16 brands de Folvy → 3 locales físicos. Marca recuperada de lo histórico al 100% desde `lastapp_webhook_log`. `sale.brand_id` y `adapt`/webhook ahora resuelven marca por el mapa estable, NO por productos (que cambian). Aprendizaje: cada local físico tiene 2 cuentas de Last (propia + CTB cedidas) → 6 UUID = 3 locales. Milanesa House=propia, Milanesa Haus=cedida (confirmado Julio).
- HECHO **SELECTOR DE LOCAL desbloqueado (11/06):** `ShellTopBar` montaba `{locationLabel}` (texto muerto), no el `LocationSelector` real (que existía y funcionaba). Arreglado. Pendiente: que las páginas lo escuchen (TRABAJO A de Code) y permisos por local (con accesos Llorente29).

## NOTA para el frente 1 (cobertura de escandallos)
Los 197+80 platos cedidos sembrados hoy entraron SIN escandallo (`needs_review`). Suben el nº de "casado pero sin coste". Pamela los completa. El "coste conocido" en Folvy Interno está ~48% por esto. No es un fallo: es el frente 1 (cobertura) que ahora tiene más superficie por las cedidas.
