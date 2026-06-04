# Folvy Supply — C2.2.b: casado de líneas con memoria + create-on-scan + aprendizaje
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Cerrar la recepción OCR: que cada línea leída del albarán (texto + código del
proveedor) se case con TU artículo, y que el sistema APRENDA de cada confirmación
para que el próximo albarán del mismo proveedor case casi solo. Es la grieta del
mercado (los líderes no recuerdan). IA propone, humano decide.

## RECON (lo que ya existe y se reutiliza — no se reinventa)
- **`run_mapping(account, text, code, limit, fuzzy_min, target_types)`** — casador en
  cascada YA construido: (1) CÓDIGO contra `article_supplier.supplier_code`/folvy_code/
  external_codes → conf 1.00; (2) nombre exacto (name+alt_names); (3) nombre normalizado;
  (4) difuso trigram. Devuelve `recipe_item_id, name, folvy_code, confidence, match_type,
  semaphore (green/yellow)`. Acepta `target_types=['raw']` para casar solo ingredientes.
- **`article_supplier`** — único por `(recipe_item_id, supplier_id)`. Guarda supplier_code,
  last_price, purchase_format_id. **Es la MEMORIA de casado por código.**
- **`mapping_proposal`** — carril de propuestas (lo usa ventas y escandallos).
- **NO se reutiliza `confirm_mapping`**: su aprendizaje escribe en `sale_line` (ventas) y
  destino `menu_item`. Compras necesita su propio aprendizaje → `article_supplier`/`recipe_item`.
  (Hallazgo de RECON: reusarlo habría roto ventas.)

## Flujo de b (sobre la recepción borrador OCR de a-2)
```
Recepción borrador (source ocr) con líneas "sin mapear" (raw_text, supplier_code, qty, precio)
   │  [al abrir el form OCR, b casa cada línea]
   ▼
Por cada línea:  run_mapping(account, raw_text, supplier_code, target_types=['raw'])
   │   · 1 candidato verde → AUTO-asignado (visible, editable; no se oculta)
   │   · varios / amarillo → propone el mejor + lista para elegir
   │   · nada → "sin casar" → CREATE-ON-SCAN
   ▼
El humano revisa línea a línea (con la foto al lado):
   · acepta el casado propuesto, o elige otro candidato, o
   · CREA artículo nuevo al vuelo (raw mínimo: nombre, familia, unidad) → queda casado
   · (proveedor: si no existe, crear/elegir en la cabecera — incluye Cloudtown)
   ▼
Al confirmar la recepción (C2): además del ledger (stock+coste), APRENDIZAJE:
   · upsert article_supplier (recipe_item_id, supplier_id) ← supplier_code, last_price,
     purchase_format_id  → la PRÓXIMA factura de este proveedor casa por código (conf 1.00)
   · (opcional) añadir raw_text a recipe_item.alt_names si difería → casa por nombre también
   · memoria de intermediario: si el proveedor elegido ≠ emisor del albarán, recordar
     emisor→comercial + delivered_by (resuelve el caso Cloudtown que aplazamos en a-2)
```

## Las piezas

### b.1 — Casar líneas (lectura, en el form OCR)
- Nuevo: por cada línea sin recipeItemId, llamar `run_mapping`. Servicio
  `matchReceiptLine(accountId, rawText, supplierCode)` → candidatos.
- En el form OCR, cada línea muestra: artículo propuesto (con semáforo verde/amarillo y
  match_type: "por código" / "por nombre" / "parecido"), o "sin casar". Verde único →
  preseleccionado. Un desplegable/buscador para elegir otro candidato o buscar a mano.
- Anti-invención: nada se auto-confirma a stock; el verde se PROPONE, el humano valida al
  confirmar la recepción. Confianza visible.

### b.2 — Create-on-scan
- Si una línea no casa, botón "Crear artículo": alta mínima de `recipe_item` (type='raw',
  name=raw_text, familia, unidad base) con source='ocr', needs_review. Queda casado a esa línea.
- Proveedor nuevo (Europastry, Cloudtown): en la cabecera, "Crear proveedor" (nombre + NIF).
  Reutiliza el alta de proveedor que ya exista; si no, alta mínima en `supplier`.

### b.3 — Aprendizaje al confirmar (lógica NUEVA de compras)
- `learnFromReceipt(receiptId)` tras confirmar: para cada línea con recipe_item_id +
  supplier_code, **upsert `article_supplier`** (clave única recipe_item_id+supplier_id):
  set supplier_code, last_price (= unit_price_net), purchase_format_id si lo hay.
- Esto NO toca el coste (ya lo hace el ledger de C2); es la MEMORIA para el próximo casado.

### b.4 — Memoria de intermediario (cierra el caso Cloudtown de a-2)
- Si en la cabecera el humano pone un proveedor (Cloudtown) distinto del emisor leído (Joan),
  guardar la relación emisor→comercial (p.ej. tabla `supplier_alias` { account, emitter_text
  normalizado, supplier_id, delivered_by } o un jsonb en supplier). En el próximo albarán de
  Joan, `resolveReceiptHeader` consulta esa memoria → propone Cloudtown + delivered_by=Joan.
- Decisión: ¿tabla `supplier_alias` (recomendado, limpio) o jsonb en supplier?

## Cambios de esquema (mínimos)
- Posible `supplier_alias` (intermediario→comercial) — b.4. (O jsonb.)
- Nada más: run_mapping, article_supplier, mapping_proposal ya existen.

## Orden de construcción (encadenado, sin pausa)
1. **b.1** casar líneas (run_mapping en el form OCR) — ya usable: ves el casado propuesto.
2. **b.3** aprendizaje al confirmar (upsert article_supplier) — cierra el bucle de memoria.
3. **b.2** create-on-scan (artículo + proveedor nuevos) — para Europastry/Cloudtown.
4. **b.4** memoria de intermediario — cierra Cloudtown del todo.

## Decisiones antes de construir
1. **Auto-asignar el verde único** (recomendado: preseleccionado, editable) vs siempre manual.
2. **Crear artículo al vuelo**: ¿alta mínima (nombre+familia+unidad) suficiente, y el resto se
   completa luego en Kitchen? (Recomiendo mínima — no frenar la recepción.)
3. **Memoria de intermediario**: ¿tabla `supplier_alias` (recomendado) o jsonb en supplier?
4. **Umbral de auto-propuesta**: usar el semáforo de run_mapping (verde=propone, amarillo=
   sugiere pero pide confirmación). (Recomiendo seguir el semáforo tal cual.)
