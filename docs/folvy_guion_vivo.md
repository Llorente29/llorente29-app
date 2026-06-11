# Folvy — Guion vivo (qué hacer, por impacto comercial)

> **Última actualización**: 10 jun 2026 (CIERRE — AUTOINVENTARIO IA A1+A2 EN PRODUCCIÓN (cola priorizada por valor+rotación+riesgo, cobertura de valor, criticidad operativa override; commits autoinventory_queue + 94719c6). ONBOARDING INTEGRACIONES Last.app como herramienta interna en ficha de cliente (alta + vincular tiendas + importar catálogo + sembrar/recasar; commits d7ebc7a, 0347bb0). DIAGNÓSTICO MAYOR: la fiabilidad del casado de ventas es ~87% y el frente CTB destapó que el problema es de ENFOQUE, no de bug → diseñada la INGESTA CANÓNICA (`docs/folvy_ingesta_canonica_diseno.md`): Folvy es la verdad del catálogo, los TPV/plataformas son adaptadores reconciliados por id estable, cola de excepciones = 100%; 8 decisiones cerradas. ESTRATEGIA DELIVERY resuelta tras research a fondo (`docs/folvy_estrategia_delivery.md`): Otter es el candidato líder (Glovo España + no compite + API de partner camuflable); correo de partnership ENVIADO. Glovo directo: en cola de la DH API. Lo anterior 9/06: recepción espejo del albarán, pendiente validar.)
> **Regla de oro**: el frente activo es el primero de "AHORA". Al cerrarlo, se mueve a "HECHO" y sube el siguiente.
> **Antes de abrir CUALQUIER frente: `conversation_search` del tema PRIMERO** (lección 08/06: el frente de modificadores ya estaba diseñado/benchmarkeado el 05/06 y se redescubrió a base de rodeos por no consultarlo; lección 09/06: la "capa 4" ya estaba construida y commiteada el 08/06 — el guion la marcaba como pendiente). Luego RECON contra fuente primaria (BBDD+repo+dumps) y **AUDITORÍA TSPOON** (`tspoon_dump/`), nunca contra este guion.

---

## AHORA (el frente activo y los 2-3 siguientes)

### 0. ⏳ CHECKPOINT (10/06): validar la RECEPCIÓN espejo del albarán con varios albaranes
Construida la noche del 9/06 (espejo del albarán + árbol de formatos `ensurePackTree` + tarjeta rediseñada con jerarquía: nombre protagonista, "el albarán dice" agrupado, formato en una línea con pack real, recibido a ciegas con "→ X al almacén", foto del albarán a la izquierda, rojo+motivo si no cuadra). Commits `5230ff4..62a225e`, build verde. **Julio no está del todo convencido y la probará recepcionando varios albaranes reales en Folvy Interno.** Validar: (a) la tarjeta se lee clara; (b) al "ajustar como el albarán", `ensurePackTree` crea el nodo interior contable + la Caja (`qty_per_parent`, `qty_in_base` derivado) sin mover coste; (c) "→ X al almacén" refleja lo que entra. **Si cuadra → recepción a HECHO; si no → ajustar tarjeta/parser/árbol.** Solo entonces seguir con el frente 1.

### 0.bis 🔴 DELIVERY PROPIO + INGESTA CANÓNICA (decisión estratégica mayor del 10/06)
**Dos caras del mismo frente** (diseño cerrado, construcción pendiente; docs `folvy_ingesta_canonica_diseno.md` + `folvy_estrategia_delivery.md`):
- **El porqué (Julio, urgente, no a medio plazo):** Llorente29 quiere DEJAR Last (>600€ solo por integración, caro); riesgo competitivo real de que otro SaaS ofrezca "delivery integrado incluido" y se lleve al cliente. La integración propia de delivery es DEFENSA a corto plazo + argumento de venta + retención ("todo en Folvy = difícil que se vaya"). Glovo es INNEGOCIABLE (>50% de pedidos en España).
- **La estrategia (research a fondo 10/06):** el mercado obliga a elegir — quien tiene Glovo España compite contigo (Deliverect, GrubTech, Ordatic-bajo-GrubTech) o no lo tiene (HubRise, KitchenHub). **Otter rompe el patrón**: tiene Glovo España (verificado con pantalla de conexión real), NO compite (Otter=delivery, Folvy=cocina/coste/MRP), y tiene API de partner completa (Orders/Menus/Finance/Reports) camuflable bajo Folvy. **Correo de partnership ENVIADO** (esperando respuesta: modelo reseller white-label, economía, acceso API a cuentas, cobertura ES). Glovo directo (DH API) en cola sin fecha como destino a largo plazo. HubRise (Uber+JustEat, sin Glovo ES) como alternativa parcial.
- **La arquitectura (cómo encaja):** cualquier proveedor (Otter, Last, Glovo directo) entra como ADAPTADOR (`external_source`) sobre el núcleo canónico. **Folvy es la verdad del catálogo** (propias: Folvy manda; cedidas: Folvy espeja sin tocar pero costea). Casado por id estable (`organizationProductId`); lo no reconocido → cola de excepciones = 100% de fiabilidad. Catálogo vivo vía `catalog:updated`. El RECON demostró que el 70% ya existe (`menu_item.external_id/external_source`, `sale_line`, `recipe_item`↔`menu_item`↔`override`).
- **Próximo movimiento:** esperar respuesta de Otter → si encaja, estudiar su OpenAPI Reference y construir el adaptador `otter`. En paralelo, completar matrículas externas faltantes (87 menu_items sin `external_id`) y cerrar la cola de excepciones.

