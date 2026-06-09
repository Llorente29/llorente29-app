# Folvy — Diseño del frente «Recepción usable y fiable»

> **Fecha:** 09/06/2026. **Estado: DISEÑO APROBADO por Julio.** Benchmark previo en `docs/folvy_recepcion_benchmark.md`.
> Ritual cumplido: RECON (BBDD+repo) → benchmark del mejor → diseño golear aprobado → (construir por tramos).

---

## 0. Decisiones aprobadas (09/06)

1. **Los tres huecos** del benchmark: (1) calcar el formato del albarán + contar en cualquier capa; (2) foto del albarán visible al editar; (3) cantidad + € visibles con avisos de responsabilidad a dos ejes.
2. **Dos columnas nuevas** en `goods_receipt_line`: `doc_qty` y `doc_amount` (lo que el albarán DECLARA por línea). Único cambio de modelo del frente.
3. **`qty_in_base` server-side** dentro de este frente (cierra la deuda: hoy la conversión es cliente y `confirm_goods_receipt` se fía del navegador).
4. **Referencia cuando el albarán NO está valorado:** el eje € cuadra contra el **esperado del pedido**; si es compra directa sin pedido pero el albarán trae total, contra el total del albarán. La cantidad siempre se comprueba por línea. *(Reversible si Julio lo prefiere de otra forma.)*

---

## 1. Lo que YA existe (RECON 09/06 — no reconstruir)

- **Árbol de formatos** `recipe_item_purchase_format`: `parent_format_id` + `qty_per_parent` + **`qty_in_base` cacheado por nodo** (la Caja sabe que son 6 Kg, la Bolsa 2 Kg). N capas, ya en el modelo.
- **Conversión O(1)**: `qtyInBaseFromFormat(qtyReceived, nodo.qty_in_base)` = multiplicación; lee UN nodo, no recorre el árbol. → "contar en cualquier capa" = elegir el nodo y multiplicar.
- **`setupSimplePurchase`**: alta del caso plano ("saco 25 kg") = nodo trivial + enlace a proveedor + precio + cascada de coste. Blindaje anti-invención: el service exige `qty_in_base` ya calculado, no inventa conversiones 1:1.
- **`article_supplier.purchase_format_id`**: el formato vive por artículo×proveedor. `learn_from_receipt` ya lo aprende al confirmar (código + denominación + precio + formato).
- **OCR** (`OcrLine`): ya extrae del albarán `quantity`, `line_amount` (importe), `unit_price_net`, `packages` (bultos) y la pista de formato (`format_name`/`pack_size`/`pack_unit`). `OcrDocument` trae `grand_total`/`tax_base_total`. `OcrValidation` ya cuadra Σlíneas vs total del documento.
- **`formatQtyInBaseFromPack`**: convierte la pista del OCR a base SIN inventar (dimensión incompatible → null → needs_review).
- **Foto del albarán**: ya se sube (`goods_receipt.rawDocumentUrl`, bucket `receipt-uploads`, URL firmada TTL 1h).
- **Anti-error / blind receiving**: celda «Recibido» nace vacía; pedido/pendiente = referencia gris; resumen en humano antes de confirmar.

**El gap real:** el albarán declara cantidad e importe por línea (`OcrLine.quantity`/`line_amount`), pero **NO se persisten** en `goods_receipt_line` (solo se guarda lo contado: `qty_received`/`qty_in_base`/`unit_cost`). Sin persistirlos, el cuadre a dos ejes no tiene contra qué comparar al confirmar.

---

## 2. Diseño por hueco

### Hueco 1 — Calcar el albarán + contar en cualquier capa (GOL limpio)
- **Mini-constructor anidado en la línea** ("Crear formato como viene en el albarán"): *Caja contiene 3 Bolsa · Bolsa contiene 1 Kg*. Calcula `qty_in_base` **subiendo la cadena** (Caja = 3 × Bolsa.qtyInBase) antes de insertar (el service no inventa). Guarda los nodos en el árbol con `source`/`needs_review`.
- **Helper nuevo `setupNestedPurchase`** (hermano de `setupSimplePurchase`): crea la cadena de nodos + enlaza el nodo de compra a `article_supplier` con precio → **recordado por artículo×proveedor**, ofrecido el primero la próxima vez.
- **Selector de la línea**: muestra solo los nodos de ESE artículo (Caja/Bolsa/Kg), nunca el catálogo global de 38 unidades (el ruido de tspoon). Eliges en qué capa contaste → `qty_received × nodo.qty_in_base`.
- **Bucle OCR**: OCR desglosa → propone formato (needs_review). OCR no puede → el cocinero lo calca → enseña a reconocer esa redacción del proveedor la próxima vez.

