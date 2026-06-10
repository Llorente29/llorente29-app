# Folvy — Diseño cerrado «Recepción con formato guiado» (v3)

> **Fecha:** 10/06/2026. **Estado:** DISEÑO PARA APROBAR (no tocar código hasta visto bueno de Julio).
> **v3 no reabre el espejo (v2, aprobado 09/06): lo completa** para el caso «artículo sin formato».
> Ritual cumplido: RECON (BBDD) → benchmark del mejor (dump real tspoon + líderes) → diseño para golear → MEDIR (al cerrar).

---

## 0. Por qué v3 (qué añade sobre el espejo)

El v2 (espejo del albarán: recibido a ciegas, foto a la izquierda, «→ X al almacén», rojo si no cuadra) resuelve la recepción de un artículo **cuyo formato Folvy ya conoce**. v3 añade el camino que faltaba: **qué pasa la primera vez que llega un artículo sin formato**, sin obligar al cocinero a modelar conversiones y sin frenar el muelle.

Tres piezas nuevas, todas reconciliadas con el principio «lee y confirma, jamás reconstruye»:
1. Constructor guiado **de una sola vez** por artículo×proveedor, en idioma de cocina.
2. **Unidad base obligatoria** como cierre del constructor (cierra la fuga: «240 ud» no vale si esas ud pesan).
3. **Estado estable = espejo**: en cuanto se aprende, la recepción siguiente es contar y confirmar.

---

## 1. Benchmark (cerrado contra fuente real)

### tspoon — incumbente, dump real (`71_compras_albaranes.json`, 901 albaranes, 5.892 líneas con formato)
- **Modelo de formato = DOS capas planas por línea:** compra (`quantityFormat` + `unitFormat` + `costFormat`) y stock (`quantity` + `unit` + `cost`). El factor es **implícito** (`quantity / quantityFormat`).
- Ejemplos reales: 1 Caja = 6 Kg (tomate pera), 1 Cartón = 30 Uni (huevos), 1 Paquete = 400 gr (peperoni), 1 Bote = 0,5 Kg (guacamole), 6 Bolsa = 6 Kg (mozzarella).
- **No hay capa intermedia:** «Caja 12 PAQ DE 20 UD» se aplana a «1 Caja = 240 Uni» → pierde el paquete, **no puede espejar el texto del albarán**.
- Unidades = **lista global plana (38)** con banderas de rol (`defecteFormat`=Caja, `defecteDetall`=gr, `defecte`=Kg). Contenedores y medidas mezclados en la misma lista.
- `idStore`/`store` **por línea** (cada artículo a su zona: «2.- REFRIGERADOS», «5.- SECOS»).
- `recibido` bool por línea. **No** lleva lote/caducidad.
- **No** tiene: constructor guiado, aprendizaje desde el documento, ni alarma de coste. El humano entiende y teclea la conversión.

### Líderes (web, verificado)
- **R365:** cadenas de equivalencia («Caja 4/750 ml» → «Botella 750 ml» → onzas). Su doc admite que la equivalencia de unidades es «tarea complicada». Es **setup previo** en la ficha.
- **Apicbase:** paquetes por ingrediente con banderas `is_piece`/`is_weighted`; conversión 1/1 por defecto (peligrosa, lo advierten). Setup previo.
- **NCR Aloha:** unidad de recepción = contenedor + pack + tamaño. **Oracle WMS:** muestra la cantidad estándar de caja para comparar al recibir (anti-error).
- **Ninguno** tiene constructor conversacional al recibir + aprende del documento + alarma de coste.

### Veredicto honesto
- **Árbol N-capas:** empate vs R365/NCR (ellos encadenan equivalencias); **gana vs tspoon** (plano, no espeja el albarán).
- **Constructor guiado de una vez + aprendizaje + alarma de coste + unidad base en idioma cocina:** gana vs todos. **Es el wedge.**
- **Corrección de deuda:** el mapa competitivo vende «formatos anidados» como gol absoluto. Matizar: gana vs tspoon, empata vs R365/NCR; el gol real es el *cómo* (guiado / aprende / alarma), no el tener tres capas.