### 1. 🔴 Cobertura de escandallos (food cost ciego en buena parte de la carta)
El diagnóstico del 09/06 (al cerrar el recosteo) lo destapó con datos duros sobre las 349 líneas product de Folvy Interno: solo **186 tienen coste**. El resto es food cost ciego, repartido en:
- **138 líneas sin escandallo** (118 casadas a plato sin receta con coste + 20 `no_recipe`): platos cascarón. Falta **escandallo** (Kitchen / Pamela).
- **17 líneas de reventa sin precio de compra** (Fanta, Agua 50cl, Tarta 3 Leches…): el `recipe_item` está clasificado como raw vendible, pero `fixed_cost` NULL → coste 0 correcto pero ciego. Falta **cargar el precio de compra** (ficha de ingrediente / OCR factura).
- **2 líneas** con menu_item sin recipe_item: falta **mapeo**.
- (6 combos con coste >0 y receta-padre sin coste = correcto, coste por componentes. No tocar.)
- **Por qué lidera**: el motor de coste, el consumo teórico (ya vivo) y el AvT están sanos, pero solo dan la verdad sobre el 53% del dinero con receta. Subir cobertura es lo que hace el food cost de Llorente29 REAL, no parcial. Es trabajo mixto: escandallos (datos, Pamela) + precios de reventa (datos) + algún mapeo. **Antes de abrir: decidir si es un frente de PRODUCTO (pantalla que lista "platos vendidos sin escandallo" por € y guía a crearlos) o de DATOS (poblar a mano). La pantalla de excepciones (`SalesExceptionsPage`) ya muestra parte de esto.**

### 2. 🟢 Limpieza de catálogo (eliminar/fusionar proveedores e ingredientes)
611 ingredientes muertos, proveedores duplicados/[Copia]. Dolor masivo, producto para cualquier cliente. RECON propio antes de tocar.

### 3. 🟠 Entrega B de la pantalla de excepciones — ACCIONES de resolver (verificar si está hecha)
La Entrega A (señal + vista read-only de excepciones) está commiteada. La Entrega B (botones link/ignore/delist + clasificar producto: resale/dish/combo) tiene las RPC en BBDD (`resolve_unmapped_sales`, `classify_unmapped_product`) — **pero hay que verificar si la UI las cablea o `SalesExceptionsPage` sigue read-only**. Si está read-only, este es el remate: conectar las acciones. Encaja con el frente 1 (resolver ciegos es subir cobertura).
> **Nota 09/06**: tras jubilar la identidad del recast, esas dos RPC siguen llamando a `recast_lastapp_sales` (que ahora recasa por el canónico vía `reprocess_sale`). Funciona, pero su patrón "recasa toda la cuenta" es más caro de lo necesario; cuando se toque, valorar que re-adapten solo las ventas del producto resuelto (deuda menor, no urgente).

---

## SIGUIENTE (cuando se libere lo de AHORA)

### 4. 🔴 Capas 5-7 del subsistema de fiabilidad (impacto + alarmas)
La señal central (capa 4) está VIVA y verificada. Faltan las capas que actúan sobre ella, y dependen de inventario perpetuo cerrado:
- **Capa 5 — impacto en stock**: merma fantasma calculable (las `no_menu_item`, hoy 0 €) + consumo desconocido (las `no_recipe`). Diseño en `docs/folvy_fiabilidad_casado_diseno.md`.
- **Capas 6-7 — alarmas y avisos**: producto nuevo vendiéndose sin receta; % ciego sobre umbral (campana manager + email); avisos en inventario y compras proporcionales a `pedido.origin` (manual no alarma; To-Par/MRP sí).
- **3 decisiones abiertas**: umbral ventas-ciegas (configurable vs fijo); alarma producto-nuevo (tiempo real vs cierre de servicio); impacto en stock (€ vs % merma).

