# P01 · El obrador — comprobaciones previas (tarea 1)

> Solo lectura. Base: producción (`xzmpnchlguibclvxyynt`), consultada el
> 06/11/2026 por MCP con `execute_sql` (solo `select`). Código: `main` en
> `8934307`. No se ha escrito nada en ninguna base.
>
> **Staging no se ha podido mirar:** el MCP de esta sesión solo ve el proyecto
> de producción. Lo que aquí se dice «de la base» es de producción.

## 0. Resumen en una pantalla

- **Casi todo lo de facturar ya existe y se reutiliza:** la factura emitida
  (`conta_venta_guardar` → `conta_venta_emitir`, con serie, asiento y
  VeriFactu por disparador), la rectificativa (`conta_venta_corregir`), el
  cliente (`party_save_customer`), el proveedor con su tercero (disparador
  `party_desde_proveedor`) y el casado de una factura de proveedor con sus
  recepciones (`_compras_casar` + `supplier_invoice_receipt` +
  `goods_receipt_path`).
- **La recepción ya sabe contar con diferencias:** `goods_receipt_line` tiene
  `doc_qty` (lo que dice el papel), `qty_received` (lo contado),
  `discrepancy_reason` y `flagged_for_office`. Es justo «lo enviado contra lo
  contado».
- **Lo nuevo de verdad:** el tipo de ubicación, la tarifa del obrador, la
  producción, el envío con albarán (cabecera y líneas) y la factura del mes que
  junta los dos lados.
- **Hay 9 choques entre el encargo y la base** (§6). Tres frenan tareas
  concretas: Piri Piri no tiene contabilidad montada (frena la 5), no tiene
  escandallos ni costes (frena el contraste de la 3), y staging no se puede
  consultar desde aquí (frena la 7). **Paro aquí, como dice el encargo.**

## 1. Lo que hay hoy en la cuenta `piri-piri` (producción)

Consulta (cuenta por `slug`, todo filtrado por su `account_id`, regla 9):

| Qué | Hay |
|---|---|
| Sociedades | 3: Piripiri España, S.L.; Frango Takeaway, S.L.; Inversiones Piripiri Prosperidad, S.L. Las tres con NIF y activas. |
| Ubicaciones (`locations`) | 4, todas activas y `is_billable = true`: Obrador Central y Las Tablas → Piripiri España; Lavapiés → Frango; Prosperidad → Inversiones Prosperidad (por `location_company`). **Cuadra con los hechos de Julio.** |
| Relaciones (`company_relation`) | Frango → Piripiri España, `group`, `related_is_parent = false`. Prosperidad → Piripiri España, `group`, `related_is_parent = true`. Prosperidad → «Romor Supply, S.L.» (tercero), `other_related`. |
| Artículos (`recipe_item`) | 56, **todos `raw`**, todos con categoría de IVA, **ninguno con coste** (`computed_cost` nulo o 0). |
| Escandallos (`recipe_line`) | **0.** |
| Stock, movimientos, ventas, recepciones | 0, 0, 0, 0. |
| Facturas emitidas / recibidas | 0 / 0. |
| Terceros (`party`), proveedores (`supplier`) | 0 / 0. |
| Ejercicio, plan de cuentas (`company_account`), perfil fiscal, series (`invoice_series`), VeriFactu (`verifactu_empresa`) | **0 en las tres sociedades.** |
| Usuarios | 1. |

## 2. Cada sitio que lista ubicaciones, y si debe excluir el obrador

### 2.1 Cómo llegan los locales a la pantalla

- `AppContext` carga **todas** las ubicaciones de la cuenta
  (`supabaseSync.ts`, `fetchLocations`) y no se toca (regla de la casa).
- Encima hay una vista derivada, `useVisibleLocations` (el responsable de
  local solo ve los suyos), y el **selector de local de la barra de arriba**
  (`LocationSelector`, en `ShellTopBar`) es **uno solo para toda la app**.
- Consecuencia: **el obrador no se puede quitar en el selector**, porque
  compras, inventario, mermas, APPCC y fichajes lo necesitan ahí. Se quita
  **en cada sitio de vender**. Propuesta para la tarea 2: el tipo viaja en
  `Location` (`kind: 'local' | 'obrador'`), un `useLocalesQueVenden()` al lado
  de `useVisibleLocations`, y cada pantalla de vender lo usa. Si en una de
  vender está elegido el obrador en la barra, dice «El obrador no vende» en vez
  de enseñar ceros.

