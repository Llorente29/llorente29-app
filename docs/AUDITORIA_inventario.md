# AUDITORÍA — Inventario del repositorio Folvy

> Informe de **hechos** (no opiniones) generado recorriendo el código real.
> Citas con `ruta:línea` cuando aplica. Donde no se puede determinar algo desde
> el código se escribe **no determinado**.
> Alcance: rama `main`, 476 ficheros versionados. Nada de la app fue modificado;
> el único fichero creado es este.

---

## 0. Arquitectura en una frase (para leer el resto)

App React + TypeScript + Vite + Supabase. El render autenticado por defecto es un
**Shell modular** (`src/shell/Shell.tsx`) que navega por **rutas** y monta
"módulos enchufables" declarados como `ModuleDefinition` (`src/shell/types.ts:55`).
Los módulos se registran en un único array (`src/shell/moduleRegistry.ts:24`).
La lógica de coste/stock es mayoritariamente **server-side** (RPCs de Postgres y
triggers); los servicios del cliente orquestan y leen.

Ramas de render de primer nivel en `src/App.tsx`:
- Rutas públicas de auth → `AuthRouter` (`src/App.tsx:82`).
- `/_admin/*` con claim platform-admin → `AdminShell` (`src/App.tsx:124-141`).
- `role==='worker'` con `employeeId` → `TrabajadorApp` (`src/App.tsx:150-157`).
- Resto → `AccountStatusGate > Shell` (`src/App.tsx:162-166`).

---

## 1. MAPA DE MÓDULOS

Módulos registrados en el TopBar (`src/shell/moduleRegistry.ts:24-31`), por `topBarOrder`:

| order | id | nombre comercial | basePath | fichero módulo |
|---|---|---|---|---|
| 1 | personal | Folvy Team | `personal` | `src/modules/personal/module.tsx` |
| 2 | appcc | Folvy Safety | `appcc` | `src/modules/appcc/module.tsx` |
| 3 | ventas | Folvy Sales | `ventas` | `src/modules/ventas/module.tsx` |
| 4 | kitchen | Folvy Kitchen | `kitchen` | `src/modules/kitchen/module.tsx` |
| 5 | integrations | Folvy Connect | `integraciones` | `src/modules/integrations/module.tsx` |
| 6 | supply | Folvy Supply | `supply` | `src/modules/supply/module.tsx` |

Módulo **no** en el registry (se accede por el engranaje, no es pestaña):
- configuracion — `Configuración` — basePath `configuracion` — `src/modules/configuracion/module.tsx` (ver `Shell.tsx:25,66-70`).

Módulos sin `module.tsx` (servicios/tipos sueltos, no enchufables al Shell):
- `src/modules/multitenancy/` — pages/components/services de cuentas, marcas, permisos (consumidos por otros módulos y por el Shell).
- `src/modules/folvy-ai/` — burbuja de IA (montada en `Shell.tsx:177`, no es pestaña).
- `src/modules/mapping/` — solo `services/mappingService.ts` + `types/mapping.ts`.

### 1.1 Desglose por módulo (pages / components / services)

**personal** (`src/modules/personal/`) — solo `module.tsx`. Sus **pages viven en `src/pages/`** (ver §2.1). Servicios en `src/services/` (ver §3).

**appcc** (`src/modules/appcc/`)
- pages: `AppccDashboardPage`, `TodayPage`, `ExecutionPage`, `IncidentsPage`, `OnboardingPage`, `ReportsPage`, `TemplateEditorPage` (`pages/*.tsx`).
- audits: `AuditsPage`, `AuditExecutionPage`, `AuditTemplateEditorPage` + `auditsService.ts`, `auditPdfExportService.ts`, `types.ts` (`audits/*`).
- components: `FieldRenderer`, `IncidentDetailModal`, `IncidentTimeline`, `PhotoUploader` (`components/*.tsx`).
- services: `analyticsService`, `assignmentService`, `executionsService`, `incidentsService`, `pdfExportService`, `photosService`, `schedulesService`, `templatesService` (`services/*.ts`).

**ventas** (`src/modules/ventas/`) — solo `module.tsx`. Pages en `src/pages/` (`VentasAnalisisPage`, `PrediccionPersonalPage`, `ZonasPedidoPage`). Servicios `src/services/salesAnalysis.ts`, `enrichment.ts`, `deliveryZones.ts`, `scheduler.ts`.

**kitchen** (`src/modules/kitchen/`)
- pages (12): `KitchenItemsPage`, `KitchenItemDetailPage`, `KitchenRecipesPage`, `RecipeEditorPage`, `KitchenMenuPage`, `CatalogProductDetailPage`, `SuppliersPage`, `KitchenDashboardPage`, `KitchenProfitabilityPage`, `KitchenMenuEngineeringPage`, `KitchenSettingsPage`, `KitchenRecipePage` *(muerto, ver §4)*.
- components (8): `PurchaseSourcesSection`, `SupplierItemsSection`, `ItemVatSelector`, `IngredientAiAssistButton`, `RecipeStepsTab`, `FamilyReviewPanel`, `FamilyManagerPanel`, `ReviewBanner` *(huérfano efectivo, ver §4)*.
- lib: `allergens.ts`, `unitConversion.ts`.
- services (22): `recipeItemService`, `recipeLineService`, `recipeStepService`, `recipeItemAllergenService`, `costCascadeService`, `purchaseFormatService`, `menuItemService`, `menuEngineeringService`, `kitchenDashboardService`, `kitchenUnitService`, `recipeAiService`, `ingredientTemplateService`, `ingredientAdoptionService`, `ingredientFamilyService`, `vatService`, `channelRateService`, `brandChannelRateService`, `brandLicensingAgreementService`, `brandCatalogService`, `recipePhotoService`, `menuPhotoService`, `recipeLineService`.

**integrations** (`src/modules/integrations/`)
- pages: `IntegrationsPage`, `IntegrationsMarketplacePage`, `ConnectorDetailPage`.
- components: `ConnectorAvatar`.
- services: `connectorService`, `connectorCredentialsService`.

**supply** (`src/modules/supply/`)
- pages (11): `SupplyOrdersPage`, `SupplyOrderBuilder`, `SupplyOrderDetailPage`, `GoodsReceiptsPage`, `GoodsReceiptForm`, `ReceiptScanPanel`, `LineMatchPicker`, `SupplierInvoicesPage`, `InvoiceScanPanel`, `InventoryPage`. (`SupplyOrderBuilder`/`SupplyOrderDetailPage`/`GoodsReceiptForm`/`ReceiptScanPanel`/`LineMatchPicker`/`InvoiceScanPanel` no son rutas: son sub-vistas por `view` de estado.)
- components: `OperativeLocationBanner`, `InventoryCountSheet`.
- hooks: `useOperativeLocation`.
- services (8): `purchaseOrderService`, `supplierCatalogService`, `goodsReceiptService`, `supplierInvoiceService`, `storageAreaService`, `inventoryCountService`, `operativeLocationService`, `purchaseOrderPdf`.

**multitenancy** (`src/modules/multitenancy/`)
- pages: `BrandsPage`.
- components: `AccountSelector`, `BrandFilterSelector`, `LocationSelector` + `brands/` (`BrandsListView`, `BrandDetailView`, `BrandCreateModal`, `BrandDataTab`, `BrandLocationsTab`).
- hooks: `useActiveAccount`, `useAuth`, `useLocationScope`, `usePermissions`.
- services (8): `accountsService`, `userProfilesService`, `brandsService`, `brandLocationService`, `managerPermissionsService`, `salesChannelsService`, `costCentersService`, `analysisAccountsService`. utils: `slug.ts`.

