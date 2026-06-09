# Folvy — Guion vivo (qué hacer, por impacto comercial)

> **Última actualización**: 9 jun 2026 (CIERRE — consumo teórico vivo + identidad del recast jubilada + `reprocess_sale` unificado + capa 4 de fiabilidad verificada). Tarde 09/06: bug del router F5 corregido + crear plato desde venta huérfana (3bc2705). **FRENTE NUEVO PRIORITARIO: recepción usable y fiable** (Julio paró de cargar albaranes).
> **Regla de oro**: el frente activo es el primero de "AHORA". Al cerrarlo, se mueve a "HECHO" y sube el siguiente.
> **Antes de abrir CUALQUIER frente: `conversation_search` del tema PRIMERO** (lección 08/06: el frente de modificadores ya estaba diseñado/benchmarkeado el 05/06 y se redescubrió a base de rodeos por no consultarlo; lección 09/06: la "capa 4" ya estaba construida y commiteada el 08/06 — el guion la marcaba como pendiente). Luego RECON contra fuente primaria (BBDD+repo+dumps) y **AUDITORÍA TSPOON** (`tspoon_dump/`), nunca contra este guion.

---

## AHORA (el frente activo y los 2-3 siguientes)

### 1. 🔴 Recepción usable y fiable (validado en uso real 09/06 — Julio paró de cargar albaranes)
El flujo de recepción de albaranes NO da seguridad en la práctica. Palabras de Julio: "los formatos no casan; falta ver la foto del albarán mientras corrijo cantidades; del 3º-4º ya ni miraba; un trabajador comete error seguro." **RECON del código YA hecho**: `GoodsReceiptForm` ya tiene formato manual, conversión, blind-receiving y resumen pre-confirmación — el problema es que el CONJUNTO no transmite seguridad. **Tres huecos a resolver JUNTOS**: (1) conversión de formatos robusta y clara; (2) foto del albarán visible junto a la tabla al editar (tspoon TAMPOCO la muestra = gol Folvy); (3) bloqueo de confirmación si Σlíneas ≠ total del albarán (tspoon solo avisa = gol Folvy). **Segundo frente acoplado**: navegabilidad/uso móvil del trabajador (foto no visible en móvil = deuda responsive; recepción fuera del portal del trabajador; permisos por decidir; idea: portal en dos bloques — personal / procesos de trabajo).
- **PRIMER PASO (no rediseñar a ciegas)**: completar el benchmark profundo — auditoría documentada de `tspoon_dump/` + R365/MarketMan/xtraCHEF + las 3 capturas de tspoon ya analizadas (selector de formato con precio-por-unidad; "Esperado" siempre visible; cámara abajo pero sin foto al lado). **NO rediseñar hasta RECON+benchmark completos y diseño aprobado.**

### 2. 🔴 Cobertura de escandallos (food cost ciego en buena parte de la carta)
El diagnóstico del 09/06 (al cerrar el recosteo) lo destapó con datos duros sobre las 349 líneas product de Folvy Interno: solo **186 tienen coste**. El resto es food cost ciego, repartido en:
- **138 líneas sin escandallo** (118 casadas a plato sin receta con coste + 20 `no_recipe`): platos cascarón. Falta **escandallo** (Kitchen / Pamela).
- **17 líneas de reventa sin precio de compra** (Fanta, Agua 50cl, Tarta 3 Leches…): el `recipe_item` está clasificado como raw vendible, pero `fixed_cost` NULL → coste 0 correcto pero ciego. Falta **cargar el precio de compra** (ficha de ingrediente / OCR factura).
- **2 líneas** con menu_item sin recipe_item: falta **mapeo**.
- (6 combos con coste >0 y receta-padre sin coste = correcto, coste por componentes. No tocar.)
- **Por qué lidera**: el motor de coste, el consumo teórico (ya vivo) y el AvT están sanos, pero solo dan la verdad sobre el 53% del dinero con receta. Subir cobertura es lo que hace el food cost de Llorente29 REAL, no parcial. Es trabajo mixto: escandallos (datos, Pamela) + precios de reventa (datos) + algún mapeo. **Antes de abrir: decidir si es un frente de PRODUCTO (pantalla que lista "platos vendidos sin escandallo" por € y guía a crearlos) o de DATOS (poblar a mano). La pantalla de excepciones (`SalesExceptionsPage`) ya muestra parte de esto.**

### 3. 🟢 Limpieza de catálogo (eliminar/fusionar proveedores e ingredientes)
611 ingredientes muertos, proveedores duplicados/[Copia]. Dolor masivo, producto para cualquier cliente. RECON propio antes de tocar.

### 4. 🟠 Entrega B de la pantalla de excepciones — ACCIONES de resolver (verificar si está hecha)
La Entrega A (señal + vista read-only de excepciones) está commiteada. La Entrega B (botones link/ignore/delist + clasificar producto: resale/dish/combo) tiene las RPC en BBDD (`resolve_unmapped_sales`, `classify_unmapped_product`) — **pero hay que verificar si la UI las cablea o `SalesExceptionsPage` sigue read-only**. Si está read-only, este es el remate: conectar las acciones. Encaja con el frente 1 (resolver ciegos es subir cobertura).
> **Nota 09/06**: tras jubilar la identidad del recast, esas dos RPC siguen llamando a `recast_lastapp_sales` (que ahora recasa por el canónico vía `reprocess_sale`). Funciona, pero su patrón "recasa toda la cuenta" es más caro de lo necesario; cuando se toque, valorar que re-adapten solo las ventas del producto resuelto (deuda menor, no urgente).

---

## SIGUIENTE (cuando se libere lo de AHORA)