---

## 2. RECON (lo que YA existe — reduce mucho el build)

- **`recipe_item_purchase_format` = árbol anidado completo, ya poblado (297 vivos).** Columnas: `parent_format_id` (auto-ref), `qty_per_parent`, `qty_in_base` (NOT NULL, derivado), `is_piece`, `is_weighted`, `source`, `ai_confidence`, `needs_review`, `is_active` + `archived_at` (soft-archive), `created_by`/`created_by_name`. Checks `ripf_no_self_parent`, `ripf_parent_same_item`. → el árbol y el «editable sin reescribir histórico» **ya caben sin tocar esquema**.
- **`article_supplier.purchase_format_id` = lo aprendido por artículo×proveedor** (UNIQUE `recipe_item_id`×`supplier_id`, con `last_price`). `trg_article_supplier_recompute_cost` recostea en INSERT/UPDATE/DELETE. `learn_from_receipt` ya upserta aquí. → «ofrecer lo aprendido el primero» ya tiene dónde vivir.
- **`is_piece`/`is_weighted`** ya distinguen pieza contable de artículo a peso (paridad con tspoon/Apicbase).
- Funciones que ya tocan esto: `ensurePackTree` (repo), `learn_from_receipt`, `confirm_goods_receipt`, `apply_invoice_costs`, `_qty_in_base`, `format_price_per_base`, `kitchen_recompute_*`.
- **RESUELTO (T0, 10/06):** la conversión base **no vive** en `recipe_item_unit_conversion` (0 filas, tabla en desuso — **no escribir ahí**). Vive en dos sitios: la **unidad base del artículo** en `recipe_item.base_unit_id` (el `recipe_item` tiene además `stock_unit_id`, `purchase_unit_id`, `current_stock_unit_id`), y **cada formato → base** en `recipe_item_purchase_format.qty_in_base`. Ejemplos reales: Carne de Birria base=g, Bolsa `qty_in_base`=2000, Caja `qty_per_parent`=3 → `qty_in_base`=6000 (árbol de 2 niveles, correcto); carne 85 g con base=ud (1 ud = 1 porción), Caja=142 ud. → **el paso «unidad base» del constructor lee/escribe `recipe_item.base_unit_id` + la hoja del árbol; el motor de coste ya lee de ahí.**
- **Nota de limpieza:** el T0 destapó **formatos duplicados** (p. ej. Carne de Birria con Bolsa/Caja repetidas) = deuda de catálogo (frente propio); deduplicar al tocar T4 (formato editable), no antes.

**Conclusión:** este frente es, sobre todo, **UI (constructor) + 2 funciones (alarma, siembra) + verificación en repo**, no una reforma de esquema.

---

## 3. Alcance cerrado (no se mueve)

1. **Espejo estable** — recepción conocida = contar y confirmar.
2. **Constructor guiado de una vez** para artículo sin formato, idioma de cocina, **caso plano resuelto en la primera pregunta** (bar de barrio = dos toques, sin árbol).
3. **Unidad base obligatoria** como paso final (ud contable, o conversión 1 ud = X g/ml si pesa). Sin unidad base resuelta, la línea **no entra a stock**.
4. **Remate en oficina sin frenar al muelle** — el trabajador cuenta y deja «pendiente de formato»; lo conocido fluye; solo la línea nueva se aparca; la oficina/usuario capaz la cierra desde la cola (con foto + conteo delante).
5. **Tres alarmas** — descuadre de total = bloqueo duro; de menos por línea = avisa; coste implausible vs `last_price` = avisa (cero falsos positivos).
6. **(Obs. Julio 1) Formato aprendido visible y editable** en la ficha del artículo; al corregir, recosteo limpio sin reescribir histórico (archivar viejo + crear nuevo; política de dos relojes). Must.
7. **(Obs. Julio 2) Siembra de formatos** desde lo ya existente (catálogo de proveedor importado, OCR, master de ingredientes), marcada con `source`/`ai_confidence`, para que el constructor solo salte en lo genuinamente desconocido y la cola de alta no se dispare.