**folvy-ai** (`src/modules/folvy-ai/`)
- components: `FolvyAIBubble`, `FolvyAIComposer`, `FolvyAIMessage`, `FolvyAIIsotype`.
- hooks: `useFolvyAI`. services: `folvyAIService`. types: `folvyAI`.

**mapping** (`src/modules/mapping/`) — `services/mappingService.ts`, `types/mapping.ts`. Sin pages ni components.

**configuracion** (`src/modules/configuracion/`) — solo `module.tsx`; reusa pages de `src/pages/` y de multitenancy.

**Plataforma / admin (fuera de módulos)**: `src/admin/` (AdminShell + 4 pages), `src/platform/` (feature-gate, accountModulesService, usePlatformAdmin), `src/auth/AuthRouter.tsx`, `src/pages/trabajador/*` (app del trabajador).

---

## 2. NAVEGACIÓN

### 2.0 Mecánica del Shell
- El TopBar (`src/shell/ShellTopBar.tsx`) pinta **Inicio** + una pestaña por módulo visible (`getOrderedModules()`, filtrado por `isModuleVisible` rol+permiso, `ShellTopBar.tsx:91-99`). El engranaje abre `configuracion` (`ShellTopBar.tsx:182-192`). Campana de notificaciones si hay `employeeId`. Avatar con menú (Administración / Ver como trabajador / Cerrar sesión).
- Al elegir pestaña, `goToKey` navega a `/${basePath}` (`Shell.tsx:84-91`). El módulo activo se deriva del `pathname` (`Shell.tsx:59-71`).
- Dentro de un módulo, el **2º nivel** es el `ModuleSidebar` (escritorio) o `MobileModuleTabs` (móvil < 768px), construido desde `module.sidebar.items` (`Shell.tsx:143-167`). En móvil hay además `ShellBottomNav` con Folvy AI como héroe central (`Shell.tsx:180-187`).
- Las rutas internas se montan con un `<Routes>` anidado a partir de `module.routes` (`Shell.tsx:122-129`).
- **Inicio** (sin módulo) renderiza `HomeGeneral` (`Shell.tsx:170`), una rejilla de `ModuleSummaryCard` que sólo cablea `onOpenModule` para personal/appcc/ventas (`src/shell/home/HomeGeneral.tsx:95-118`).

### 2.1 Por pestaña: componente raíz + sub-navegación

**Inicio** → `HomeGeneral` (`src/shell/home/HomeGeneral.tsx`). Sin sub-pestañas; tarjetas resumen que saltan a módulos.

**Folvy Team (personal)** — sidebar 11 items (`personal/module.tsx:58-72`). Cada item gated por `requiredPermission`:
| item | path | page (en `src/pages/`) |
|---|---|---|
| Empleados | `` | `StaffPage` (embebe `InsightsPage`, tabs Documentos/Vacaciones/Formaciones, panel `AccesoTrabajadorPanel`) |
| Ahora mismo | `ahora-mismo` | `AhoraMismoPage` |
| Control horario | `control-horario` | `FichajesGlobalPage` |
| Kiosko fichaje | `kiosko` | `KioskoFichajePage` |
| Solicitudes | `solicitudes` | `SolicitudesPendientesPage` |
| Turnos abiertos | `turnos-abiertos` | `TurnosAbiertosPage` |
| Cambios de turno | `cambios` | `CambiosPendientesPage` |
| Calendario | `calendario` | `CalendarioPage` |
| Plantilla turnos | `plantilla-turnos` | `PlantillaTurnosPage` |
| Informes Gestoría | `informes` | `InformesPage` |
| Bolsa de horas | `bolsa-horas` | `BolsaHorasPage` |

**Folvy Safety (appcc)** — sidebar 8 items (`appcc/module.tsx:63-74`); 5 gated `requiredRole:'admin'`. Rutas adicionales con parámetro que NO están en sidebar (se abren por navegación): `hoy/exec/:executionId` → `ExecutionPage`, `auditorias/exec/:auditId` → `AuditExecutionPage` (`appcc/module.tsx:50,54`). Sub-navegación interna de páginas: `IncidentsPage` abre drawer/modal `IncidentDetailModal` (workflow CAPA por estados); `TodayPage`→`ExecutionPage` ítem a ítem; `AuditExecutionPage` scoring en vivo.

**Folvy Sales (ventas)** — sidebar **2 items** (`ventas/module.tsx:35-40`): Análisis de ventas (``) y Zonas de pedido (`zonas`). **Nota**: hay una 3ª ruta `prediccion`→`PrediccionPersonalPage` (`ventas/module.tsx:31`) que **NO tiene item en el sidebar** → pantalla alcanzable sólo por URL directa (cabo suelto, §4).

**Folvy Kitchen (kitchen)** — sidebar 8 items (`kitchen/module.tsx:43-53`):
| item | path | page raíz | sub-navegación interna |
|---|---|---|---|
| Resumen | `resumen` | `KitchenDashboardPage` | tarjetas clicables (agregador) |
| Menú | `menu` | `KitchenMenuPage` | abre `CatalogProductDetailPage` por estado |
| Ingredientes | `` (default) | `KitchenItemsPage` | modal de alta + abre `KitchenItemDetailPage` por estado; `FamilyReviewPanel`/`FamilyManagerPanel` |
| Proveedores | `proveedores` | `SuppliersPage` | detalle por estado + `SupplierItemsSection` |
| Recetas | `recetas` | `KitchenRecipesPage` | abre `RecipeEditorPage` por estado (tabs Escandallo/Receta/Etiquetado/Histórico/Más) |
| Rentabilidad | `rentabilidad` | `KitchenProfitabilityPage` | — |
| Ingeniería de menús | `ingenieria-menus` | `KitchenMenuEngineeringPage` | modos clear/matrix |
| Ajustes | `ajustes` | `KitchenSettingsPage` | — |

> Patrón Kitchen: la navegación list↔detail NO usa rutas de React Router; es **estado de componente** (`selectedItemId`, `selectedRecipeId`, `view`). El sidebar sólo cambia entre las 8 rutas de primer nivel.

**Folvy Connect (integrations)** — sidebar 2 items (`integrations/module.tsx:33-38`): Tus integraciones (``) → `IntegrationsPage`; Marketplace (`marketplace`) → `IntegrationsMarketplacePage`. `IntegrationsMarketplacePage` abre `ConnectorDetailPage` por estado (NO hay ruta `ConnectorDetailPage`).

**Folvy Supply (supply)** — sidebar 4 items (`supply/module.tsx:44-51`):
| item | path | page raíz | sub-vistas (por `view` de estado) |
|---|---|---|---|
| Pedidos | `` | `SupplyOrdersPage` | `SupplyOrderBuilder`, `SupplyOrderDetailPage` |
| Recepciones | `recepciones` | `GoodsReceiptsPage` | `ReceiptScanPanel`, `GoodsReceiptForm` (+ `LineMatchPicker` modal) |
| Facturas | `facturas` | `SupplierInvoicesPage` | `InvoiceScanPanel`, `InvoiceDetail` (inline) |
| Inventario | `inventario` | `InventoryPage` | tabs Áreas / Conteos → `InventoryCountSheet` |

