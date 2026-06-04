# Folvy Supply — C3.3: motor three-way match + revisión + aprobación
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
El corazón del frente: cruzar cada línea de FACTURA contra la línea de ALBARÁN del
mismo artículo (de los albaranes enlazados) y contra el PEDIDO, detectar discrepancias
de precio / cantidad / no-recibido / IVA, y pintarlas para que el humano APRUEBE o
reclame. Aquí Folvy iguala a R365 (+ audit log); el eslabón al margen llega en C3.4.

## RECON (confirmado)
- `vat_rate_for(p_category_id uuid, p_date date)` → { rate, equivalence_surcharge }.
- `recipe_item.vat_category_id` = categoría fiscal esperada del artículo.
- `goods_receipt_line`: recipe_item_id, qty_received, unit_cost, goods_receipt_id.
- `supplier_invoice_line` ya tiene: recipe_item_id, qty, unit_price, vat_pct, vat_category_id,
  goods_receipt_line_id (enlace al albarán), match_result, match_detail (jsonb).
- `supplier_invoice_receipt` = N:M factura↔albaranes.
- Umbral de precio: `supply_settings.price_alert_pct` (C2.2.c).

## El cruce, línea a línea
Para cada línea de factura (ya casada a un recipe_item en C3.2):
1. **Buscar su contraparte en el albarán**: entre las goods_receipt_line de los albaranes
   enlazados con el mismo recipe_item_id. Si hay una sola → match directo (escribe
   goods_receipt_line_id). Si varias → la de mismo orden / o se suman cantidades (agregado
   por artículo). Si ninguna → NO_RECIBIDO (te facturan algo que no llegó).
2. **Precio**: unit_price (factura) vs unit_cost (albarán). |Δ%| > price_alert_pct → DIFERENCIA_PRECIO.
3. **Cantidad**: qty (factura) vs qty_received (albarán, agregado por artículo). ≠ → DIFERENCIA_CANTIDAD.
4. **IVA**: tipo esperado = vat_rate_for(recipe_item.vat_category_id, invoice_date).rate.
   vat_pct (factura) ≠ esperado (±0.1) → IVA_NO_CUADRA.
   (Si el artículo no tiene categoría fiscal → no se chequea IVA, se marca informativo.)
Veredicto por línea (match_result): ok | diferencia_precio | diferencia_cantidad |
no_recibido | iva_no_cuadra | sin_casar (línea de factura sin artículo). match_detail
(jsonb) guarda los números (esperado vs facturado) para pintarlos.
Cabecera match_status: ok (todo ok) | con_diferencias (alguna). Validación por base imponible.

## Dónde vive el cálculo
- Función SQL `run_invoice_match(p_invoice_id)` SECURITY DEFINER: recorre líneas, calcula
  veredicto, escribe match_result + match_detail por línea y match_status en cabecera.
  Devuelve resumen. SE PRUEBA DESDE LA APP (auth.uid()). Idempotente (recalculable).
- Servicio `runInvoiceMatch(invoiceId)` la invoca; `approveInvoice(invoiceId)` valida y marca.

## Pantalla de revisión
- Detalle de factura (nueva vista o panel): cabecera + tabla de líneas con su CHIP de veredicto
  (verde ok / ámbar diferencia / rojo no_recibido) y, al lado, el detalle "facturado X vs
  albarán Y" (precio y cantidad) y "IVA facturado X% vs esperado Y%".
- Panel de discrepancias arriba: recuento ("2 diferencias de precio · 1 no recibido · 1 IVA").
- Botones: **Revisar (recalcular match)** · **Aprobar** (si no hay bloqueo) · **Marcar
  discrepancia** (deja la factura en con_discrepancias para reclamar al proveedor).
- Aprobar: registra approved_at/by (AUDIT, igualar R365). El eslabón coste (corregir
  last_price + impacto margen) es C3.4 — aquí la aprobación solo cambia estado + audit.

## Aprobación (C3.3 = simple; enrutado por reglas = C3.5)
- Aprobación simple por el manager. Registro de quién/cuándo en supplier_invoice
  (approved_at, approved_by, approved_by_name). Audit log = esos campos + el match_detail
  persistido. El enrutado por importe/proveedor/local es C3.5.

## Esquema
- Ninguno nuevo (las columnas match_result/match_detail/approved_* ya existen en C3.1).
- Solo la función `run_invoice_match`.

## Decisiones (con recomendación)
1. Cruce por artículo agregando cantidades cuando hay varias líneas de albarán del mismo
   artículo (no por orden de línea, que es frágil). (Recomendado.)
2. IVA: si el artículo no tiene vat_category_id, no se chequea (informativo), no se marca error. (Recomendado.)
3. Aprobar NO se bloquea por discrepancias (el humano decide); "Marcar discrepancia" es la
   vía para dejarla pendiente de reclamar. (Recomendado — coherente con IA-propone.)
4. run_invoice_match idempotente y recalculable (se puede re-revisar tras editar líneas). (Recomendado.)

## Frentes que dependen de esto
- C3.4: al aprobar, eslabón coste (last_price + recompute) + impacto en margen del plato.
- C3.5: enrutado de aprobación por reglas (importe/proveedor/local).
