# Folvy Supply — C3.4: eslabón coste + impacto en margen
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
La pieza DIFERENCIAL: al aprobar una factura que corrige el precio respecto al
albarán, actualizar el coste real (last_price) y MOSTRAR el impacto en el margen
de los platos afectados. R365 actualiza coste; NADIE conecta la factura con el
margen del plato. Folvy sí (la cascada coste→plato→margen ya existe).

## RECON (confirmado)
- Escribir `article_supplier.last_price` → trigger `trg_article_supplier_recompute_cost`
  → `kitchen_recompute_raw_cost(item)` → recalcula coste del raw.
- `kitchen_recompute_item(item)` propaga a platos. `menu_item_economics(brand, service_type)` = margen.
- OJO: ese trigger llama a función SECURITY DEFINER → revienta en SQL Editor (auth.uid() null),
  pero FUNCIONA desde la app (hay sesión). C3.4 se ejecuta al aprobar DESDE LA APP. Correcto.
- article_supplier: clave (recipe_item_id, supplier_id), columna last_price.

## Qué hace al APROBAR (extiende approveInvoice de C3.3)
Para cada línea de factura casada (recipe_item_id no null) con unit_price y proveedor:
1. **¿corrige el precio?** Comparar unit_price (factura) con el last_price actual de
   article_supplier(recipe_item_id, supplier de la factura). Si difiere → es una corrección.
2. **Actualizar last_price** = unit_price de la factura (el coste REAL que pagas; la factura
   manda sobre el albarán). El UPDATE dispara el trigger → recompute del raw → cascada a platos.
   (La recepción ya había puesto el precio del albarán; la factura lo confirma o lo corrige.)
3. NO mueve stock (lo hizo la recepción). Solo coste.

## Impacto en margen (lo que nadie tiene)
- ANTES de actualizar, leer el coste actual de cada raw afectado (recipe_item.computed_cost o
  el last_price previo). DESPUÉS, leer el nuevo. Calcular el delta de coste por artículo.
- Mostrar en la aprobación un panel: "Esta factura cambia el coste de N ingredientes →
  afecta a M platos". Por artículo: coste antes → después (Δ%). Opcional (si el dato es
  barato de leer): los platos que más mueven su margen.
- DECISIÓN de alcance: en C3.4, mostrar el impacto a NIVEL DE INGREDIENTE (coste antes/después
  por raw corregido) + recuento de platos afectados. El detalle plato-a-plato con margen
  exacto es una segunda capa (requiere brand/service_type; se puede enchufar luego sin
  reescribir). Empezamos por el ingrediente (cubre el 90% del valor: "el tomate sube 12%").

## Eslabón: marcar albaranes facturados
- Al aprobar, los albaranes enlazados (supplier_invoice_receipt) quedan marcados como
  facturados — para que no se sugieran otra vez en C3.2 (ya lo hace: listUninvoicedReceipts
  excluye los enlazados a una factura; al aprobar el enlace ya existe). No requiere cambio
  extra: el enlace N:M creado en el alta ya los excluye. (Verificar.)

## Cómo se implementa
- Función SQL `apply_invoice_costs(p_invoice_id)` SECURITY DEFINER: por cada línea casada,
  actualiza last_price en article_supplier (upsert por recipe_item_id+supplier_id de la
  factura). Devuelve la lista de { recipe_item_id, name, old_price, new_price, pct } para el
  panel de impacto. SE EJECUTA DESDE LA APP (el trigger SECURITY DEFINER necesita sesión).
- Servicio: `approveInvoice` (C3.3) se amplía → tras marcar aprobada, llama a
  `applyInvoiceCosts(invoiceId)` y devuelve el impacto; la UI lo muestra.
- UI: tras Aprobar, panel "Impacto en coste": tabla de ingredientes con coste antes→después
  y Δ%, + "N platos recalculados".

## Esquema
- Ninguno nuevo. Solo la función `apply_invoice_costs`.

## Decisiones (con recomendación)
1. La factura MANDA sobre el albarán en el precio (al aprobar, last_price = precio facturado).
   ¿Siempre, o solo si el humano confirma la corrección? (Recomiendo: al APROBAR se aplica;
   aprobar es la confirmación. Si no quiere aplicar, no aprueba / marca discrepancia.)
2. Impacto a nivel de INGREDIENTE en C3.4 (coste antes/después + nº platos); plato-a-plato
   con margen = capa 2 futura. (Recomendado.)
3. Solo se tocan líneas casadas con proveedor resuelto; sin casar no se toca coste. (Recomendado.)
4. apply_invoice_costs idempotente (re-aprobar no rompe; last_price queda en el último precio). (Recomendado.)

## Frentes futuros
- Impacto plato-a-plato con margen exacto (brand × service_type × mix de ventas).
- Rappel/abono (nota de crédito) que ajusta coste a la baja — el modelo ya tiene doc_kind.
- C3.5: enrutado de aprobación por reglas (importe/proveedor/local).