**Configuración (engranaje)** — sidebar 4 items (`configuracion/module.tsx:43-50`): Locales (`locales`→`LocationsPage` de `OtherPages`), Marcas (`marcas`→`BrandsPage`, gated admin), Avisos (`avisos`→`AvisosSettingsPage`), Usuarios y accesos (`usuarios`→`UsuariosAccesosPage`, gated admin).

### 2.2 Navegación del Trabajador (rama aparte)
`TrabajadorApp` (`src/pages/trabajador/TrabajadorApp.tsx`) NO usa el Shell: navega por `subPage` de estado y un `BottomTabBar` (inicio / fichar / tareas / más). Destinos: `HomeEmpleado`, `PortalEmpleado` (→ horario, fichajes, documentos, vacaciones, turnos, cambios, bolsa), `MisChecklistsPage`→`ExecutionPage` (reusa la page APPCC). Entrada: worker puro vía `App.tsx:150` o encargado dual vía "Ver como trabajador" (`Shell.tsx:111-119`).

### 2.3 Panel Admin (rama aparte)
`AdminShell` (`src/admin/AdminShell.tsx:84-93`): rutas `/_admin/inicio`, `/_admin/cuentas`, `/_admin/cuentas/nueva`, `/_admin/cuentas/:accountId`.

---

## 3. INVENTARIO DE PANTALLAS

> Leyenda: "RPC" = función Postgres vía `.rpc()`; "EF" = Edge Function (`supabase.functions`). Tablas detectadas en los `.from('...')` de los servicios listados o del propio componente.

### 3.1 Kitchen
| Pantalla | ruta fichero | qué hace | servicios/RPC | tablas |
|---|---|---|---|---|
| KitchenItemsPage | `src/modules/kitchen/pages/KitchenItemsPage.tsx` | Catálogo de ingredientes (`recipe_item type=raw`) con alta + adopción del master + filtro familia | recipeItemService, ingredientTemplateService, ingredientAdoptionService, kitchenUnitService, ingredientFamilyService; RPC `kitchen_recompute_item` | recipe_item, kitchen_unit, ingredient_template, recipe_family, mapping_proposal, recipe_item_allergen |
| KitchenItemDetailPage | `.../KitchenItemDetailPage.tsx` | Ficha completa de ingrediente (coste, alérgenos, nutrición, conservación) + compra + IVA | recipeItemService, kitchenUnitService, purchaseFormatService, ingredientFamilyService, recipePhotoService, recipeAiService, recipeItemAllergenService; RPC `kitchen_raw_usage_counts`, `kitchen_recompute_item`; **update directo** `recipe_item` (l.~432) | recipe_item, kitchen_unit, supplier, article_supplier, recipe_family, recipe_item_allergen; bucket `recipe-uploads` |
| KitchenRecipesPage | `.../KitchenRecipesPage.tsx` | Lista de platos (`type=dish`) con badge de estado de escandallo; abre editor | recipeItemService, recipePhotoService; RPC `kitchen_dishes_incomplete` | recipe_item; bucket `recipe-uploads` |
| RecipeEditorPage | `.../RecipeEditorPage.tsx` (1933 ll.) | Editor de escandallo: líneas, merma con IA, foto, panel economics por marca×canal | recipeItemService, recipeLineService, kitchenUnitService, menuItemService, brandsService, folvyAIService, recipePhotoService; RPC `kitchen_recipe_breakdown`, `kitchen_recompute_item`, `menu_item_economics`; EF `folvy-ai` | recipe_item, recipe_line, kitchen_unit, menu_item, brand; bucket `recipe-uploads` |
| KitchenMenuPage | `.../KitchenMenuPage.tsx` | Carta de marca (read-only v1): cobertura de escandallo, categorías, combos | brandCatalogService, menuItemService; RPC `menu_item_economics` | brand, menu_item, menu_category, modifier_group_assignment, combo_slot, combo_slot_option |
| CatalogProductDetailPage | `.../CatalogProductDetailPage.tsx` | Detalle de producto de carta (`menu_item`) + economics por canal + modificadores | menuItemService, brandCatalogService, channelRateService, menuPhotoService | menu_item, modifier_group(_assignment/_option), channel_rate, sales_channel; bucket `menu-photos` |
| SuppliersPage | `.../SuppliersPage.tsx` | Lista/detalle de proveedores + artículos que les compras | purchaseFormatService | supplier, article_supplier |
| KitchenDashboardPage | `.../KitchenDashboardPage.tsx` | Resumen KPIs food-cost / menu-engineering (agregador) | kitchenDashboardService (agrega brands/recipeItem/menuItem/menuEngineering); RPC `menu_item_economics`, `menu_item_units_sold`, `kitchen_dishes_incomplete` | brand, recipe_item |
| KitchenProfitabilityPage | `.../KitchenProfitabilityPage.tsx` | Tabla de rentabilidad food-cost por marca×canal | brandsService, menuItemService; RPC `menu_item_economics` | brand, menu_item |
| KitchenMenuEngineeringPage | `.../KitchenMenuEngineeringPage.tsx` | Matriz ingeniería de menús (margen × ventas) | brandsService, menuEngineeringService, menuItemService; RPC `menu_item_economics`, `menu_item_units_sold` | brand |
| KitchenSettingsPage | `.../KitchenSettingsPage.tsx` | Comisiones por canal (`channel_rate`) con desglose IVA | channelRateService | sales_channel, channel_rate |
| KitchenRecipePage | `.../KitchenRecipePage.tsx` | **MUERTO** (import desactivado en module.tsx) | — | — |

Componentes Kitchen relevantes a datos: `PurchaseSourcesSection` (supplier/format/price → flip de estrategia + cascada; RPC `kitchen_ancestors_of`/`kitchen_recompute_item`), `SupplierItemsSection`, `ItemVatSelector` (RPC `vat_rate_for`), `IngredientAiAssistButton` (EF `enrich-ingredient`), `RecipeStepsTab` (`recipe_item_step`, `recipe_item_step_line`), `FamilyReviewPanel`/`FamilyManagerPanel` (`recipe_family`, `mapping_proposal`).