### 5. 🔴 Inventario perpetuo capa 2 — conteo real cierra el AvT
El consumo teórico ya está vivo (ventas × escandallo → `stock_movement` tipo `consumo`, pestaña Consumo en Supply/Inventario). El AvT completo = consumo teórico − **conteo real** = merma. La capa 1 de inventario (crear→contar ciego→cerrar→aprobar→ajuste) está hecha. Falta el bucle que cruza ambos y materializa la merma con su efecto económico. Habilita el **autoinventario IA** (cycle counting: contar 3-5 productos/día, la IA elige qué y quién, analiza diferencias). Diferenciador: nadie en hostelería cierra este bucle.

### 6. 🟢 Sidebar "Modificadores por revisar" (repaso global G3)
Lista todos los modificadores sin impacto de todos los platos, ordenados por dinero, + "sugerir para todo". Reutiliza la tarjeta de la pestaña. Disparador: cuando haya volumen real (escandallos poblados). La pestaña por plato YA está (uso contextual); esto es el barrido global.

### 7. 🟢 Unidades de uso amigables + renombrar formatos confusos ("Uni" → "Bote 200 g")
Gestos de cocina ("1 papel", "1 loncha", "1 cazo"); el cocinero nunca escribe gramos. Cada artículo define SUS unidades de uso (etiqueta+factor) sobre `recipe_item_unit_conversion`. RECON propio.

### 8. 🔴 Migración Llorente29 (poblar la cuenta real desde Folvy Interno)
Paso físico hacia producción. Todo el trabajo vive en Folvy Interno (00000000-…-0001); Llorente29 (51ad1792-…) vacío hasta migrar.

### 9. 🟠 Pulido de demo
Responsive/móvil (permiso App.tsx), www.folvy.app DNS, editar perfil propio.

---

## DEUDAS TÉCNICAS (⚪ anotadas, con disparador)

- **Scripts con expectativas obsoletas** (09/06): `recast-sales.mjs` y `check-reliability.mjs` comparan contra números hardcodeados del 08/06 (pre-canónico) → disparan ⚠️ FALSAS. Actualizar a los valores canónicos actuales: recast 329 casadas/20 no_recipe/0 no_menu_item/0 ambiguous; reliability 95,02 % / 5.979,40 € casado / 6.293 € total / 313,60 € no_recipe.
- **Drift SQL en raíz**: `format_price_per_base.sql` y `supplier_format_prices.sql` sueltos en la raíz del repo → mover a `supabase/migrations/`.
- **`reprocess_sale` y el webhook**: el webhook costea+consume inline (funciona). Cuando entre el 2º TPV (Otter), migrar el webhook a `reprocess_sale` para una sola verdad del post-proceso de frontera. Blindar también `comboProducts` null en `adapt_lastapp_order` (`COALESCE(jsonb_typeof(...)='array' AND ..., false)`).
- **`location_economics.food_cost_coverage_pct`**: se arregló (mig 1300, base total honesta) — verificar que no quedó base casado-only en algún consumidor.
- **`qty_in_base` server-side**; almacén/ubicación operativa por contexto de sesión (no selector manual); `code-splitting` (chunk >500 KB, warning no bloqueante); poblar escandallos base (= frente 1).

---

## HECHO (para no repetir ni olvidar lo ganado)