### 2.2 Front (`src/`): sitios que leen locales, por grupo

**Deben excluir el obrador (vender, carta, canales, plataformas, informes de
ventas, reparto):**

| Grupo | Ficheros |
|---|---|
| TPV | `modules/pos/pages/TpvSalePage.tsx` |
| Ventas e informes de ventas | `modules/ventas/home/ventasDelDia.ts`, `modules/ventas/home/eventosDeMarca.ts`, `modules/ventas/services/foodCostService.ts`, `modules/ventas/services/channelRatesService.ts`, `modules/ventas/services/licensedService.ts`, `pages/VentasDashboardPage.tsx`, `pages/VentasAnalisisPage.tsx`, `pages/InformesPage.tsx`, `pages/EconomiaPlataformasPage.tsx`, `shell/home/homeMetricsService.ts`, `shell/home/informes/informesService.ts`, `modules/kitchen/pages/SalesExceptionsPage.tsx`, `modules/kitchen/services/salesByBrandService.ts` |
| Cartas y catálogo publicado | `modules/kitchen/services/catalogPublishService.ts`, `modules/kitchen/services/hubriseCatalogCreateService.ts`, `modules/kitchen/services/platformOffersService.ts`, `modules/kitchen/components/EnCartaTab.tsx`, `modules/kitchen/components/EditPricesModal.tsx`, `modules/kitchen/pages/KitchenMenuPage.tsx`, `modules/kitchen/pages/CatalogFichaPage.tsx` |
| Disponibilidad | `modules/kitchen/services/availabilityService.ts`, `modules/integrations/services/locationAvailabilityService.ts`, `pages/DisponibilidadPage.tsx` |
| Canales, marcas por local, plataformas | `modules/multitenancy/components/brands/BrandLocationsTab.tsx`, `modules/multitenancy/components/brands/BrandHoursTab.tsx`, `admin/services/lastappIntegrationService.ts`, `modules/integrations/pages/IntegrationsMarketplacePage.tsx` |
| Pedidos, cocina de pedidos, reparto, tienda | `modules/orders/pages/OrdersFeedPage.tsx`, `DispatchBoardPage.tsx`, `KitchenTimesPanelPage.tsx`, `OrdersSettingsPage.tsx`, `modules/kds/*` (`laCocina.ts`, `KdsBoardPage.tsx`, `BrandCloseControl.tsx`), `modules/integrations/services/locationDispatchService.ts`, `modules/reparto/services/quienReparteService.ts`, `modules/shop/pages/ShopDeliveryPage.tsx`, `modules/shop/admin/campaignService.ts`, `pages/ZonasPedidoPage.tsx` |
| Cierre del día | Lo hace la base por sociedad (`conta_cierre_del_dia_todas`), ver 2.3. En el front, el bloque de ventas del cierre de Sumied. |

**Deben incluirlo (fichajes y equipo, compras y recepciones, inventario,
mermas, APPCC, escandallos):**

| Grupo | Ficheros |
|---|---|
| Fichajes y equipo | `pages/FichajesGlobalPage.tsx`, `KioskoFichajePage.tsx`, `PlantillaPage.tsx`, `PlantillaTurnosPage.tsx`, `StaffPage.tsx`, `BolsaHorasPage.tsx`, `CalendarioPage.tsx`, `TurnosAbiertosPage.tsx`, `CambiosPendientesPage.tsx`, `UsuariosAccesosPage.tsx`, `InformesTeamPage.tsx`, `pages/trabajador/*`, `modules/personal/*`, `modules/conta/laboral/*`, `components/personal/*`, `pages/CoursesPage.tsx` |
| Compras, recepciones, inventario, mermas | `modules/supply/*` (`goodsReceiptService.ts`, `countFormatService.ts`, `purchaseOrder*`, `supplierCatalogService.ts`, `home/conteosPendientes.ts`, `home/stockNegativoHome.ts`, `hooks/useOperativeLocation.ts`), `modules/conta/services/proveedorService.ts` |
| APPCC | `modules/appcc/*` |
| Escandallos y coste por local | `modules/kitchen/pages/KitchenItemDetailPage.tsx`, `modules/kitchen/components/ItemMovementsPanel.tsx` |

