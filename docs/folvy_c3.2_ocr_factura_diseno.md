# Folvy Supply — C3.2: OCR de factura
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Escanear la factura del proveedor (foto/PDF) y prerellenar el alta de factura:
cabecera (proveedor + albaranes que cubre) + líneas casadas a artículos. Quita el
tecleo. Antes del three-way (C3.3). Máxima reutilización de C2.2.

## Qué se reutiliza TAL CUAL (no se reconstruye)
- `scanReceipt(accountId, files)` → sube a receipt-uploads, llama a la Edge Function
  `ocr-albaran` (que YA detecta doc_type 'factura'/'albaran_factura'), crea la sesión IA
  y devuelve OcrAlbaranResult (document + lines + validation). Es genérica, no atada a recepción.
- `matchReceiptLine` (run_mapping filtrado a raw) para casar cada línea a un artículo.
- El patrón visual de ReceiptScanPanel (cámara/archivo, visor, validación por base).

## Lo nuevo (fino)
- **InvoiceScanPanel** (clon ligero de ReceiptScanPanel): mismo escaneo y visor, pero el
  botón final es "Crear factura desde esto" → arma un InvoiceOcrPrefill y abre el alta de
  factura (no la recepción).
- **resolveInvoiceHeader(accountId, doc)** en supplierInvoiceService:
  · proveedor = EMISOR por NIF→nombre (reutiliza la misma lógica que la recepción; si hay
    `supplier_alias` lo respeta — un intermediario que factura en nombre de otro).
  · albaranes sugeridos: los goods_receipt CONFIRMADOS de ese proveedor SIN factura todavía
    (no enlazados en supplier_invoice_receipt) → se proponen marcados para enlazar (N:M).
  · totales (tax_base/total/grand) de la cabecera leída.
- **InvoiceOcrPrefill**: { aiSessionId, supplierId, proposedSupplierName/Nif, locationId,
  invoiceNumber (doc_number), invoiceDate, docKind ('invoice' por defecto; el humano puede
  marcar abono), rawDocumentUrl, taxBase/taxTotal/grandTotal, receiptIds sugeridos, lines }.
  lines = { recipeItemId:null (se casa en el alta), rawText, supplierCode, qty, unitPrice,
            lineAmount, vatPct, lotCode/expiry no aplican a factura }.
- **SupplierInvoicesPage**: aceptar un prefill OCR → abre el form de alta con cabecera,
  totales, albaranes y líneas precargados (editable). Casado de líneas con LineMatchPicker
  (el mismo de recepción). Source='ocr', ai_session_id guardado.

## Anti-duplicado (reutiliza patrón b.5)
- Al materializar, avisar si ya existe una factura del mismo proveedor con el mismo
  invoice_number (status ≠ anulada). `findDuplicateInvoice`. No bloquea.

## Esquema
- Ninguno nuevo (supplier_invoice ya tiene source, ai_session_id, raw_document_url; el N:M existe).

## NO incluye (es C3.3)
- El three-way match (cruzar precio/cantidad/IVA contra el albarán). C3.2 solo LEE y PRERELLENA.
  El enlace goods_receipt_line_id por línea se resolverá en C3.3 (casar línea de factura ↔
  línea de albarán). En C3.2, las líneas se casan al ARTÍCULO (recipe_item), como en recepción.

## Decisiones (con recomendación)
1. Reutilizar scanReceipt tal cual (no duplicar Edge Function). (Sí.)
2. Sugerir albaranes sin facturar del proveedor, marcados para enlazar (humano ajusta). (Recomendado.)
3. docKind por defecto 'invoice'; el humano marca abono si el documento es nota de crédito. (Recomendado.)
4. Casado de línea a ARTÍCULO en C3.2; el enlace línea-a-línea-de-albarán es C3.3. (Recomendado.)