- HECHO **AUTOINVENTARIO IA A1+A2 — EN PRODUCCIÓN (10/06):** motor de 2 capas. QUÉ contar = score independiente por valor (`stock_value`) + rotación (consumo €) + riesgo (varianza+merma), normalizado 0-1 por location, pesos 0.35/0.35/0.30. CUÁNTO = COBERTURA de valor en riesgo (un control: target de cobertura, defecto 80%), NO cadencia fija. Criticidad operativa = override HARD (`is_operational_critical`/`operational_min_qty`), no peso. Función `autoinventory_queue` (SECURITY DEFINER, guard admin/manager). Front: `autoinventoryService.ts` + `AutoInventorySection.tsx` + pestaña "Autoinventario" en `InventoryPage.tsx`. Verificado en vivo (Foodint Alcalá): 24 de 187 a contar, 79,2% valor cubierto; Pan Hamburguesa (#1, rota) gana a Milanesa Pollo (#2, 322€ sin rotación) → prueba el objetivo rotación-sobre-valor. Commits autoinventory_queue + 94719c6. Benchmark tspoon: tspoon NO tiene ABC/score/riesgo (conteos manuales por zona) → Folvy golea. DEUDA declarada: `build/close_inventory_count` mantienen su `abc_class` percentil (foto histórica); convergen a beber de A1 cuando esté validado en uso. **A3 (cola del día por frescura de cobertura) diseñada, NO construida** (freshness = días desde último conteo aprobado; "zona del día con trampa" por `storage_area`).
- HECHO **ONBOARDING INTEGRACIONES Last.app — herramienta interna (10/06):** sección "Integraciones Last.app" en la ficha de cliente (`CuentaDetallePage`) vía `IntegrationsSection.tsx` + `lastappIntegrationService.ts`. Orquesta: alta de integración (org + secret + tipo propia/cedida), vincular tiendas Last→locales, importar catálogo (Edge `lastapp-catalog-import`), sembrar escandallos + recasar. Resumen del import visible (productos/combos/marcas resueltas y sin resolver) en simulación e import. Commits d7ebc7a, 0347bb0. **Aprendizaje CTB (banco de pruebas):** el import de Last falla cuando el catálogo de una marca está organizado POR CANAL sin "default" (las cedidas de Cloudtown) → 0 productos con "ok". Las propias tienen "default" + variantes por canal → entran. El casado de marca depende de `lastapp_catalog_product` (que el import puebla) — sin él, `no_brand`. Esto destapó el frente de ingesta canónica.
- HECHO **DIAGNÓSTICO + DISEÑO INGESTA CANÓNICA (10/06):** fiabilidad real ~87% (426 casadas / 76 sin casar; `no_brand` 56 = cedidas). Diseñada la arquitectura "Folvy es la verdad, TPV = adaptadores reconciliados, cola de excepciones = 100%" en `docs/folvy_ingesta_canonica_diseno.md`, coronando `folvy_fiabilidad_casado_diseno.md`. 8 decisiones cerradas (regímenes propias/cedidas, tres capas artículo/presentación/matrícula, casado por id estable multi-fuente, pending_review, catálogo vivo). Contratos de Last verificados con su OpenAPI v2.0.0 (`catalog:updated` = notificación de `catalogIds[]`; línea de venta trae `organizationProductId`+`catalogProductId`+`externalId`+`locationBrandId`). Hallazgo: `locationBrandId` viene poblado en el contrato de Last pero NULL en las ventas CTB → se pierde en la ingesta; capturarlo haría el casado de marca determinista. NADA construido (diseño).
- HECHO **RESEARCH ESTRATEGIA DELIVERY (10/06):** mapa completo de proveedores en `docs/folvy_estrategia_delivery.md`. Otter = candidato líder (Glovo España verificado, no compite con Folvy, API de partner completa camuflable). Correo de partnership a Otter ENVIADO. Glovo directo (DH API) en cola sin fecha. Mapa: HubRise (limpio, sin Glovo ES), Deliverect/GrubTech/Ordatic (Glovo pero compiten), KitchenHub (sin Glovo ES), GetOrder (sin verificar).

- HECHO Folvy Kitchen (escandallos, coste a la décima, recompute cascada).
- HECHO Recipe Steps E8 (pasos enlazados a ingredientes) — diferenciador vs tspoon.
- HECHO Last.app webhook (ventas automáticas).
- HECHO Casado de ventas lastapp arreglado (07/06): cache por `brand_id|recipe_item_id`, marca vía `catalogProductId`.
- HECHO **MODELO CANÓNICO multi-TPV (08/06):** puerta única de entrada. El core NO lee formato de ningún TPV; solo el adaptador. `adapt_lastapp_order` descompone raw_products en jerarquía product/modifier/combo_item. Añadir un TPV = 1 adaptador + mapeos, CERO cambios en core. **Principio rector 5: autorización en la frontera, motor puro.**
- HECHO **MOTOR DE COSTE DE VENTA REAL (08/06):** `sale_line.computed_cost` = escandallo ± modificadores confirmados + combos (Σ componentes). Lee canónico. Coste de venta CONGELADO (margen histórico inmutable).
- HECHO **G3 MODIFICADORES — COMPLETO (08/06):** `modifier_recipe_impact` con ciclo de vida (proposed/confirmed/rejected); solo `confirmed` toca el coste (IA propone, humano decide). Pestaña en el editor, Edge `propose-modifier-impacts` (IA), latido de coste en vivo. Niveles 1-2 operativos; 3 dormido hasta histórico.
- HECHO **SUBSISTEMA DE FIABILIDAD — capa 4 SEÑAL CENTRAL (08/06, verificada 09/06):** RPC `sales_mapping_reliability(account, from, to)` con denominador HONESTO (casado / total por importe), desglose no_recipe (dinero a oscuras) vs no_menu_item (calculable) → golea a tspoon que los junta. Umbral `kitchen_settings.reliability_min_pct` (defecto 90). Front: `salesReliabilityService.ts` + `SalesExceptionsPage.tsx` + bloque en `KitchenMenuPage.tsx`. Verificado en vivo: 95,02 % verde. Identidad en el adaptador, fiabilidad lee canónico (agnóstica de TPV).
- HECHO **MOTOR DE CONSUMO TEÓRICO — VIVO (09/06):** ventas × escandallo → `stock_movement` tipo `consumo` (qty negativa, unit_cost sellado). Funciones puras: `explode_recipe_to_raws` (recursiva, parada en raw/stockable), `compute_sale_line_consumption` (gemelo de `compute_sale_line_cost`: product/combo/modifier confirmado), `recompute_sales_consumption` (frontera con guard), `recompute_location_stock_core` (puro) + wrapper. Paridad consumo==coste validada al céntimo (simple+combo). Webhook cableado (paso 4, resiliente). UI: pestaña "Consumo" en Supply/Inventario (rango + recalcular + consumo por ingrediente, € desc). Benchmark: **paridad** con R365/Crunchtime/MarketMan; borde real = teórico CON MODIFICADORES (el punto ciego del sector). Commit af85058.
- HECHO **JUBILAR IDENTIDAD DEL RECAST + `reprocess_sale` UNIFICADO (09/06):** `recast_lastapp_sales` reescrito — casa por el canónico (bucle `reprocess_sale`), ya NO lee `raw_products`; conserva la auto-propagación multimarca (pieza B) y la firma/métricas exactas (los dos llamadores `resolve_unmapped_sales`/`classify_unmapped_product` y el script siguen funcionando). `reprocess_sale(sale_id)` = post-proceso unificado de frontera (adapt + coste + consumo) con LIMPIEZA de consumo por venta ANTES de re-adaptar → arregla el consumo FÓSIL que dejaba la recreación de `sale_line` con IDs nuevos (`stock_movement.source_id` sin FK). Idempotencia demostrada (2 corridas → 1511 movimientos idéntico, 0 fósiles). La pieza B mejoró el casado (186→209 líneas con consumo). Commit 6e7f765.
- HECHO **RECOSTEO + POLÍTICA CONGELADO/VIVO (09/06):** diagnóstico demostró que NO hay ventas mal costeadas — el motor está sano; los NULL/0 son legítimos (falta escandallo o precio de reventa → frente 1). **Modelo de DOS RELOJES confirmado como decisión de producto**: `sale_line.computed_cost` CONGELADO (margen histórico, inmutable, auditable) / `recipe_item.computed_cost` VIVO (consumo, previsión, margen futuro). Son dos relojes a propósito; no se comparan como si coincidieran. El recast recostea con el coste VIVO (corrección deliberada); el flujo normal (venta entra por webhook → congela → no se vuelve a tocar) preserva el histórico. Sin código nuevo.
- HECHO Folvy AI v1++ (streaming, ve 3 módulos).
- HECHO APPCC (corrección + foto + notificación) — diferenciador.
- HECHO Supply: pedido sobre catálogo (3 modos, multi-local, PDF, PED-correlativo). Recepción C2.2 OCR. C3 factura + three-way (pendiente probar vivo). **Recepción ESPEJO DEL ALBARAN (9/06, commits `5230ff4..62a225e`): recibido a ciegas, foto del albarán a la izquierda, "el albarán dice" agrupado, formato en una línea con pack real (Caja N×interior vía `ensurePackTree`, total derivado, sin trigger en cascada), "→ X al almacén" visible, rojo+motivo si no cuadra. PENDIENTE VALIDAR con varios albaranes (checkpoint 0 de AHORA).**
- HECHO Motor de IVA versionado por fecha.
- HECHO Inventario perpetuo capa 1 (crear→contar ciego→cerrar→aprobar→ajuste).
- HECHO Web pública folvy.app (7 páginas EN/ES).
- HECHO Auditoría competitiva (tspoon a fondo + mapa competitivo mundial).

---

## Regla de oro del guion
**No empieces una sesión preguntándote qué hacer. Abre este documento: el frente 1 de AHORA es lo que toca.** Si algo cambió las prioridades, se reordena aquí — siempre con la pregunta: *¿qué acerca más a Llorente29 en producción, que es lo que dispara las ventas?*