---

## 4. Modelo de datos (decisiones)

- **Sin tabla nueva.** El constructor escribe en `recipe_item_purchase_format` (árbol vía `ensurePackTree`), con `source` ∈ {`constructor`, `seed`, `ocr`, `manual`} y `needs_review` según confianza.
- **La hoja del árbol lleva `qty_in_base` a la unidad base del `recipe_item`** (g/ml/ud del motor de coste); `is_piece`/`is_weighted` marcan el tipo. La «unidad base» del paso final del constructor = la base del item (confirmar lectura/escritura en T0).
- **Aprendido:** `article_supplier.purchase_format_id` apunta a la raíz del árbol (p. ej. la Caja). La recepción siguiente la ofrece primero (verificar en T0 que la UI ya lo lee).
- **Línea «pendiente de formato»:** `goods_receipt_line` con `purchase_format_id` NULL + marca de revisión (verificar esquema de `goods_receipt_line` en T0). No entra a stock hasta resolver; sí deja constancia de que llegó.

---

## 5. UX

### Constructor (1ª vez / oficina) — idioma de cocina
- P1: «¿En qué llega?» → En caja / En paquete suelto / Unidad suelta / A peso (kg). **El caso plano termina aquí.**
- Si caja: «¿qué trae dentro? → paquetes / unidades directas» → cantidades.
- **Paso final obligatorio: unidad base** (ud contable, o conversión si pesa).
- Vocabulario de unidades **curado** (del uso real ES, ref. dump tspoon): Caja, Bolsa, Bote, Botella, Brick, Lata, Paquete, Pack, Cartón, Saco, Garrafa, Bidón, Bandeja, Barra, Rollo, Pieza + medidas (Kg, gr, Lt, ml, cl) + gestos (Diente, Filete, Hoja, Manojo, Rama, Rebanada).
- Lectura en espejo del albarán: «1 caja = 12 paquetes × 20 ud = 240 ud», nunca aritmética para el usuario.

### Espejo (siguientes veces)
- Formato pre-rellenado; el trabajador cuenta en la capa que llega y confirma «así llegó».

### Cola de oficina
- Aviso/campana (patrón APPCC) de «artículos nuevos sin formato»; foto del albarán + conteo del trabajador delante.

### 3 alarmas
- **Total** (Σlíneas ≠ total albarán) = bloqueo duro (gol vs tspoon, que solo avisa).
- **De menos por línea** = avisa, no frena.
- **Coste implausible** (€/ud fuera de banda vs `last_price`) = avisa, pregunta «¿seguro?». Banda propuesta ×2,5 / ÷2,5; umbral configurable en `kitchen_settings`. Cero falsos positivos.

---

## 5.bis — Diseño visual (cómodo, moderno, para todos)

La misma pieza la usa un cocinero de baja formación en el móvil del muelle y un administrativo en el escritorio de la oficina. Tiene que ser **agradable y obvio para los dos**, sin parecer software técnico.