### 3.2 Supply
| Pantalla | ruta fichero | qué hace | servicios/RPC | tablas |
|---|---|---|---|---|
| SupplyOrdersPage | `src/modules/supply/pages/SupplyOrdersPage.tsx` | Lista de pedidos; conmuta builder/detalle | purchaseOrderService, purchaseFormatService | purchase_order, supplier |
| SupplyOrderBuilder | `.../SupplyOrderBuilder.tsx` | Construye pedido sobre catálogo del proveedor | purchaseOrderService, supplierCatalogService, useOperativeLocation | purchase_order, purchase_order_line, article_supplier, recipe_item, locations |
| SupplyOrderDetailPage | `.../SupplyOrderDetailPage.tsx` | Detalle pedido: líneas, estados, PDF, lanza recepción | purchaseOrderService, goodsReceiptService, purchaseOrderPdf; RPC `vat_rate_for` | purchase_order, purchase_order_line, goods_receipt, recipe_item, supplier, locations, accounts |
| GoodsReceiptsPage | `.../GoodsReceiptsPage.tsx` | Lista recepciones; confirmar/anular; abre scan/form | goodsReceiptService; RPC `confirm_goods_receipt`, `void_goods_receipt` | goods_receipt, goods_receipt_line, supply_settings, supplier, locations |
| ReceiptScanPanel | `.../ReceiptScanPanel.tsx` | OCR de albarán (subida+visión) → prefill | goodsReceiptService (scanReceipt, resolveReceiptHeader, findDuplicateReceipt); EF `ocr-albaran` | bucket `receipt-uploads`; supplier, supplier_alias, locations, goods_receipt |
| GoodsReceiptForm | `.../GoodsReceiptForm.tsx` (1233 ll.) | Form de recepción (contra-pedido/corrección/OCR/ciega); confirma → libro mayor de stock | goodsReceiptService (+ kitchen createPurchaseFormat); RPC `confirm_goods_receipt`, `void_goods_receipt`, `run_mapping`, `learn_from_receipt`, `learn_supplier_alias` | goods_receipt, goods_receipt_line, recipe_item, recipe_item_purchase_format, article_supplier, supply_settings, supplier, purchase_order_line |
| LineMatchPicker | `.../LineMatchPicker.tsx` | Casa línea OCR a `recipe_item`; alta con IA | goodsReceiptService (matchReceiptLine, quickCreateRawItem, suggestItemAttributes); RPC `run_mapping`; EF `suggest-item` | recipe_item, recipe_family |
| SupplierInvoicesPage | `.../SupplierInvoicesPage.tsx` | Facturas: alta manual, three-way match, aprobación, reglas | supplierInvoiceService; RPC `run_invoice_match`, `apply_invoice_costs`, `current_user_can_approve_invoice`, `invoice_required_role` | supplier_invoice(_line/_receipt), invoice_approval_rule, goods_receipt, supplier, locations |
| InvoiceScanPanel | `.../InvoiceScanPanel.tsx` | OCR de factura (reusa albarán) → prefill | goodsReceiptService.scanReceipt, supplierInvoiceService; EF `ocr-albaran` | bucket `receipt-uploads`; supplier, goods_receipt, supplier_invoice(_receipt) |
| InventoryPage | `.../InventoryPage.tsx` | Tabs Áreas (CRUD + asignar items) y Conteos (→ hoja de conteo) | storageAreaService, inventoryCountService, supplierCatalogService; RPC `build_inventory_count` | storage_area, recipe_item_storage_area, recipe_item, inventory_count, inventory_count_line, locations |
| InventoryCountSheet | `.../components/InventoryCountSheet.tsx` | Hoja de conteo (ciego/revisión); aprobar → ajustes al ledger | inventoryCountService; RPC `close_inventory_count`, `apply_inventory_count` | inventory_count, inventory_count_line, recipe_item, storage_area |

### 3.3 APPCC
| Pantalla | ruta fichero | qué hace | servicios | tablas |
|---|---|---|---|---|
| AppccDashboardPage | `src/modules/appcc/pages/AppccDashboardPage.tsx` | Analítica APPCC (KPIs, cumplimiento, severidad, heatmap) | analyticsService | appcc_executions, appcc_incidents |
| TodayPage | `.../TodayPage.tsx` | Checklists pendientes del día por local; genera ejecuciones | executionsService, schedulesService, templatesService, assignmentService | appcc_executions/_responses, appcc_signatures, appcc_schedules, appcc_plans, appcc_templates/_items/_item_options, appcc_schedule_responsibles, user_profiles, clock_entries, employees |
| ExecutionPage | `.../ExecutionPage.tsx` | Rellena ejecución ítem a ítem, autosave, firma, PDF | executionsService, templatesService, pdfExportService | appcc_executions/_responses, appcc_signatures; bucket `appcc-photos` |
| IncidentsPage | `.../IncidentsPage.tsx` | Incidencias por local; abre modal CAPA; PDF | incidentsService, pdfExportService | appcc_incidents/_events/_actions/_photos, user_profiles; bucket `appcc-photos` |
| OnboardingPage | `.../OnboardingPage.tsx` | Asistente 3 pasos config APPCC del local | schedulesService, templatesService | appcc_schedules, appcc_templates, appcc_plans |
| ReportsPage | `.../ReportsPage.tsx` | Genera/previsualiza PDFs (inspector/controles/incidencias/diario) | pdfExportService | appcc_executions/_incidents/_signatures; bucket `appcc-photos` |
| TemplateEditorPage | `.../TemplateEditorPage.tsx` | CRUD de plantillas/ítems/opciones | templatesService | appcc_templates/_items/_item_options, appcc_plans |
| AuditsPage | `.../audits/AuditsPage.tsx` | Lista auditorías + nueva | auditsService | appcc_audits, appcc_audit_templates |
| AuditExecutionPage | `.../audits/AuditExecutionPage.tsx` | Ejecuta auditoría con scoring; cierra con firma; PDF | auditsService, auditPdfExportService | appcc_audits/_responses/_response_photos/_sections/_items |
| AuditTemplateEditorPage | `.../audits/AuditTemplateEditorPage.tsx` | Editor maestro-detalle de plantillas de auditoría | auditsService | appcc_audit_templates/_sections/_items |

### 3.4 Integraciones
| Pantalla | ruta fichero | qué hace | servicios | tablas |
|---|---|---|---|---|
| IntegrationsPage | `src/modules/integrations/pages/IntegrationsPage.tsx` | Índice de conexiones de la cuenta | connectorService | connector, account_connector |
| IntegrationsMarketplacePage | `.../IntegrationsMarketplacePage.tsx` | Catálogo de conectores; solicita o abre detalle | connectorService | connector, account_connector |
| ConnectorDetailPage | `.../ConnectorDetailPage.tsx` | Form dinámico de credenciales (Vault vía EF) | connectorCredentialsService; EF `connector-credentials` | — (sin tabla directa) |

### 3.5 Multitenancy / Configuración
| Pantalla | ruta fichero | qué hace | servicios | tablas |
|---|---|---|---|---|
| BrandsPage | `src/modules/multitenancy/pages/BrandsPage.tsx` | Router interno lista↔detalle de marcas | brandsService | brand, brand_location_availability |
| LocationsPage | `src/pages/OtherPages.tsx:35` | CRUD de locales | (vía AppContext / supabaseSync) | locations |
| AvisosSettingsPage | `src/pages/AvisosSettingsPage.tsx` | Ajustes de avisos / Tspoon | appSettingsService | app_settings (no determinado el detalle exacto sin abrir la page) |
| UsuariosAccesosPage | `src/pages/UsuariosAccesosPage.tsx` | Usuarios y accesos (admin) | userManagementService / managerPermissionsService (no determinado sin abrir) | user_profiles, manager_permissions (probable) |

