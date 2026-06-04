# Folvy Supply — C2.2.a-2: materializar la recepción desde el OCR
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Convertir "lo que leyó la IA" (a-1) en una **recepción real en borrador**, con
proveedor y local ya propuestos, y abrir el **GoodsReceiptForm** (anti-error de C2)
en un nuevo modo "propuesta OCR" para que el humano revise, ajuste lo real y confirme.
IA propone, humano decide. En a-2 las líneas aún NO se casan con artículos (eso es b):
entran como texto leído + cantidad + precio, listas para casar en la siguiente capa.

## Lo aprendido en RECON (manda sobre cualquier suposición)
- **Proveedor comercial ≠ quien entrega.** Joan/Bidfood entregan EN NOMBRE DE Cloudtown
  Brands; el proveedor real (a quien se paga, contra quien va el coste/histórico) es
  **Cloudtown**. El OCR ya extrae `supplier_name` (quien emite) y `bill_to_name` (a quién
  se factura). Regla: si `bill_to_name` ≠ `supplier_name` y bill_to parece una empresa
  proveedora, el **proveedor comercial = bill_to**; `supplier_name` se guarda como
  **"entregado por"** (trazabilidad, decisión de Julio: guardarlo).
- **Local: casar por DIRECCIÓN, no por nombre.** Los nombres del albarán no coinciden con
  los de Folvy ("Costa Verde" del albarán = "Plaza Castilla" en Cañaveral 75). La dirección
  /CP es el ancla; el nombre, pista secundaria.
- **Proveedores existentes:** solo MAKRO (NIF A28647451). Europastry, Cloudtown, etc. → se
  crearán en b (create-on-scan). En a-2, si no casa, se deja sin proveedor y el humano elige
  /crea en el form (el form ya permite elegir proveedor).

## Cambios de esquema (mínimos)
- `goods_receipt.delivered_by text` — "entregado por" (Joan/Bidfood), informativo/trazabilidad.
- `goods_receipt.ai_session_id uuid` (FK a goods_receipt_ai_session) — enlaza la recepción con
  la lectura IA que la originó (para auditoría y para que b sepa de qué sesión vienen las líneas).
- (Ya existen: source, raw_document_url, ai_confidence, needs_review en goods_receipt;
  raw_text, map_* en goods_receipt_line.)

## Casado de cabecera (en el cliente, al pulsar "Crear recepción")
1. **Proveedor:**
   - comercial = `bill_to_name` si difiere de `supplier_name`; si no, `supplier_name`.
   - casar contra `supplier`: por **NIF** (supplier_tax_id) → por nombre normalizado → nada.
   - match → supplierId; sin match → null (el form pedirá elegir/crear).
   - `delivered_by` = `supplier_name` cuando difiere del comercial (Joan/Bidfood); si no, null.
2. **Local:** casar contra `locations` por **dirección/CP** (normalizada) → por nombre → nada.
   match → locationId; sin match → el form pide elegir (y conecta con "local activo de sesión").
3. **supplierDocNumber** = `doc_number`; **receiptDate** = `doc_date`.

## Flujo
```
ReceiptScanPanel (a-1)  → resultado OCR en pantalla
   │  [nuevo botón "Crear recepción desde esto"]
   ▼
resolveReceiptHeader(result)  → { supplierId?, deliveredBy?, locationId?, supplierDoc, date }
   │  (casado proveedor por bill_to/NIF/nombre + local por dirección)
   ▼
GoodsReceiptForm  modo 'ocr'  (nuevo prefill OcrPrefill):
   · cabecera precargada (proveedor/local propuestos, editables; avisos si no casó)
   · líneas = las leídas (raw_text, cantidad, precio_neto, lote, caducidad) en la tabla
     anti-error, celda "Recibido" PRECARGADA con la cantidad leída PERO editable
     (excepción consciente al "celda vacía": el OCR ya contó; el humano corrige, no recuenta
      desde cero — y el resumen anti-error sigue avisando de descuadres).
   · cada línea SIN casar a artículo todavía → entran como needs_review (map en b).
   · source='ocr', ai_session_id, raw_document_url (1ª imagen), delivered_by.
   ▼
Humano revisa (con la foto al lado, a-1) → ajusta → "Revisar y confirmar" (resumen C2) → confirma.
   ▼
createGoodsReceipt(source='ocr', ...) + líneas. Estado borrador → al confirmar, ledger (C2).
```

## Decisión de diseño: ¿celda "Recibido" precargada o vacía en modo OCR?
- En C2 manual/contra-pedido la celda NACE VACÍA (anti confirmation-bias: que el humano cuente).
- En modo OCR, **la IA ya leyó la cantidad del albarán**. Precargarla NO es confirmation bias
  del pedido (es lo que pone el papel que tienes delante), y vaciarla obligaría a teclear 24
  cantidades que ya están leídas → absurdo. **Se precarga con lo leído, editable.** El resumen
  anti-error sigue actuando (de más/menos/sin tocar vs lo del albarán). Es coherente: el blind
  receiving evita aceptar "lo pedido" sin mirar; aquí no hay pedido, hay el albarán real leído.
  (Si el cliente quiere blind-count contra OCR, es una opción futura, no el caso base.)

## Lo que NO entra en a-2 (frentes anotados)
- **Casado de líneas a artículos** (supplier_code → mapping_proposal → fuzzy → create-on-scan):
  es **b**. En a-2 las líneas quedan como texto leído, needs_review.
- **Crear proveedor/local al vuelo:** parcialmente — el form ya deja elegir proveedor; crear
  proveedor nuevo desde el OCR es **b** (create-on-scan). En a-2, si Cloudtown no existe, el
  humano lo crea por el flujo normal de proveedores o lo dejamos para b.
- **Liquidación con cedente (Cloudtown): comisiones − compras + escandallo.** Frente propio.
- **Multi-rol / portal trabajador / avisos.** Frente propio (ya anotado).

## Ficheros que tocaré en a-2 (los pediré juntos al construir)
- SQL: `goods_receipt.delivered_by`, `goods_receipt.ai_session_id` + regenerar database.ts.
- `goodsReceiptService.ts`: `resolveReceiptHeader()` (casado proveedor/local) + aceptar
  delivered_by/ai_session_id en createGoodsReceipt + tipos.
- `GoodsReceiptForm.tsx`: nuevo modo `ocrPrefill` (cabecera + líneas leídas, celda precargada).
- `ReceiptScanPanel.tsx`: botón "Crear recepción desde esto" → resuelve cabecera → abre el form.
- `GoodsReceiptsPage.tsx`: pasar del scan al form en modo OCR.

## Decisiones que necesito antes de construir
1. **Celda "Recibido" precargada en modo OCR** (recomendado) vs vacía. (Recomiendo precargada.)
2. **Crear proveedor/local al vuelo en a-2** o dejarlo entero para b. (Recomiendo: a-2 propone y
   permite elegir existente; CREAR nuevo proveedor/artículo = b, para no abrir media tubería.)
3. **delivered_by**: confirmado que se guarda (ya decidido). ¿A nivel de recepción (cabecera)
   basta, o lo quieres también por línea? (Recomiendo cabecera: un albarán = un transportista.)
