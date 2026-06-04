# Folvy Supply — C3: factura de proveedor + three-way match + eslabón coste
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Cerrar el ciclo de compra: registrar la FACTURA del proveedor, cruzarla contra lo
recibido (albarán) y lo pedido (pedido) — three-way match — para detectar
discrepancias antes de pagar, y usarla como el eslabón que CONFIRMA el coste
(last_price) y valida el IVA contra el motor fiscal por fecha. "IA propone, humano decide".

## Concepto (estándar de compras, traducido a cocina)
THREE-WAY MATCH = cruzar 3 documentos antes de pagar:
- **Pedido** (lo que pediste) — purchase_order / purchase_order_line.
- **Recepción/albarán** (lo que llegó) — goods_receipt / goods_receipt_line (con unit_cost, qty).
- **Factura** (lo que te cobran) — NUEVO.
Folvy ya tiene los dos primeros enlazados (goods_receipt.purchase_order_id,
goods_receipt_line.purchase_order_line_id). C3 añade la factura y el cruce.

Pregunta de negocio clave que el match resuelve: **¿me cobran lo que recibí, al precio
acordado?** Discrepancias típicas: precio facturado ≠ precio del albarán; cantidad
facturada ≠ recibida; artículo facturado no recibido; IVA mal aplicado.

## RECON (estado real)
- Factura de proveedor: NO EXISTE (las tablas invoice/billing son de SaaS/Stripe, ajenas).
  → tabla NUEVA `supplier_invoice` (NO 'invoices', ya usado). Partimos de cero.
- Enlaces: goods_receipt.purchase_order_id (cab), goods_receipt_line.purchase_order_line_id (línea).
- goods_receipt_line: recipe_item_id, qty_received, qty_in_base, unit_cost, purchase_format_id.
- Motor de IVA por fecha (vat_category + vat_rate valid_from/to + vat_rate_for(cat,fecha)) — YA EXISTE.
- last_price vive en article_supplier; el ledger ya lo actualiza al confirmar recepción (C2).
- OCR de documento: la Edge Function ocr-albaran YA lee facturas (doc_type detecta
  'factura'/'albaran_factura'); REUTILIZABLE para leer la factura por foto/PDF.

## Modelo de datos (nuevo)
- `supplier_invoice` (cabecera): account_id, supplier_id, location_id, invoice_number,
  invoice_date, status (borrador|cuadrada|con_discrepancias|aprobada|pagada|anulada),
  source (manual|ocr), ai_session_id, raw_document_url,
  tax_base_total, tax_total, grand_total (declarados en la factura),
  match_status (sin_match|ok|con_diferencias), notes.
- `supplier_invoice_line`: supplier_invoice_id, recipe_item_id (nullable, casado como en recepción),
  raw_text, supplier_code, qty, unit_price, line_amount, vat_pct, vat_category_id,
  goods_receipt_line_id (nullable, el enlace al albarán que casa esta línea), map_*.
- `supplier_invoice_receipt` (N:M cabecera): una factura puede cubrir VARIOS albaranes
  (típico: factura mensual que agrupa entregas). { supplier_invoice_id, goods_receipt_id }.

## El three-way match (motor)
Por cada línea de factura, cruzar contra la(s) línea(s) de recepción del mismo artículo
(vía goods_receipt_line de los albaranes enlazados):
- **Precio:** unit_price factura vs unit_cost albarán. Si difiere > umbral (reutiliza
  supply_settings.price_alert_pct de C2.2.c) → discrepancia de precio.
- **Cantidad:** qty factura vs qty_received albarán. Diferencia → discrepancia de cantidad.
- **No recibido:** línea facturada sin recepción → discrepancia (te cobran algo que no llegó).
- **No facturado:** recibido sin facturar → informativo (pendiente de facturar).
- **IVA:** vat_pct de la factura vs vat_rate_for(categoría del artículo, invoice_date) del
  motor fiscal → si no cuadra, discrepancia de IVA (esto es la "mejora invisible" en acción).
Resultado por línea: ok / diferencia_precio / diferencia_cantidad / no_recibido / iva_no_cuadra.
Cabecera: match_status global. Validación por base imponible (Σlíneas ≈ tax_base_total),
igual que el OCR de albarán.

## Eslabón coste (qué confirma la factura)
- El ledger de C2 ya pone last_price al CONFIRMAR la recepción (precio del albarán).
- La factura es la CONFIRMACIÓN final del precio. Decisión: si la factura confirma el precio
  del albarán → nada que hacer (ya está). Si la factura CORRIGE el precio (rappel, error,
  precio pactado distinto) → al aprobar la factura, actualizar last_price al precio facturado
  (es el coste real que pagas) y recompute. Trazable: el coste real = el facturado.
- NO duplica stock: la factura NO mueve inventario (eso lo hizo la recepción). Solo ajusta coste.

## Flujo
```
Factura llega (foto/PDF o manual)
   → [OCR reutiliza ocr-albaran] lee cabecera + líneas + impuestos
   → casar cabecera: proveedor (NIF), y ENLAZAR a albarán(es) de ese proveedor sin facturar
   → casar líneas a artículos (run_mapping, igual que recepción)
   → THREE-WAY: cruzar contra recepción(es) + pedido → discrepancias por línea
   → chequeo IVA contra motor fiscal por invoice_date
   → pantalla de revisión: verde lo que cuadra, ámbar/rojo las discrepancias (precio/cantidad/IVA)
   → humano revisa y APRUEBA (o marca discrepancia para reclamar al proveedor)
   → al aprobar: si corrige precio → last_price + recompute; marca albaranes como facturados
```