**A decidir en la tarea 2, mirando la pantalla** (mezclan cosas):
`pages/DashboardPage.tsx`, `pages/AhoraMismoPage.tsx`, `shell/home/HomeGeneral.tsx`,
`shell/home/atencionService.ts`, `pages/InsightsPage.tsx`,
`pages/PrediccionPersonalPage.tsx` (predice personal por ventas),
`modules/personal/home/enCocinaAhora.ts`, `pages/OtherPages.tsx`. Regla que
propongo: el trozo de ventas de cada una excluye el obrador; el de equipo, no.

**Funciones edge** que listan locales: `catcher-dispatch`,
`hubrise-brand-connect`, `hubrise-catalog-create`, `hubrise-oauth-start`,
`weather-events`, `sports-events` → excluir (vender y reparto).
`manage-employee`, `payroll-extract` → incluir. `folvy-ai` → mirar en la
tarea 2 (usa locales para varias cosas).

### 2.3 Base: 170 funciones leen `locations`

Consulta: `pg_proc` con `from/join (public.)locations` en el cuerpo. Las
vistas: ninguna. Por grupo:

- **Excluir (vender, canales, plataformas, pedidos, reparto, disponibilidad,
  informes de ventas):** `sales_dashboard`, `_report_sales_rows`,
  `platform_metrics`, `licensed_economics_dashboard`, `agent_*`,
  `offers_goal_report`, `availability_kpis`, `_availability_panel_core`,
  `_set_product_availability_core`, `set_menu_item_override`,
  `set_modifier_option_availability`, `brand_status`, `set_brand_status`,
  `closed_brands`, `anomalous_brand_closures`, `apply_price_operation`,
  `hubrise_*`, `push_location_opening_hours`, `location_status`,
  `set_location_status*`, `location_demand_pct`, `location_surge_*`,
  `orders_feed`, `kds_*`, `pase_*`, `pending_board`, `kitchen_day_banner`,
  `_kitchen_day_banner_for`, `kitchen_time_stats`, `tg_auto_dispatch`,
  `resolve_dispatch`, `decidir_quien_reparte`, `dispatch_watchdog_scan`,
  `delivery_watchdog_scan`, `reparto_*`, `courier_feed_by_token`,
  `track_by_token`, `shop_*`, `list_delivery_zones`, `pedidos_sin_direccion`,
  `fijar_direccion_entrega`, `sale_delivery_distance_km`, `get_sale_ticket`,
  `ticket_invoice_*`, `conta_cierre_bloque_ventas`, `conta_resumen_ventas`,
  `conta_propuesta_ventas_dia`, `_conta_propuesta_ventas`, `conta_plataforma*`,
  `conta_liquidacion*`, `conta_tienda_*`, `conta_local_de_tienda`,
  `_f01_*`, `f01_*`, `list_pending_external_brands`, `_parte_del_dia_raw`.
- **Vigías que darían falsa alarma con un obrador que no vende** (excluir):
  `ingesta_silencio_watchdog`, `ventas_cerradas_sin_consumo_watchdog`,
  `consumo_sin_descontar_watchdog`, `_registrar_fallo_de_consumo`,
  `kds_device_silence_check`, `db_health_stale_devices_report`.
- **Incluir (equipo, fichajes, compras, stock, APPCC, contabilidad de
  gastos):** `fichar`, `employee_daily_detail`, `team_*`, `training_*`,
  `generate_week_schedule`, `_informe_registro_jornada`,
  `conservar_registro_de_jornada`, `enqueue_clockout_reminders`, `lab_*`,
  `fuente_nominas_mes_v1`, `_s01p_nomina_proponer`, `item_movements`,
  `item_stock_by_location`, `list_stock_movements`,
  `list_item_stock_movements`, `cron_generate_daily_counts`,
  `autoconteos_sin_aplicar`, `pending_receptions_report`,
  `refresh_location_receipt_trust`, `purchase_orders_stuck`, `compras_*`,
  `conta_recibida_guardar`, `conta_documentos_recibidos`,
  `conta_factura_para_revisar`, `conta_pagos_*`, `team_compliance_scan`,
  `certificado_de_salida`, `bank_cuenta_alta`, `treasury_account_*`.
- **Neutras (cuenta, alta, borrado, permisos):** `onboard_account`,
  `migrate_locations_and_staff`, `delete_account_tx`,
  `current_user_location_ids`, `device_location_by_token`,
  `location_company_misma_cuenta`, `_fill_acc_from_location`,
  `_account_of_employee`, `encolar_alerta`, `system_alert_queue_drain`.