### 5. 🔴 Capas 5-7 del subsistema de fiabilidad (impacto + alarmas)
La señal central (capa 4) está VIVA y verificada. Faltan las capas que actúan sobre ella, y dependen de inventario perpetuo cerrado:
- **Capa 5 — impacto en stock**: merma fantasma calculable (las `no_menu_item`, hoy 0 €) + consumo desconocido (las `no_recipe`). Diseño en `docs/folvy_fiabilidad_casado_diseno.md`.
- **Capas 6-7 — alarmas y avisos**: producto nuevo vendiéndose sin receta; % ciego sobre umbral (campana manager + email); avisos en inventario y compras proporcionales a `pedido.origin` (manual no alarma; To-Par/MRP sí).
- **3 decisiones abiertas**: umbral ventas-ciegas (configurable vs fijo); alarma producto-nuevo (tiempo real vs cierre de servicio); impacto en stock (€ vs % merma).

### 6. 🔴 Inventario perpetuo capa 2 — conteo real cierra el AvT
El consumo teórico ya está vivo (ventas × escandallo → `stock_movement` tipo `consumo`, pestaña Consumo en Supply/Inventario). El AvT completo = consumo teórico − **conteo real** = merma. La capa 1 de inventario (crear→contar ciego→cerrar→aprobar→ajuste) está hecha. Falta el bucle que cruza ambos y materializa la merma con su efecto económico. Habilita el **autoinventario IA** (cycle counting: contar 3-5 productos/día, la IA elige qué y quién, analiza diferencias). Diferenciador: nadie en hostelería cierra este bucle.

### 7. 🟢 Sidebar "Modificadores por revisar" (repaso global G3)
Lista todos los modificadores sin impacto de todos los platos, ordenados por dinero, + "sugerir para todo". Reutiliza la tarjeta de la pestaña. Disparador: cuando haya volumen real (escandallos poblados). La pestaña por plato YA está (uso contextual); esto es el barrido global.

### 8. 🟢 Unidades de uso amigables + renombrar formatos confusos ("Uni" → "Bote 200 g")
Gestos de cocina ("1 papel", "1 loncha", "1 cazo"); el cocinero nunca escribe gramos. Cada artículo define SUS unidades de uso (etiqueta+factor) sobre `recipe_item_unit_conversion`. RECON propio.

### 9. 🔴 Migración Llorente29 (poblar la cuenta real desde Folvy Interno)
Paso físico hacia producción. Todo el trabajo vive en Folvy Interno (00000000-…-0001); Llorente29 (51ad1792-…) vacío hasta migrar.

### 10. 🟠 Pulido de demo
Responsive/móvil (permiso App.tsx), www.folvy.app DNS, editar perfil propio.

---

## DEUDAS TÉCNICAS (⚪ anotadas, con disparador)

- **Scripts con expectativas obsoletas** (09/06): `recast-sales.mjs` y `check-reliability.mjs` comparan contra números hardcodeados del 08/06 (pre-canónico) → disparan ⚠️ FALSAS. Actualizar a los valores canónicos actuales: recast 329 casadas/20 no_recipe/0 no_menu_item/0 ambiguous; reliability 95,02 % / 5.979,40 € casado / 6.293 € total / 313,60 € no_recipe.
- **Drift SQL en raíz**: `format_price_per_base.sql` y `supplier_format_prices.sql` sueltos en la raíz del repo → mover a `supabase/migrations/`.
- **`reprocess_sale` y el webhook**: el webhook costea+consume inline (funciona). Cuando entre el 2º TPV (Otter), migrar el webhook a `reprocess_sale` para una sola verdad del post-proceso de frontera. Blindar también `comboProducts` null en `adapt_lastapp_order` (`COALESCE(jsonb_typeof(...)='array' AND ..., false)`).
- **`location_economics.food_cost_coverage_pct`**: se arregló (mig 1300, base total honesta) — verificar que no quedó base casado-only en algún consumidor.
- **`qty_in_base` server-side**; almacén/ubicación operativa por contexto de sesión (no selector manual); `code-splitting` (chunk >500 KB, warning no bloqueante); poblar escandallos base (= frente de cobertura, hoy nº2).
- **Combos**: mensaje rojo feo "revisa el mapeo" en la vista de combos → pulir copy/estado (09/06).

---

## HECHO (para no repetir ni olvidar lo ganado)

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
- HECHO **BUG ROUTER F5 + CREAR PLATO DESDE VENTA HUÉRFANA (09/06 tarde):** `isShellRoute` obsoleto en `routes.ts` hacía que F5/recarga expulsara a Inicio en toda la app → corregido. `create_dish_from_unmapped` + `ConfirmDialog` Folvy + navegación a la ficha del plato recién creado. Commit 3bc2705.
- HECHO Folvy AI v1++ (streaming, ve 3 módulos).
- HECHO APPCC (corrección + foto + notificación) — diferenciador.
- HECHO Supply: pedido sobre catálogo (3 modos, multi-local, PDF, PED-correlativo). Recepción C2.2 OCR. C3 factura + three-way (pendiente probar vivo).
- HECHO Motor de IVA versionado por fecha.
- HECHO Inventario perpetuo capa 1 (crear→contar ciego→cerrar→aprobar→ajuste).
- HECHO Web pública folvy.app (7 páginas EN/ES).
- HECHO Auditoría competitiva (tspoon a fondo + mapa competitivo mundial).

---

## Regla de oro del guion
**No empieces una sesión preguntándote qué hacer. Abre este documento: el frente 1 de AHORA es lo que toca.** Si algo cambió las prioridades, se reordena aquí — siempre con la pregunta: *¿qué acerca más a Llorente29 en producción, que es lo que dispara las ventas?*