### 3.6 Personal (pages en `src/pages/`)
| Pantalla | ruta fichero | qué hace | servicios | tablas |
|---|---|---|---|---|
| StaffPage | `src/pages/StaffPage.tsx` | Gestión de empleados + cuentas de acceso + tabs | userManagementService, tabs (documents/vacations/formations), AccesoTrabajadorPanel | user_profiles, employees, manager_locations |
| InsightsPage | `src/pages/InsightsPage.tsx` | Dashboard de plantilla (cumpleaños, distribuciones, KPIs) | (contexto) | — |
| AhoraMismoPage | `src/pages/AhoraMismoPage.tsx` | Quién trabaja ahora (turno publicado) | schedulerService | schedules, shift_templates, employee_availability |
| FichajesGlobalPage | `src/pages/FichajesGlobalPage.tsx` | Log global de fichajes filtrable | (contexto/supabaseSync) | clock_entries |
| KioskoFichajePage | `src/pages/KioskoFichajePage.tsx` | Kiosko de fichaje por local | fichajeKiosko / supabaseSync | clock_entries |
| SolicitudesPendientesPage | `src/pages/SolicitudesPendientesPage.tsx` | Aprobación de vacaciones pendientes | vacationsService | vacations, vacation_settings |
| TurnosAbiertosPage | `src/pages/TurnosAbiertosPage.tsx` | Turnos abiertos: crear/listar/candidatos | openShiftsService | open_shifts, open_shift_requests |
| CambiosPendientesPage | `src/pages/CambiosPendientesPage.tsx` | Cambios de turno: aprobar/rechazar | shiftSwapService | shift_swap_requests, schedules |
| CalendarioPage | `src/pages/CalendarioPage.tsx` | Cuadrante semanal editable, auto-generar | schedulerService, calendarService, scheduler | schedules, shift_templates, employee_availability, shift_assignments, weekly_plans, shift_types, shift_minimums, location_planning, vacations |
| PlantillaTurnosPage | `src/pages/PlantillaTurnosPage.tsx` | Catálogo de turnos + necesidades por día | schedulerService | shift_templates, employee_availability, schedules |
| InformesPage | `src/pages/InformesPage.tsx` | CSV gestoría mensual | vacationsService, exportGestoriaService | schedules, shift_templates, vacations, clock_entries |
| BolsaHorasPage | `src/pages/BolsaHorasPage.tsx` | Bolsa de horas + cierres de periodo | hoursBalanceService | schedules, shift_templates, vacations, clock_entries, monthly_balance_closures |

### 3.7 Ventas (pages en `src/pages/`)
| Pantalla | ruta fichero | qué hace | servicios | datos |
|---|---|---|---|---|
| VentasAnalisisPage | `src/pages/VentasAnalisisPage.tsx` | Análisis de ventas (Excel + histórico Last.app) | salesAnalysis | **Sin tablas Supabase**: REST Last.app + localStorage |
| PrediccionPersonalPage | `src/pages/PrediccionPersonalPage.tsx` | Predicción de personal por patrones + clima | salesAnalysis, enrichment, scheduler | localStorage + fetch clima |
| ZonasPedidoPage | `src/pages/ZonasPedidoPage.tsx` | Zonas de reparto (webhook + geocodificación) | deliveryZones | REST `lastapp-webhook` + localStorage |

### 3.8 Auth / Admin / Trabajador
| Pantalla | ruta fichero | qué hace |
|---|---|---|
| AuthRouter | `src/auth/AuthRouter.tsx` | Rutas públicas: `/login`, `/welcome`, `/reset-password`, `/acceso`→`AccesoTrabajadorPage` |
| WelcomePage / LoginPage / ResetPassword* / AccesoClaimPage | `src/pages/*` | Activación, login, reset, canje de token de acceso |
| AdminHomePage / CuentasListPage / NuevaCuentaPage / CuentaDetallePage | `src/admin/pages/*` | Panel superadmin Folvy (cuentas) |
| TrabajadorApp + Home/Portal/Fichaje/MiHorario/MisFichajes/MisDocumentos/MisVacaciones/MisTurnos/CambiosTurnoPage/MisChecklistsPage | `src/pages/trabajador/*` | App del trabajador (estado local, BottomTabBar) |

---

## 4. HUÉRFANOS Y CABOS SUELTOS

### (a) Pages / componentes sin padre ni ruta
- **`src/modules/kitchen/pages/KitchenRecipePage.tsx`** — código muerto declarado: import desactivado en `kitchen/module.tsx:14`. Confirmado: ninguna ruta lo monta (grep sólo halla la definición y comentarios).
- **`src/modules/kitchen/components/ReviewBanner.tsx`** — su **único importador** es el muerto `KitchenRecipePage.tsx:41,199`. Huérfano efectivo.
- **`src/pages/DashboardPage.tsx`** (`export DashboardPage`, re-export en `OtherPages.tsx:9`) — **sin importadores reales** ni ruta en el Shell (grep sin resultados fuera de la definición/re-export). Legado del routing `Page` retirado en G-8.7 (`App.tsx:17-21`).
- **`src/pages/PrediccionPersonalPage.tsx`** — montada por ruta `ventas/prediccion` (`ventas/module.tsx:31`) pero **sin item en el sidebar** de ventas (`ventas/module.tsx:35-40`): sólo alcanzable por URL directa. Pantalla "colgada" de la navegación.
- **`src/shell/eventBus.ts`** — el EventBus del contrato de módulos **no se importa en ningún sitio** de `src/` (sólo en su test). Los `publishes`/`subscribes` de los módulos son declarativos sin emisores (los propios comentarios lo dicen: `kitchen/module.tsx:56`, `appcc/module.tsx:76`). Infraestructura sin cablear.

### (b) Funciones exportadas en services que no importa nadie
Método: por cada `export` en un service, grep de la `src/` completa; si el nombre sólo aparece en su fichero, se marca.

**Totalmente muertas (no se usan ni dentro de su propio fichero) — 40**, las más relevantes:
- Supply: `goodsReceiptService.listLocationStock` (`...:660`) — **lee `recipe_item_location_stock`, el stock-on-hand, y NO lo consume ninguna UI** (ver Flujo b). También `updateGoodsReceipt:515`, `archiveGoodsReceipt:535`, `updateGoodsReceiptLine:569`, `deleteGoodsReceiptLine:589`; `inventoryCountService.voidInventoryCount:238`; `purchaseOrderService.archivePurchaseOrder:298`.
- Kitchen: `kitchenUnitService` create/update/archive/restore (`:97,105,119,129`), `recipeItemService.restoreRecipeItem:376`, `menuEngineeringService.getMenuEngineering:156`, `recipeStepService.setStepLines:232`, `ingredientTemplateService.getTemplateByCode:194`.
- APPCC: `incidentsService.markInProgress:715`, `incidentsService.resolveIncident:722`, `photosService.listPhotosForExecution:178`, `schedulesService.createSchedule:147`/`updateSchedule:216`, `templatesService.reorderItems:341`/`createOption:366`/`deleteOption:385`.
- Personal/`src/services/`: `calendarService` (`fetchPlanForWeek:179`, `fetchPublishedAssignmentsForEmployee:222`, `fetchPublishedAssignmentsForRange:256`, `duplicatePreviousWeek:341`, `mondayOf:519`, `shortDayLabel:548`, `fetchMonthlyHoursBefore:600`), `scheduler.checkRestViolations:490`/`calcLaborCosts:541`, `shiftSwapService.confirmTargetAccepts:231`/`listPendingForManager:397`, `horasComputo` (`dayKeyOf:11`, `minToHhmm:23`, `computeHourBankSummary:462`), `locationPlanningService.neededFor:148`/`fetchUnavailableEmployees:202`, `formationsService.getWorstFormationStatus:249`.