El reparto fino, función a función, se hace en la tarea 2 con la prueba que
lo vigile. **El cierre del día** va por sociedad y por ventas
(`conta_cerrar_dias(company)`): un obrador sin ventas no genera día; hay que
comprobar en la tarea 2 que no avisa de «día sin cerrar».

### 2.4 Tablas que cuelgan de un local (104)

Las de vender (`sale`, `sales_day_summary`, `brand_*`, `channel_*`,
`platform_store*`, `delivery_*`, `dispatch_rule`, `menu_item_override`,
`kds_device`, `printer`, `dining_*`, `pos_ticket_counter`, `ticket_invoice*`,
`uber_store_map`, `business_hours*`…) no deben poder apuntar a un obrador. Se
propone en la tarea 2 un disparador que lo impida en las altas nuevas, no un
`CHECK` (la columna está en otra tabla).

El disparador `trg_seed_kitchen_stations` siembra estaciones de cocina al dar
de alta una ubicación: en un obrador no molesta, pero no hacen falta.

### 2.5 Cuota de Folvy

`locations.is_billable` (por defecto `true`), lo leen `onboard_account` y
`migrate_locations_and_staff`; el front no lo expone. El obrador ya está a
`true`. **No se toca nada**, como pide el encargo.

## 3. Cómo funciona hoy cada pieza

### 3.1 `register_transfer` y `stock_transfer`

`register_transfer(cuenta, origen, destino, artículo, cantidad, notas,
usuario, nombre)`, `SECURITY DEFINER`, comprueba `belongs_to_account`.

- Un artículo por llamada, una fila en `stock_transfer` (sin cabecera ni
  número), y dos movimientos: `traspaso_salida` (−) en origen y
  `traspaso_entrada` (+) en destino, los dos con `source_type = 'transfer'`.
- **Valora al coste medio del origen, y con `coalesce(avg_unit_cost, 0)`:** si
  el origen no tiene coste, el traspaso entra a **coste 0** sin avisar. Es lo
  que el encargo prohíbe.
- Exige stock suficiente en origen.
- No sabe de sociedades ni de albarán, ni de «en camino»: la entrada es en el
  mismo instante.

**Veredicto:** no se reutiliza para el envío. Se deja como está para los
traspasos de hoy (no lo usa ninguna cuenta con obrador).

### 3.2 `stock_movement` y el coste medio

- `movement_type` (CHECK): `recepcion, consumo, ajuste, traspaso_entrada,
  traspaso_salida, recuento, apertura, merma`.
- `source_type` (CHECK): `goods_receipt_line, sale, inventory_count, transfer,
  adjustment, waste`.
- Lleva `lot_code` y `expiry_date`: el lote de producción cabe sin columna
  nueva.
- El saldo lo recalcula `recompute_location_stock_core(artículo, local)`:
  recorre el libro entero en orden y **solo las entradas que considera
  «recepción»** (`source_type = 'goods_receipt_line'` o `movement_type in
  ('recepcion','traspaso_entrada')`) mueven el coste medio; el resto solo
  mueve cantidad.
  - Rechaza una entrada si su coste es ≤ 0 o se sale de la banda
    (`supply_settings.cost_band_factor`, 5 por defecto) contra el coste de
    ficha. Rechazar es **ignorar en silencio**: no avisa.
  - Si no queda ninguna entrada válida, el coste medio es el de ficha
    (`computed_cost`, y si es 0, `fixed_cost`), y si tampoco, `NULL`.

Lo que implica para P01:

- `produccion_entrada` tiene que contar como «recepción» en
  `recompute_location_stock_core` (si no, el producto terminado no tendría
  coste medio propio). Es un «cambia en caliente» de una función del camino
  del stock: con su prueba de staging y la regla 10 (cerrar una venta,
  recibir un albarán, apuntar una merma y aprobar un recuento).
- La entrada del envío en el local (a precio de albarán) puede caer fuera de
  la banda si la tarifa es más de 5 veces el coste de ficha, y se ignoraría
  sin avisar. Ver choque 6.4.
- **El coste medio del obrador puede ser el de ficha y no uno real.** Ver
  choque 6.5.