### Hueco 2 — Foto del albarán visible al editar (el visor empata; el momento golea)
- **Panel lateral** con la imagen/PDF del albarán (ya subido) mientras se corrigen las líneas; en **móvil**, toggle accesible (no el icono escondido de hoy).
- Honestidad: el visor en sí solo EMPATA con xtraCHEF/MarketMan (ellos lo enseñan en oficina). El GOL es tenerlo **en el muelle, en móvil, junto al conteo ciego** — el momento, no la foto.

### Hueco 3 — Cantidad + € visibles, avisos de responsabilidad a dos ejes (GOL)
- **Persistir** `doc_qty` + `doc_amount` (del OCR o a mano).
- **La línea muestra claro**: cantidad contada (en la capa elegida + "= X base") y € de línea (cantidad × coste), con la **referencia** al lado (albarán si valorado; si no, esperado del pedido).
- **Cuadre a dos ejes** (cantidad y €) contra la referencia. Anomalía → **aviso de responsabilidad graduado** (no bloqueo duro).
- **ANTI-FATIGA (crítico — el dolor original "del 3º-4º ya ni miraba"):** (1) avisos solo ante anomalía real, no en cada línea; (2) acto deliberado con causa (faltó/sobró/precio), no un OK pasivo; (3) lenguaje humano con nombre de producto. Si se vuelve click-through, recrea el problema que abrió el frente.
- El cuadre del total (Σlíneas vs total del documento) ya lo da `OcrValidation` → reutilizar para "si no valorado, contra el total".

---

## 3. Cambio de esquema (único del frente)

- `goods_receipt_line.doc_qty` (numeric, null) — cantidad declarada por el albarán en esa línea.
- `goods_receipt_line.doc_amount` (numeric, null) — importe declarado por el albarán en esa línea (si valorado).
- **`qty_in_base` server-side**: función SQL que calcula `qty_received × format.qty_in_base` dentro de `confirm_goods_receipt` (o helper invocado por él), para que el confirm NO se fíe del valor del navegador. RECON de la fuente viva de `confirm_goods_receipt` (pg_proc) antes de tocar.
- Regenerar `src/types/database.ts` (método seguro: a `database.new.ts`, verificar líneas/sin error, mover, UTF-8 sin BOM) en el MISMO commit que los tipos/services.

---

## 4. Plan de construcción por tramos (orden por dependencia)

- **Tramo 1 — Cimiento (BBDD + tipos):** migración con `doc_qty`/`doc_amount` + función server-side de `qty_in_base` + endurecer `confirm_goods_receipt` para que la calcule él. Regenerar `database.ts`. *(Empieza con RECON de `confirm_goods_receipt` vivo.)*
- **Tramo 2 — Hueco 1:** `setupNestedPurchase` + mini-constructor anidado en la línea + selector de capa por artículo. (purchaseFormatService.ts, GoodsReceiptForm.tsx, componente nuevo.)
- **Tramo 3 — Hueco 3:** cablear `doc_qty`/`doc_amount` (OCR + entrada manual) + cantidad/€ visibles + referencia + avisos de responsabilidad a dos ejes anti-fatiga. (GoodsReceiptForm.tsx, goodsReceiptService.ts, panel de resumen.)
- **Tramo 4 — Hueco 2:** visor de foto lateral (desktop) + toggle móvil, ligado a `rawDocumentUrl`. (GoodsReceiptForm.tsx, componente visor.)

Orden: el esquema es cimiento; el formato (hueco 1) antes que el cuadre (hueco 3) porque el € de línea depende de la capa/formato; la foto (hueco 2) al final por ser la menos acoplada (puede subir si Julio lo prefiere).

---

## 5. Veredicto golea/empata (deuda 0)

- **Hueco 1:** GOL limpio (anidado + inline + recordado por proveedor; nadie lo hace).
- **Hueco 2:** visor = EMPATE con los líderes; GOL solo por el momento (muelle/móvil/conteo ciego).
- **Hueco 3:** GOL (dos ejes + por línea + lenguaje cocina); xtraCHEF solo controla el € total del documento. El riesgo a vencer es la fatiga de avisos — resuelto por diseño anti-fatiga.
- **Diferenciador real:** unificar recepción operativa + control de factura en un solo momento, en el muelle, por el trabajador, en lenguaje de cocinero.

---

## 6. Microdecisiones resueltas / abiertas

- **Resuelta:** referencia cuando no valorado = esperado del pedido (reversible).
- **Abierta menor (en construcción):** copy exacto de los avisos de responsabilidad; orden del tramo 2 (foto) si Julio quiere verla antes.