**Services con su superficie pública prácticamente ENTERA sin consumir fuera del fichero** (señal fuerte de UI no construida o retirada — verificar antes de borrar):
- `src/modules/integrations/services/connectorService.ts` — 8 exports sin importador externo (`rowToConnector`, `getConnectorByCode:191`, `upsertAccountConnector:288`, `setConnectionStatus:310`, `updateAccountConnector:330`, `archiveAccountConnector:359`, …). (Las pages usan `listConnectors`/`listAccountConnectors`/`requestConnector`; el resto, no.)
- `src/modules/kitchen/services/brandChannelRateService.ts` — 9 exports huérfanos.
- `src/modules/kitchen/services/brandLicensingAgreementService.ts` — 9 exports huérfanos.
- `src/modules/multitenancy/services/analysisAccountsService.ts` — 10 exports huérfanos.
- `src/modules/multitenancy/services/costCentersService.ts` — 9 exports huérfanos.
- `src/modules/multitenancy/services/salesChannelsService.ts` — varios huérfanos (`listSalesChannels` SÍ se usa desde channelRateService/kitchen).
- `src/modules/mapping/services/mappingService.ts` — `decideMapping:148` y el resto sólo internos (la UI de mapping no existe).
- `src/services/calendarService.ts` — casi toda la API pública (publish/unpublish/upsertAssignment/shiftType CRUD…) sin importador externo además de las muertas de arriba.
- `src/routes.ts` — `pathToPage`/`ROUTE_ENTRIES`/`pageToPath` sin uso fuera del fichero/tests (resto de `routes.ts` SÍ vivo: `pageToRoute` lo usan las pages APPCC; `isPublicAuthRoute`/`isShellRoute`/`isAdminRoute` los usa `App.tsx`/`AppContext`).

> Matiz: los mappers `rowTo*` están exportados sin necesidad pero se usan internamente — conviene des-exportar, no borrar. No hay exports referenciados sólo por tests (el repo no tiene tests que importen estos services salvo los `mappers.test.ts` de multitenancy).

### (c) Botones/enlaces sin destino (onClick vacío, TODO, href="#")
- `src/pages/WelcomePage.tsx:374` — `<a href="#">Términos y Condiciones</a>` (no enlaza a nada).
- `src/pages/WelcomePage.tsx:378` — `<a href="#">Política de Privacidad</a>` (no enlaza a nada).
- No se hallaron `onClick={() => {}}` vacíos ni handlers que sólo contengan un TODO en `src/`.

### (d) Stock que se calcula pero no se muestra (cabo suelto funcional)
- El stock-on-hand (`recipe_item_location_stock`) se actualiza en `confirm_goods_receipt`, pero **ninguna pantalla lo renderiza**: `InventoryPage` muestra áreas y conteos, no existencias; la columna "Stock" de `SupplyOrderBuilder.tsx:348` está fija en `—` (`SupplierCatalogEntry.stockOnHand` siempre `null`, `supplierCatalogService.ts:128`). El lector `listLocationStock` existe pero no se invoca desde UI.

---

## 5. TRAZA DE 3 FLUJOS

### (a) Crear un ingrediente → verlo costeado dentro de un plato
Componentes y transiciones (la navegación list↔detalle es **estado**, no rutas):
1. `KitchenItemsPage` (LISTA) → "Nuevo ingrediente" → modal de alta in-page → `createRecipeItem({type:'raw', costStrategy:'fixed'})` (`KitchenItemsPage.tsx:621`; service `recipeItemService.ts:273` inserta `recipe_item` + RPC `kitchen_recompute_item`). El coste = `fixed_cost` tecleado. **→ SALTO 1**: `handleCreated` (`:155`) abre `KitchenItemDetailPage`.
2. `KitchenItemDetailPage` → `PurchaseSourcesSection` → añadir proveedor+formato+precio → `setupSimplePurchase` (`purchaseFormatService.ts:447`) voltea `cost_strategy` fixed→last_purchase, crea formato y enlace `article_supplier`, trigger recalcula `computed_cost` y `cascadeFromItem` propaga a ancestros. (Paso intra-pantalla; no suma salto.)
3. Volver a la lista (**SALTO 2**) y cambiar a la ruta `recetas` por el sidebar (**SALTO 3**) → `KitchenRecipesPage` (LISTA de platos).
4. Click en un plato → `setSelectedRecipeId` → **SALTO 4** → `RecipeEditorPage`.
5. Tab Escandallo → "+" → elegir ingrediente + cantidad → `confirmAdd` (`RecipeEditorPage.tsx:1001`) → `addLine` en `recipe_line` → `getRecipeBreakdown` (RPC `kitchen_recipe_breakdown`). El `line.lineCost` server-side se pinta en la composición y `totalCost` en la hero. Panel derecho llama RPC `menu_item_economics` para food-cost % por canal.

**Conteo de saltos de pantalla: 4** (Items lista → Item detalle → Items lista → Recetas lista → Recipe editor).
**Atajo:** crear el ingrediente **desde dentro** de `RecipeEditorPage` ("+", crear nuevo, `createRecipeItem` en `:968`) = **0 saltos** (alta, coste por precio fijo y visualización en una sola pantalla); pero costear por compra real sigue exigiendo ir a la ficha del ingrediente (2 saltos ida/vuelta).
**Cabo:** no hay acción de "crear plato" en este flujo — los platos se asumen pre-existentes (import/OCR/IA).

### (b) Recibir un albarán por OCR → ver el stock actualizado
1. `GoodsReceiptsPage` (lista) → "Escanear albarán" → `setView('scan')` (`:270`). **[pantalla 1]**
2. `ReceiptScanPanel` → `scanReceipt` (sube a bucket `receipt-uploads` + EF `ocr-albaran`, `goodsReceiptService.ts:847-869`) → "Crear recepción desde esto" → `resolveReceiptHeader` + `findDuplicateReceipt` → `onCreateReceipt` (`:121-140`) → padre `setView('form')` (`GoodsReceiptsPage.tsx:230`). **[→ pantalla 2 → 3]**
3. `GoodsReceiptForm` (modo OCR) → líneas auto-casadas con RPC `run_mapping`; casado manual en modal `LineMatchPicker` (sin salto) → `persist(true)`: `createGoodsReceipt`+líneas, `ensureLastPurchaseStrategy`, **`confirmReceipt`** (RPC `confirm_goods_receipt` postea al ledger `stock_movement` y refresca `recipe_item_location_stock`) + `cascadeFromItem`, `learnFromReceipt`/`learnSupplierAlias` (`:603-643`, `:674-787`) → vuelve a la lista con flash. **[→ pantalla 1/lista]**
4. "Ver el stock actualizado": **no existe pantalla de existencias**. Sólo se observa el estado "Confirmado" + flash y el efecto downstream en coste/margen. El snapshot `recipe_item_location_stock` no se renderiza (ver §4d).

**Conteo de saltos: 3** (lista→scan→form→lista). Alternativa sin form: botón "Confirmar" sobre un borrador en la propia lista (`GoodsReceiptsPage` `handleConfirm:160-174`).
**Veredicto del último paso:** el "ver stock actualizado" como vista de inventario **no está construido** — **no determinado / no implementado** como pantalla.