### 3.3 Recepciones (`goods_receipt`, `goods_receipt_line`)

- Estados: `borrador → recibido → confirmado` (y `anulado`).
  `source` (CHECK): `manual, ocr`.
- `receive_goods_receipt` (tablet): mete el stock **siempre**, deja
  «recibido» y, si el local tiene confianza ganada
  (`location_receipt_trust.direct_confirm_enabled`), confirma solo.
- `confirm_goods_receipt` (oficina): para pasar de «recibido» a «confirmado»
  **exige proveedor y nº de albarán**, y que no quede ninguna línea sin
  decidir. Si el proveedor tiene `notify_group = 'ctb'`, encola el aviso a la
  oficina con «tiene diferencias» calculado de los números
  (`_ctb_receipt_differences_core`).
- `_post_goods_receipt_lines`: un movimiento `recepcion` por línea, coste del
  formato de compra o `unit_cost × qty_received / qty_in_base`.
- La línea ya guarda **lo que dice el papel (`doc_qty`, `doc_amount`) y lo
  contado (`qty_received`)**, el motivo (`discrepancy_reason`) y
  `flagged_for_office`. Es el «se marca y sigue» del encargo.
- `goods_receipt` **no lleva sociedad**: se deduce por `location_company`.

**Veredicto:** la recepción del envío en el local **se reutiliza entera**
(mismo gesto, mismas tablas, mismo aviso a la oficina). Hace falta: un
`source` nuevo (`obrador`), el enlace al envío, y que el proveedor sea la
sociedad del obrador (venta entre sociedades) o ninguno (traspaso interno,
ver choque 6.6).

### 3.4 El camino de una recepción hacia su factura (`goods_receipt_path`)

Al confirmar, el disparador `tg_goods_receipt_compras_camino` decide el camino
con `_compras_camino_calcula`, según la ficha del proveedor:

- `invoicing_mode` (CHECK): `per_delivery` («con cada entrega»),
  `delivery_note_then_invoice` («entrega con albarán y factura después»),
  `monthly_settlement` («liquidación mensual»). **La que pide el encargo,
  «agrupa albaranes en una factura», es `delivery_note_then_invoice`.**
- Con ese modo, la recepción queda `path = 'pendiente_factura'`.
- `_compras_casar(factura, recepciones[])` la casa con una factura del mismo
  proveedor: escribe `supplier_invoice_receipt`, consume el camino y compara
  bases (`match_status` `ok` o `con_diferencias`).
- `_compras_fin_de_mes(empresa, mes)` **periodifica** lo pendiente de factura
  al cierre de mes (`purchase_accrual`, con asiento propuesto). Ver choque 6.7.

### 3.5 `customer_invoice` (factura emitida)

- `conta_venta_guardar(empresa, id, datos, líneas)`: crea o rehace el borrador.
  Solo admin o encargado de la cuenta. Cada línea pide `tipo_id`
  (`tax_rate`) y `cuenta_id` (una `company_account` 7xx **de esa sociedad**).
  Serie por defecto `F`.
- `conta_venta_emitir`: numera (`customer_invoice_counter`), hace el desglose
  de VeriFactu (`_verifactu_desglose`), crea la cuenta del cliente si falta
  (`company_account_add`), propone y valida el asiento
  (`_journal_entry_proponer`, `journal_entry_validar`). El disparador
  `customer_invoice_verifactu` da de alta el registro al pasar a «emitida».
  Una emitida es inalterable (`customer_invoice_inalterable`).
- `origin` (CHECK): `a_mano, recurrente, presupuesto, cierre_dia, tienda,
  automatica`. Hará falta uno nuevo (`obrador`) o usar `automatica`
  (decisión de la tarea 5).
- Rectificar: `conta_venta_corregir(id, tipo, motivo)` prepara la
  rectificativa (serie `R`, `corrects_id`, `importes | anular | datos`).
- Hoy hay 1.334 facturas emitidas, todas de una sola sociedad.

### 3.6 `supplier_invoice` (factura recibida)

- Lleva `company_id`, `supplier_id`, `doc_kind` (`invoice | credit_note`),
  `corrects_invoice_id`, `match_status`, `journal_entry_id`.
- `source` (CHECK): `manual, ocr, lote, liquidacion`. Hará falta `grupo` (o
  similar) para «entra sola desde la sociedad del grupo».
