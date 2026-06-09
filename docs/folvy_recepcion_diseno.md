# Folvy — Diseño del frente «Recepción usable y fiable» (v2 — espejo del albarán)

> **Fecha:** 09/06/2026. **DISEÑO APROBADO** (validado con maquetas interactivas).
> **v2 REEMPLAZA al v1**: fuera el constructor de formato anidado en el muelle; entra el ESPEJO DEL ALBARÁN.
> Benchmark en `docs/folvy_recepcion_benchmark.md`. Ritual: RECON → benchmark → diseño golear aprobado → construir por tramos.

---

## 0. Giro de diseño (por qué v2)

El v1 hacía que el cocinero **modelara** el formato (árbol Caja→Bolsa→Kg) en el muelle. Con la maqueta delante, Julio: *"no lo veo claro… quisiera ver en la recepción lo mismo que veo en el albarán"*. Es la dirección correcta y más simple:

- La recepción es el **ESPEJO del albarán**: el trabajador ve y confirma lo que pone el papel.
- La conversión a stock (kg) es **trabajo silencioso de Folvy**, no del cocinero.
- El **desglose de formato NO vive en el muelle** (si alguna vez hace falta el árbol, vive en la ficha del artículo / catálogo del proveedor).

---

## 1. Principios del espejo (innegociables del frente)

- La línea muestra cada renglón **TAL CUAL el albarán**: descripción literal, cantidad, unidad, importe.
- **Recibido a ciegas**: el campo "recibido" nace **VACÍO**; la cantidad del albarán queda **en gris al lado** como referencia. (Anti sesgo de confirmación. Gol vs tspoon, que precarga y tiene "marcar todo como recibido".)
- **Diferencias en ROJO y muy visibles** (borde + texto rojo en mayúscula), **solo ante diferencia real**; si cuadra, en silencio (anti-fatiga — el dolor original "del 3º-4º ya ni miraba").
- **Conversión a stock silenciosa**: "→ a stock: X kg" lo pone Folvy. Si no lo sabe → "pendiente de formato (lo resuelve la oficina)", **sin frenar al trabajador**.
- **Ajustar para cuadrar con el albarán**: cuando el formato guardado no cuadra con lo que dice el papel, un **toque** lo corrige *tal como lo escribe el albarán* ("N ud × M unidad = total"), **NO un árbol**, y **se recuerda** por artículo×proveedor.
- **Recepción contra pedido**: el pedido es una **tercera referencia** (pediste ↔ albarán ↔ recibido).

---

## 2. Qué muestra y hace la línea (Tramo 2)

- **Descripción literal** del albarán (`raw_text`).
- **Referencia del albarán** (gris): `albarán: {doc_qty} {ud} · {doc_amount} €`.
- **Referencia del pedido** (gris, si hay pedido): `pediste: {qty_ordered}`.
- **Recibido**: campo **vacío**. Al escribir → **cuadre a dos ejes**: cantidad vs `doc_qty`, e importe (recibido × precio) vs `doc_amount` cuando el albarán está **valorado**; si no está valorado, el € se cuadra **contra el total** (decisión 09/06). Diferencia en cualquiera → **ROJO prominente**.
- **→ a stock: X kg** (conversión silenciosa). Si Folvy no la sabe, o **no cuadra con el albarán**, el enlace **"ajustar"** se **resalta** (si cuadra, "ajustar" sigue disponible pero discreto).
- **Ajustar (un toque)**: `1 {formato} = [N] ud × [M] [unidad] = total`, **prefijado con lo que leyó el OCR** del texto ("3 UD DE 2 KG"); al guardar fija el formato (`qty_in_base = N×M` en la base del artículo, sin inventar) y **se recuerda** para el proveedor. Reutiliza `createPurchaseFormat`/`updatePurchaseFormat` + `learn_from_receipt` (NO `setupNestedPurchase`).
- **Lote / caducidad visibles** (capturar + mostrar; el OCR ya los lee y la línea ya tiene los campos). La lógica **FEFO/APPCC va a su frente**.
- **Aviso de precio**: si valorado y €/ud **sube** sobre umbral vs `last_price` → aviso discreto en la línea (`priceAlertFor` ya existe).
- **Foto del albarán al lado + zoom** (lightbox reutilizado de fichas de plato).
- **Al guardar, si hay rojo**: pedir **MOTIVO** → *faltó · llegó de más · roto / mal estado · caducidad corta · ya hablado con el proveedor · otro (con nota)* → **batería de confirmación de responsabilidad** (no bloqueo duro). Se registra.

---

## 3. Esquema (Tramo 2)

- `doc_qty` / `doc_amount`: ya creados (Tramo 1). **Cablear** en `goodsReceiptService.ts` (insert + mappers) y poblar desde el OCR / a mano.
- **NUEVO**: `goods_receipt_line.discrepancy_reason` (text, null) — el motivo del descuadre al guardar.
- El "ajustar" **no necesita función de servicio nueva**: nodo de formato plano (`qty_in_base = N×M`) vía `createPurchaseFormat`, recordado por `learn_from_receipt` (ya hace upsert en `article_supplier` por artículo×proveedor con el formato).

---

## 4. Lo que se DESCARTA de v1 (deuda 0: no se queda a medias)

- **Constructor de formato anidado en el muelle** (`NestedFormatBuilder`, `setupNestedPurchase`): descartado. El desglose en árbol, si alguna vez hace falta, vive en la **ficha del artículo / catálogo del proveedor**, fuera de la recepción.

---

## 5. Plan por tramos (v2)

- **Tramo 1 — HECHO** (commit 5230ff4): `doc_qty`/`doc_amount` + `qty_in_base` server-side en `confirm_goods_receipt`.
- **Tramo 2 — AHORA: el ESPEJO completo.** Recibido a ciegas; referencias albarán + pedido; diferencias en rojo prominentes; ajustar-un-toque (siempre disponible, resaltado al detectar desajuste); foto + zoom; aviso de precio; lote/caducidad visibles; motivo + confirmación de responsabilidad al guardar. + columna `discrepancy_reason`.
- **Tramo 3 — Detección de pedido (b)** desde escaneo suelto ("esto parece PED-00012, ¿lo vinculo?") + cuadre fino a tres ejes.
- **Frentes APARTE (declarados, NO en este frente):** FEFO + trazabilidad de lote; APPCC en recepción (temperatura/rechazo de línea); recepción desde el **portal del trabajador** (móvil, permisos, circuito de validación).

---

## 6. Veredicto golea/empata (deuda 0)

- **Espejo + recibido a ciegas + rojo prominente** = GOL vs tspoon (precarga y "marcar todo como recibido" = sesgo de fábrica).
- **Ajustar-para-cuadrar-con-el-albarán + se recuerda** = GOL (nadie deja calcar el papel y aprender por proveedor).
- **Cuadre a dos/tres ejes con motivo** = más que xtraCHEF (un eje, total del documento, en oficina).
- **Foto al lado en el muelle** (no en oficina) = GOL vs líderes.
- **Conversión a stock silenciosa + pendiente-oficina si no se sabe** = no frena al trabajador (lo que rompía tspoon).

---

## 7. Decisiones registradas (09/06)

- Caducidad/lote: **capturar + mostrar ahora** (now-or-never, legal); lógica FEFO/APPCC luego.
- Recepción contra pedido: **referencia (a) ahora**; **detección (b) en Tramo 3**.
- Ajustar: **siempre disponible discreto, resaltado cuando Folvy detecta desajuste**.
- Motivos: lista cerrada (arriba) + "otro (con nota)".
- Referencia del € cuando el albarán no está valorado: **contra el total** (reversible).