- **Móvil primero, dedos no ratón.** Objetivos táctiles grandes (≥44 px); las respuestas del constructor son tarjetas tocables, no inputs minúsculos ni desplegables densos. El muelle se opera con una mano y con prisa.
- **Calma por defecto, ruido solo ante anomalía.** Si todo cuadra, silencio visual (neutro, sin alarmas). El rojo aparece solo ante descuadre real o coste implausible. El dolor original («del 3º-4º ya ni miraba») nace de la fatiga visual: nada de avisos constantes.
- **Idioma humano, cero jerga.** «¿En qué llega?», «¿cuántos paquetes trae la caja?» — nunca «factor de conversión» ni `qty_in_base`. Las palabras del albarán, no las de la base de datos.
- **Una decisión por pantalla.** El constructor avanza paso a paso; el caso plano se cierra en una sola pregunta, el complejo revela capas solo si hacen falta.
- **Espejo literal.** Lo que se ve en Folvy = lo que se ve en el papel, lado a lado (foto del albarán a la izquierda). La confianza nace de reconocer, no de calcular.
- **Lenguaje visual Folvy coherente y actual.** Fondo crema cálido, texto azul marino, acento terracota/coral, tarjetas con jerarquía (nombre protagonista, referencias en gris), esquinas redondeadas suaves, tipografía limpia y amplia. Plano, sin sombras duras ni adornos. Debe sentirse moderno y amable, no un ERP de los 2000.
- **Accesible de verdad.** Alto contraste, texto legible en cocina (≥16 px en datos clave), estados claros (hecho / falta / qué entra al almacén) sin depender solo del color.
- **Feedback inmediato.** «→ X al almacén» y €/ud se actualizan en vivo mientras se cuenta; el formato se ve formarse en tiempo real (como en la maqueta aprobada).
- **El móvil del trabajador, en dos bloques** (idea ya anotada): «personal» (fichaje, datos) y «procesos de trabajo» (recepción, conteo, APPCC), para que recibir no se pierda dentro del portal.

Esto se aterriza en tokens y componentes al abrir T1 (con un vistazo de benchmark del *look* contra apps modernas de operaciones; la maqueta ya marca la dirección).

---

## 6. Tramos de construcción (cada uno usable por sí solo)

- **T0 — RECON puntual. HECHO (10/06).** (a) Conversión base resuelta (§2): `recipe_item.base_unit_id` + `recipe_item_purchase_format.qty_in_base`; `recipe_item_unit_conversion` en desuso. (b) `goods_receipt_line` **ya tiene todo** para «pendiente de formato»: `purchase_format_id` NULL, `qty_in_base` NULL (no entra a stock), `map_needs_review`, + campos espejo `doc_qty`/`doc_amount`/`discrepancy_reason` y ganchos `lot_code`/`expiry_date`. **Conclusión: T1–T5 NO requieren cambio de esquema.** (c) Pendiente: confirmar en repo (git grep) que la UI de recepción ya ofrece `article_supplier.purchase_format_id` primero — se cierra al abrir T1.
- **T1 — Constructor guiado (UI)** sobre `recipe_item_purchase_format` + `ensurePackTree`, con caso plano + unidad base + vocabulario de unidades.
- **T2 — Estado «pendiente de formato»** en recepción (no entra a stock) + cola de oficina + campana. Aquí se cierran las decisiones de roles (§7).
- **T3 — Alarma de coste implausible** (función sobre `last_price` + umbral configurable).
- **T4 — Formato aprendido visible/editable** en la ficha (archivar + crear, recosteo limpio).
- **T5 — Siembra** desde catálogo/OCR/master (marcar `source`/`ai_confidence`).

Orden de dependencia: T0 → T1 → T2 → T3 → T4 → T5.

---

## 7. Decisiones de Julio

**Confirmadas:**
- El trabajador cuenta y deja «pendiente de formato»; lo conocido fluye; lo pendiente no entra a stock hasta resolver.
- La oficina/usuario capaz remata el formato; se hace **una sola vez** por artículo×proveedor.

**Abiertas (a cerrar en T2):**
- Rol «oficina»: ¿solo `manager`, o un rol intermedio con permiso «resolver formatos»?
- ¿El trabajador puede confirmar él mismo las líneas de artículos **ya conocidos**, o toda la recepción queda en borrador hasta que la oficina valida?

---

## 8. Deuda declarada

- **`store`/almacén por línea** (tspoon lo tiene; Folvy no). Disparador: al construir multi-almacén por zona.
- **Corrección del mapa competitivo** (`folvy_competitive_map.md`, área Recepción): matizar el claim «formatos anidados = gol» → gana vs tspoon, empata vs R365/NCR; el gol es guiado/aprende/alarma.