- `arrival_channel` (CHECK): `subida, correo, cocina, portal`. Igual.
- El asiento de una recibida lo propone la contabilidad de compras ya
  existente (`_conta_factura_apuntar` y el vigía `s01o2-apunta-solo`).
  Hay que comprobar en la tarea 5 que una recibida sin documento ni lectura
  (`reading`, `raw_document_url` nulos) pasa por ese camino sin quedarse
  «para revisar».

### 3.7 IVA del artículo

`recipe_item.vat_category_id` → vista `vat_category_rate` (categoría →
`tax_code` del catálogo del sistema, con fechas) → `tax_rate` del sistema
(`iva_general` 21, `iva_reducido` 10, `iva_superreducido` 4, `exento` 0).
**Ya está el camino**: la línea de la factura saca su `tax_rate_id` del
artículo por esta vista, sin escribir ningún tipo a mano. Los 56 artículos de
Piri Piri tienen categoría.

## 4. Cómo se crea hoy un cliente y un proveedor que son otra sociedad de la cuenta

- **Tercero (`party`)**: es **de la cuenta**, no de la sociedad, y **uno por
  NIF**. No tiene ningún enlace con `company`: nada dice que el tercero
  «Frango Takeaway» es la sociedad Frango de esta misma cuenta.
- **Cliente**: `party_save_customer(cuenta, …)` crea el tercero (o usa el del
  mismo NIF; si ya existe, da `MISMO_NIF`), le pone el papel `customer` y su
  `customer_fiscal`. Una factura emitida copia los datos fiscales al
  `customer` (jsonb) al guardar.
- **Proveedor**: `supplier` también es **de la cuenta**, no de la sociedad. Al
  darlo de alta, el disparador `party_desde_proveedor` busca el tercero por NIF
  y le añade el papel `supplier`.
  - `related_party_kind` (CHECK): `group, joint, associate, other_related`.
    Para esto, `group`.
  - `invoicing_mode = 'delivery_note_then_invoice'`.
- **Para Piri Piri, entonces:**
  - un tercero por sociedad (mismo NIF que la sociedad);
  - Frango y Prosperidad con papel `customer` (clientes de Piripiri España);
  - Piripiri España con papel `supplier` y una ficha de `supplier`
    (proveedor de las otras dos).
  - Como `supplier` es de la cuenta, **Piripiri España se verá como proveedor
    también dentro de su propia sociedad**. Ver choque 6.3.
- Hoy no existe ninguno de los tres (0 terceros, 0 proveedores).

## 5. Qué se reutiliza y qué es nuevo

| Pieza del encargo | Se reutiliza | Es nuevo |
|---|---|---|
| 1. Tipo de ubicación | `locations`, `location_company`, `useVisibleLocations` | Columna `kind` (`local` / `obrador`, por defecto `local`), su `CHECK`, `useLocalesQueVenden`, el reparto de §2, el disparador que impide colgar cosas de vender de un obrador, la prueba que vigila la lista |
| 2. Tarifa | — | Tabla de tarifa (obrador × artículo × precio, con quién y cuándo) y tabla de regla (`tipo`: `tarifa_fija` / `coste_mas_pct`, con su `%`), y la función que da el precio de un artículo según la regla. Sin pantalla del «coste + %» |
| 3. Producir | `recipe_line` (escandallo), `recompute_location_stock_core`, `lot_code` | Tabla de producción, `produccion_consumo` / `produccion_entrada` en los dos `CHECK` de `stock_movement` y su `source_type` (`production`), la función de producir con sus avisos (sin escandallo, sin stock, sin coste), y `produccion_entrada` como entrada que mueve el coste medio |
| 4. Envío y recepción | `goods_receipt` y su línea (`doc_qty` / `qty_received` / `flagged_for_office`), `receive_goods_receipt`, el aviso a la oficina, `goods_receipt_path` | Envío (cabecera con nº de albarán, estado «en camino / recibido / con diferencias / facturado», destino) y línea (cantidad, coste del obrador, precio de tarifa congelado), salida del obrador (movimiento nuevo o `traspaso_salida`, a decidir), `source = 'obrador'` en la recepción, enlace recepción ↔ envío, decidir el tipo por sociedad (`location_company`) |
| 5. Factura del mes | `conta_venta_guardar` / `emitir` / `corregir`, series, VeriFactu, asiento, `party`, `supplier`, `_compras_casar`, `supplier_invoice_receipt`, vista `vat_category_rate` | La función que junta lo recibido del mes por sociedad que compra y crea el borrador, la recibida espejo en la otra sociedad (mismo número, base, IVA y total) y su asiento, el enlace entre las dos, y la rectificación que arrastra a la otra |
| 6. Pantallas | Marco nuevo (`docs/conta/marco.md`) | Las siete pantallas, cuando lleguen las maquetas |