## UI
- Nueva pestaña "Facturas" en Folvy Supply (junto a Pedidos / Recepciones).
- Lista de facturas con estado y match_status (cuadrada / con discrepancias).
- Detalle/revisión: cabecera + líneas con su veredicto de match (chips), panel de discrepancias,
  enlace visual a los albaranes que cubre. Botón Aprobar / Marcar discrepancia.
- Escanear factura (reutiliza ReceiptScanPanel/patrón OCR).

## Construcción por sub-tramos (encadenados, cada uno cerrable)
- **C3.1** modelo (supplier_invoice + líneas + N:M) + servicio CRUD + lista/alta manual básica.
- **C3.2** OCR de factura (reutiliza ocr-albaran) + casar cabecera (proveedor + albaranes) + líneas.
- **C3.3** motor three-way match (precio/cantidad/no-recibido/IVA) + pantalla de revisión con discrepancias.
- **C3.4** aprobación + eslabón coste (corrige last_price si procede) + marcar albaranes facturados.

## Decisiones antes de construir
1. **Una factura puede cubrir VARIOS albaranes** (N:M) — sí, es real (factura mensual). ¿Lo
   soportamos desde C3.1 (recomendado, el modelo lo prevé) o empezamos 1:1 y ampliamos? (Recomiendo N:M desde el modelo.)
2. **Factura sin pedido/sin albarán previo** (compra directa, ticket): permitir factura que
   genere su propia recepción, o exigir recepción antes. (Recomiendo: permitir, la factura puede
   crear recepción implícita — pero esto es C3 avanzado; en C3.1-3 asumimos albarán existe.)
3. **Eslabón coste:** ¿la factura SIEMPRE manda sobre el precio (corrige last_price), o solo
   avisa y el humano decide? (Recomiendo: avisa la discrepancia; al APROBAR con el precio
   facturado, actualiza — humano decide, coherente con IA-propone.)
4. **Umbral de discrepancia de precio:** reutilizar supply_settings.price_alert_pct (ya existe). (Recomiendo sí.)
5. **Pago:** ¿C3 llega hasta "aprobada" y el pago/vencimientos es otro frente (tesorería)? (Recomiendo: C3 hasta aprobada; tesorería/vencimientos = frente futuro.)

## Frentes futuros anotados
- Tesorería: vencimientos, previsión de pago, conciliación bancaria.
- Factura que crea recepción implícita (compra directa sin albarán).
- Factura electrónica EDI (INVOIC) como fuente alternativa al OCR (ver frente EDI).

## BENCHMARK (R365, líder de AP/three-way para restaurantes) — 04/06
Estándar que igualamos: OCR de factura + three-way contra pedido y recepción + enrutado
de aprobación + marca automática de discrepancias + audit log + notas de crédito/abonos.
Talón de Aquiles de R365 = nuestra grieta:
1. Es suite CONTABLE pesada (semanas de implantación, depende del plan contable). Folvy gana
   con UI que usa un cocinero. El pago de R365 (ACH/cheque) es US-céntrico; en ES es SEPA/gestoría.
2. Su match es contable (cantidad/precio/condiciones); NADIE cruza la factura contra el
   ESCANDALLO y el margen del plato. Folvy SÍ (cascadeFromItem + menu_item_economics ya existen).
3. El chequeo de IVA por fecha (motor fiscal versionado) es ventaja estructural en ES.
TRES MEJORAS para GOLEAR (no empatar), integradas en C3:
- **A) Aprobación + AUDIT LOG** (igualar R365): registro de cada decisión (quién/cuándo/qué).
  Enrutado por importe/proveedor/local = sub-tramo C3.5 (no inflar C3.1).
- **B) ESLABÓN AL MARGEN, no solo al coste** (SUPERAR a R365): al aprobar una factura que
  corrige precio, mostrar el impacto en el margen de los platos afectados (vía cascade). Único.
- **C) NOTAS DE CRÉDITO / ABONOS** en el modelo desde el día 1 (R365 las trae; un rappel mal
  gestionado es dinero real): supplier_invoice.doc_kind ('invoice' | 'credit_note'); una nota
  de crédito resta (importes en negativo) y referencia la factura/albarán que corrige.

## Decisiones CONFIRMADas (Julio, 04/06)
1. N:M factura↔albaranes desde el inicio. SÍ.
2. C3.1-3 asume que el albarán existe; factura-crea-recepción = C3 avanzado. OK.
3. Eslabón coste: avisa y al APROBAR actualiza last_price + muestra impacto en margen. OK.
4. Umbral discrepancia = supply_settings.price_alert_pct. SÍ.
5. C3 hasta "aprobada"; pago/tesorería = frente futuro. OK.
6. Aprobación simple por manager en C3.3/3.4; enrutado por reglas = C3.5. OK.

## Sub-tramos definitivos
- **C3.1** modelo (supplier_invoice con doc_kind + líneas + N:M + audit) + servicio + alta manual + lista.
- **C3.2** OCR de factura (reutiliza ocr-albaran) + casar cabecera (proveedor + albaranes) + líneas.
- **C3.3** motor three-way (precio/cantidad/no-recibido/IVA) + pantalla de revisión + aprobación simple + audit log.
- **C3.4** eslabón coste al aprobar (corrige last_price si procede) + IMPACTO EN MARGEN + marcar albaranes facturados.
- **C3.5** (mejora) enrutado de aprobación por reglas (importe/proveedor/local). Notas de crédito ya en el modelo desde C3.1.