### (c) Crear un pedido a un proveedor
1. `SupplyOrdersPage` (lista) → "Nuevo pedido" → `setView('builder')` (`:150`). **[pantalla 1]**
2. `SupplyOrderBuilder` → elegir proveedor (`listSuppliers`) → `getSupplierCatalog` (lee `article_supplier`) → teclear cantidades → "Guardar pedido" → `handleSave` (`:147-207`): `createPurchaseOrder` (insert `purchase_order`, estado borrador) + bucle `createPurchaseOrderLine` (qty>0). Local desde `useOperativeLocation`. `onSaved(order.id)` → padre `setView('list')` + `setSelectedOrderId` (`SupplyOrdersPage.tsx:116-122`). **[→ pantalla 2 → 3]**
3. `SupplyOrderDetailPage` (auto-abierta) → cabecera + líneas; añadir/borrar (`AddLineModal`), PDF (`buildPurchaseOrderPdfData`+`generatePurchaseOrderPdf`), "Marcar como enviado" (`updatePurchaseOrder`). Desde aquí "Registrar recepción" lanza `GoodsReceiptForm` (puente al flujo b). **[pantalla 3]**

**Conteo de saltos: 2** (lista→builder→detalle; la lista intermedia es transitoria, el detalle se autoselecciona en el mismo `onSaved`).

---

## 6. DUPLICACIONES

1. **Estrategia de coste / cascada se dispara desde 2 dominios.** Kitchen la posee (`costCascadeService`, `purchaseFormatService.setupSimplePurchase`) y Supply la invoca para crear formatos, voltear `cost_strategy` y propagar (`goodsReceiptService` importa `cascadeFromItem` + `createPurchaseFormat`). No es copia de lógica, pero el "flip a last_purchase + cascada" se ejecuta en `KitchenItemDetailPage/PurchaseSourcesSection` y en `GoodsReceiptForm` — dos sitios con la misma secuencia.
2. **Alta rápida de proveedor / artículo raw** existe en Kitchen (`purchaseFormatService.createSupplier`, `recipeItemService.createRecipeItem`) y se re-expone en Supply (`goodsReceiptService.quickCreateSupplier`, `quickCreateRawItem`, `LineMatchPicker.quickCreateRawItem`). Mismo dato (proveedor / `recipe_item`) creado desde 3 entradas.
3. **OCR de documento compartido pero con dos "resolve" paralelos.** `ReceiptScanPanel` y `InvoiceScanPanel` llaman al mismo `scanReceipt`/EF `ocr-albaran`, pero hay `resolveReceiptHeader` (goodsReceiptService) y `resolveInvoiceHeader` + `buildInvoiceOcrPrefill` (supplierInvoiceService) con lógica de cabecera/duplicado solapada.
4. **Ficha editable del mismo concepto en 2 pantallas.** El ingrediente se edita en `KitchenItemDetailPage` (identidad, coste, alérgenos, nutrición) y partes se re-tocan al casar en `GoodsReceiptForm`/`LineMatchPicker` (familia, unidad base, estrategia). El producto de carta se edita en `CatalogProductDetailPage` y se muestra (read-only) en `KitchenMenuPage`.
5. **IVA / comisiones de canal en varios servicios.** `vatService` (categoría IVA del item, RPC `vat_rate_for`), `channelRateService` (comisiones por canal, `baseFromGross`/`vatFromGross`), `brandChannelRateService` (tarifas marca×canal) y `purchaseOrderPdf` (RPC `vat_rate_for` por línea) calculan/consultan IVA por caminos distintos.
6. **Bolsa de horas duplicada cliente vs servicio.** `src/components/MiBolsaHoras.tsx` y `src/pages/BolsaHorasPage.tsx` (+ `hoursBalanceService`, `horasComputo`) cubren el mismo dominio de cómputo horario para trabajador y gestor.
7. **Selección de local operativo en 2 mecanismos.** Shell `LocationSelector`/`useLocationScope` (scope de visualización) vs Supply `useOperativeLocation`/`operativeLocationService` (local de riesgo derivado de fichaje) — dos fuentes de "local activo".

---

## 7. INVENTARIO DE TABLAS

Fuente: `CREATE TABLE` en `supabase/migrations/*.sql` + bloque `Tables` de `src/types/database.ts`. (→ migración de primera aparición.)

### Multitenancy / Auth / Plataforma (baseline salvo nota)
accounts, analysis_account, app_settings, auth_rate_limits, billing_events, billing_plans, brand, brand_location_availability, cost_center, feature_flags, impersonation_sessions, invoices, locations, manager_locations, manager_permissions, modules, permission_set_assignments, permission_sets, platform_admin_2fa, platform_admin_permissions, platform_admins, platform_audit_log, platform_settings, quotas, security_audit_log, submodules, subscription_items, subscriptions, usage_counters, user_profiles, domain_events — todas en `00000000000000_baseline.sql`.

### Kitchen / Coste
kitchen_unit, kitchen_cut_type, recipe_item, recipe_line (`..._capa1.sql`); kitchen_settings (`..._capa1_1`); recipe_item_unit_conversion (`..._capa1_2`); menu_item (`..._capa2_menu_item`); brand_licensing_agreement (`..._capa2_licensing`); brand_channel (`..._brand_channel`); brand_channel_rate (`20260602T0000`); channel_rate (`20260605T0300`); dish_family_template, tag_template, kitchen_cut_type_template, allergen, **dish_family→renombrada a `recipe_family`** (`20260603T1800`), tag, recipe_item_ai_session, recipe_item_tag, recipe_item_step, recipe_item_photo, recipe_item_version, recipe_item_allergen, recipe_item_production_check, user_saved_view (`20260529T0700`); recipe_item_purchase_format (`20260531T1330`); vat_category, vat_rate, family_vat_default (`vat_model.sql`); ingredient_template, ingredient_template_allergen (`20260607T1900`); menu_category, menu_item_override, modifier_group, modifier_option, modifier_group_assignment, modifier_recipe_impact, combo_slot, combo_slot_option (`20260605T0100`).

### Supply / Compras / Inventario
recipe_item_location_stock, goods_receipt, goods_receipt_line, stock_movement (`20260604T1000`); goods_receipt_ai_session (`20260604T1600`); supplier_alias (`20260604T2000`); supply_settings (`20260604T2400`); supplier_invoice, supplier_invoice_line, supplier_invoice_receipt (`20260604T2600`); invoice_approval_rule (`20260604T3200`); purchase_order, purchase_order_line (`20260603T2000`); storage_area, recipe_item_storage_area, inventory_count, inventory_count_line (`20260604T3400`).

### Ventas
sale, sale_line (`20260527_folvy_sales_model.sql`); sales_channel (baseline).

### APPCC / Safety (todas baseline)
appcc_audit_items, appcc_audit_log, appcc_audit_response_photos, appcc_audit_responses, appcc_audit_schedules, appcc_audit_sections, appcc_audit_templates, appcc_audits, appcc_execution_photos, appcc_execution_responses, appcc_executions, appcc_incident_actions, appcc_incident_events, appcc_incident_photos, appcc_incidents, appcc_notifications, appcc_plans, appcc_schedule_responsibles, appcc_schedules, appcc_signatures, appcc_template_item_options, appcc_template_items, appcc_templates.

### Integraciones
lastapp_integration, lastapp_location_map, lastapp_product_map, lastapp_catalog_product (`20260528T1100`); mapping_proposal, mapping_candidate, mapping_decision (`20260527T1200`); connector, account_connector (`20260602T0200`); ingestion_monitor_config, ingestion_monitor_state (`20260603T1600`); ai_memory, ai_interaction (`20260527T2000`).