## 6. Choques entre el encargo y la base (no resueltos: los decide Julio)

**6.1 Piri Piri no tiene contabilidad montada (frena la tarea 5).** Las tres
sociedades tienen 0 ejercicios, 0 cuentas del plan, 0 series, sin perfil
fiscal y sin VeriFactu. `conta_venta_guardar` exige una cuenta 7xx de la
sociedad en cada línea, y emitir necesita serie y ejercicio. ¿Se monta su
contabilidad antes (otro encargo) o se hace el contraste con una cuenta
inventada en staging que la tenga?

**6.2 Piri Piri no tiene escandallos ni costes (frena el contraste de la
tarea 3).** 56 artículos, todos materia prima, ninguno con coste, 0
escandallos. Para producir hace falta al menos un elaborado con su escandallo
y materia prima con coste en el obrador. ¿Los carga Julio, o se crean
inventados en staging para el contraste?

**6.3 `supplier` y `party` son de la cuenta, no de la sociedad.** La ficha de
proveedor «Piripiri España» la verán las tres sociedades, también la propia
Piripiri España (que se compraría a sí misma), y nada enlaza un tercero con
la sociedad de la cuenta que tiene su NIF. Propuesta: enlazar por NIF (el
tercero cuyo NIF es el de una `company` de la cuenta es «empresa del grupo»),
sin columna nueva, y que la factura del mes nunca cree una recibida en la
misma sociedad que la emite. ¿Vale, o se quiere un enlace explícito
(`party.company_id`)?

**6.4 La banda de coste puede tragarse la entrada del envío.**
`recompute_location_stock_core` ignora en silencio una entrada cuyo coste se
sale ×5 del de ficha. Si la tarifa del obrador está muy lejos del coste, la
entrada en el local no movería el coste medio y nadie lo sabría. Propuesta:
la entrada del envío no pasa por la banda (su precio no es una lectura dudosa,
es una tarifa), o el envío no se deja cerrar con un precio fuera de la banda.
¿Cuál?

**6.5 «A su coste medio» puede ser el coste de ficha.** Cuando un artículo no
tiene ninguna recepción con coste, su coste medio en el obrador es el de ficha
(`computed_cost` / `fixed_cost`), no uno real. El encargo dice «no se inventa
coste». ¿Producir acepta el coste de ficha como coste medio, o exige que la
materia prima tenga entradas con coste en el obrador?

**6.6 La recepción de un traspaso interno no tiene proveedor.**
`confirm_goods_receipt` exige proveedor y nº de albarán para cerrar desde la
oficina, y el camino de factura parte del proveedor. En el traspaso interno
(Obrador → Las Tablas) no hay proveedor. Propuesta: la recepción de un envío
del obrador lleva el envío como origen; con proveedor (la sociedad del obrador)
solo si es venta entre sociedades; y el traspaso interno no pasa por el camino
de factura. ¿Vale?

**6.7 Lo pendiente de facturar se periodifica a fin de mes.**
`_compras_fin_de_mes` apunta como gasto periodificado lo recibido sin factura.
Si la factura del mes del obrador se emite el día 1 o 2 del mes siguiente, en
la sociedad que compra saldrá una periodificación y su vuelta. ¿Se factura
con fecha del último día del mes (y entonces no hay periodificación), o se
deja que periodifique?

**6.8 Con varias sociedades, una recepción sin papel se queda sin sociedad.**
`_compras_camino_calcula` pone `company_id` de la única sociedad activa; con
tres, queda nulo, y `_compras_fin_de_mes` no la ve. Es un hueco de hoy para
toda cuenta con varias sociedades, no solo del obrador. Para P01 la recepción
del envío pondría la sociedad por `location_company`. ¿Se arregla también el
caso general aquí, o se apunta para otro encargo (regla T1)?

**6.9 Staging no se puede consultar desde esta sesión.** El encargo pide
desarrollar y contrastar en staging con la cuenta Piri Piri. El MCP solo ve
producción, y en el repositorio no hay nada que siembre Piri Piri en staging.
Las pruebas SQL pueden ir en la base local (`scripts/staging/base-local.sh`)
con datos inventados, y la aplicación a staging por el workflow. Pero el
contraste final (tarea 7) necesita saber si Piri Piri existe en staging.

**Además (no frena, pero va dicho):**

- **La rama.** El encargo pide `prod/p01-obrador`. Esta sesión tiene asignada
  `claude/new-session-lv7xje` y no puede empujar a otra sin permiso. Este
  documento va en `claude/new-session-lv7xje`. Si se quiere la otra, la creo
  desde `main`.
- **Las relaciones del grupo.** Frango tiene `related_is_parent = false` con
  Piripiri España y Prosperidad `true`. No cambia nada de P01 (las dos son
  `group`), pero si Piripiri España es la dominante de las dos, la de Frango
  está mal apuntada.
- **El nombre de la tabla es `locations`**, en plural (el encargo dice
  «ubicación», sin nombre de tabla: no choca, solo para que nadie la busque
  en singular).

## 7. Consultas que demuestran lo dicho

Todas contra producción, solo lectura, filtradas por la cuenta de Piri Piri
cuando hay datos de cuenta (regla 9).

```sql
-- §1: sociedades, ubicaciones con su sociedad, relaciones, terceros, proveedores, series
with a as (select id from accounts where slug = 'piri-piri')
select 'loc', json_agg(json_build_object('name', l.name, 'billable', l.is_billable,
  'company', (select c.legal_name from location_company lc join company c on c.id = lc.company_id where lc.location_id = l.id)))
from locations l join a on a.id = l.account_id
union all select 'rel', json_agg(json_build_object('kind', r.kind, 'parent', r.related_is_parent, '3p', r.third_party_name))
from company_relation r join a on a.id = r.account_id
union all select 'party', json_agg(p.name) from party p join a on a.id = p.account_id
union all select 'supp', json_agg(s.name) from supplier s join a on a.id = s.account_id
union all select 'series', json_agg(i.code) from invoice_series i join a on a.id = i.account_id;
-- → 4 ubicaciones (las de §1), 2 relaciones group + 1 other_related, party null, supp null, series null

-- §1: artículos, escandallos, stock
select type, is_stockable, count(*), count(vat_category_id), count(nullif(computed_cost, 0))
from recipe_item where account_id = (select id from accounts where slug = 'piri-piri') group by 1, 2;
-- → raw · true · 56 · 56 · 0
select count(*) from recipe_line where account_id = (select id from accounts where slug = 'piri-piri');
-- → 0

-- §1 y 6.1: contabilidad de las tres sociedades
select c.legal_name,
  (select count(*) from fiscal_year f where f.company_id = c.id),
  (select count(*) from company_account x where x.company_id = c.id),
  (select count(*) from company_tax_profile t where t.company_id = c.id),
  (select count(*) from invoice_series s where s.company_id = c.id)
from company c where c.account_id = (select id from accounts where slug = 'piri-piri');
-- → 0 · 0 · 0 · 0 en las tres

-- §3.2 y §3.3: los CHECK que habrá que ampliar
select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
where contype = 'c' and conname in ('stock_movement_type_valid', 'stock_movement_source_valid',
  'goods_receipt_source_valid', 'customer_invoice_origin_check', 'supplier_invoice_source_check',
  'supplier_invoicing_mode_check', 'supplier_related_party_kind_check');

-- §3.1: el coste 0 de register_transfer
select prosrc ~ 'coalesce\(avg_unit_cost, 0\)' from pg_proc where proname = 'register_transfer';
-- → true

-- §2.3: funciones que leen locations (170)
select count(*) from pg_proc where pronamespace = 'public'::regnamespace
  and (prosrc ilike '%from locations%' or prosrc ilike '%join locations%'
       or prosrc ilike '%from public.locations%' or prosrc ilike '%join public.locations%');

-- §2.4: tablas con clave ajena a locations (104)
select count(distinct conrelid) from pg_constraint where contype = 'f' and confrelid = 'public.locations'::regclass;
```

## 8. Lo que queda para seguir

Con las respuestas a §6, la tarea 2 (tipo de ubicación) puede empezar sin
esperar a nada más: no depende de 6.1, 6.2 ni 6.9.