### Personal / RRHH (todas baseline)
clock_entries, documents, employee_availability, employee_formations, employee_notifications, employees, location_planning, monthly_balance_closures, open_shift_requests, open_shifts, schedules, shift_assignments, shift_minimums, shift_swap_requests, shift_templates, shift_types, vacation_settings, vacations, weekly_availability, weekly_plans.

### Otros — backups de baseline (snapshots históricos)
`_backup_20260516_*` (accounts, accounts_pre_slug, billing_plans, feature_flags, functions, modules, policies, submodules, user_profiles) y `_backup_20260517_user_profiles_read_policy` — todos en baseline.

### RPCs / funciones Postgres (nombre → migración)
- baseline: appcc_calc_response_validation, appcc_handle_response_incident, appcc_mark_overdue, belongs_to_account, cleanup_auth_rate_limits, current_user_account_ids, current_user_has_platform_permission, current_user_is_admin(_of/_or_manager_of), custom_access_token_hook, force_close_long_impersonations, has_permission, protect_last_admin, replicate_system_permission_sets, seed_appcc_for_account, set_updated_at, trg_seed_appcc_on_account_insert, update_formations_updated_at, update_swap_updated_at, update_user_profile_updated_at.
- Kitchen: kitchen_recipe_breakdown, kitchen_recompute_item (redef. en `20260603T1700`), menu_item_economics (redef. en `20260603T1200` y `20260605T0300`), kitchen_recompute_raw_cost, trg_article_supplier_recompute_cost, kitchen_ancestors_of, recipe_line_prevent_cycle, kitchen_dish_state_for_ai, kitchen_similar_dishes_for_ai.
- VAT: vat_rate_for, propose_vat_category, trg_propose_vat_on_family.
- Integraciones: confirm_mapping, connector_assert_manager, connector_secret_save/_status/_clear.
- Supply: recompute_purchase_order_status, confirm_goods_receipt, void_goods_receipt, recompute_location_stock, learn_supplier_alias, learn_from_receipt, apply_inventory_count, build_inventory_count, close_inventory_count, apply_invoice_costs, run_invoice_match, next_/set_goods_receipt_code, next_/set_inventory_count_code, next_/set_supplier_invoice_code, invoice_required_role, current_user_can_approve_invoice, next_/set_purchase_order_code.

---

## 8. DEUDA TÉCNICA VISIBLE

### 8.1 Marcadores (ruta:línea)
**TODO genuino en código (4):**
- `src/modules/kitchen/services/recipeItemService.ts:208` — "regenerar tipos de Supabase y quitar el cast".
- `src/modules/kitchen/services/recipeLineService.ts:130` — idem.
- `src/modules/multitenancy/services/analysisAccountsService.ts:27`.
- `src/modules/multitenancy/components/BrandFilterSelector.tsx:17`.
(~30 `TODO` adicionales son placeholders de capturas en `src/docs/**`, no código; y muchos `TODO`/`TODOS` sueltos son la palabra española "todo", no marcadores.)

**FIXME: 0. HACK: 0.**

**DEUDA (marcador propio del proyecto, 32):** 29 en `src/` + 3 en functions. Concentración en multitenancy/services y kitchen. Ejemplos: `src/modules/multitenancy/hooks/useAuth.ts:33` (DEUDA B-8), `src/routes.ts:37,39`, `src/context/AppContext.tsx:348`, `src/services/supabaseSync.ts:47,162`, `src/modules/supply/services/purchaseOrderPdf.ts:10,151,191`, `src/platform/accountModulesService.ts:8`; functions: `supabase/functions/lastapp-catalog-import/index.ts:7,67,306`, `supabase/functions/extract-recipe/index.ts:228`.

**needs_review / needsReview:** campo de dominio legítimo (flag anti-invención en BBDD/tipos), **no es deuda**. Cientos de apariciones en `database.ts`, `types/kitchen.ts` y servicios kitchen/supply/mapping; en functions: `lastapp-webhook:289`, `lastapp-backfill-sales:149`, `ocr-albaran:174,201,209`, `map-products:200,403`.

### 8.2 Casts de escape de tipos
**`as unknown` (~46):** 38 en `src/` + 8 en functions. Foco máximo en `src/modules/appcc/services/incidentsService.ts` (16 casts: ll. 173,202,224,269-271,326,400,462,504,544,592,630,666,708,761) y en todos los services de `src/modules/supply/`. Patrón dominante: `supabase! as unknown as {...}` para sortear tipos generados desactualizados — misma raíz que los TODO de "regenerar tipos".

**`as any` (~45):** ~36 en `src/` + ~9 en functions. Foco: `src/modules/kitchen/services/ingredientFamilyService.ts` (15: ll. 147,158,180,214,263,275,280-284,314,332,340,352), `src/services/scheduler.ts:158,252,621,656`, `src/services/salesAnalysis.ts:153,154,177,254`, `src/components/MiBolsaHoras.tsx:64-66,88`, `src/pages/BolsaHorasPage.tsx:109-111`; functions: `map-products:301,303,307`, `folvy-ai:114,128`, etc.

### 8.3 SCHEMA DRIFT (columnas/tablas usadas en código pero sin `CREATE TABLE` en migraciones)
Tablas en `database.ts`/usadas por servicios pero **sin CREATE en `supabase/migrations/`** (creadas fuera de banda en la BBDD viva — coherente con "la BBDD es la verdad"):
- `supplier` — sólo `ALTER` en `20260531T1730`, nunca `CREATE`.
- `article_supplier` — sólo `ALTER` en `20260531T1330`, nunca `CREATE`.
- `recipe_item_location_cost`, `recipe_item_step_line` — sin referencia de creación.
- `purchase`, `purchase_line` — en `database.ts`, sin migración.
- `account_email_log`, `account_gestoria_config` — sin migración.
- `lastapp_webhook_log` — sólo mencionada en comentario (`20260603T1400`), nunca creada.

Funciones en el bloque `Functions` de `database.ts` **sin migración que las defina** (drift de RPC): `create_account_tx`, `delete_account_tx`, `get_effective_permissions`, `next_folvy_code`, `kitchen_dishes_incomplete`, `kitchen_raw_usage_counts`, `kitchen_recipe_cost_by_location`, `location_economics`, `location_labor_cost`, `materialize_recipe_session`, `menu_item_units_sold`, `resolve_lastapp_line`, `resolve_mapping_proposals`, `seed_lastapp_catalog`. (Varias **se invocan desde la app**: p.ej. `kitchen_dishes_incomplete` y `kitchen_raw_usage_counts` en kitchen, `get_effective_permissions` en personal — funcionan en la BBDD pero no están versionadas.)

Renombrado (no es drift, pero a vigilar): `dish_family` → `recipe_family` (`20260603T1800`); `database.ts` ya refleja `recipe_family`.

**Sin drift inverso:** no se halló ninguna tabla creada en migraciones que falte en `database.ts`.

---

### Notas de fiabilidad
- Las tablas se infieren de `.from('...')`/`.rpc('...')` reales en los servicios; donde un service usa el cliente casteado, la tabla puede no estar en los tipos generados (de ahí el drift).
- `AvisosSettingsPage` y `UsuariosAccesosPage` no se abrieron a fondo: sus tablas exactas quedan como **no determinado**.
- Conteos de marcadores son aproximados (±) por el ruido de palabras españolas; las rutas:línea citadas son exactas.
</content>
</invoke>
