# Folvy KDS — Ticket completo: combos, modificadores y notas de cliente
### Diseño (13/06). RECON hecho contra BBDD real de Llorente29. NO asumido.

## Hallazgos del RECON (datos reales, no supuestos)

**El modelo canónico YA tiene combos y modificadores estructurados** (no hay que extraer del crudo):
- `sale_line.parent_sale_line_id` → jerarquía padre/hijo.
- `sale_line.line_type` ∈ {`product`(709), `combo_item`(283), `modifier`(221)} en Llorente29.
- `combo_item` cuelga del combo padre (verificado: "Menú Doble Big Mikes" → Coca Cola Zero + La Doble + Classic Fries).
- `modifier` usa `modifier_option_id` (187 líneas casadas).
- Los `combo_item` NO traen `menu_item_id` propio (no tienen receta casada por ahora).

**Las notas de cliente NO están materializadas** — solo en el crudo:
- `sale.raw_tab` (es **text**, castear a `::jsonb`) → `products[].comments` (string libre POR PRODUCTO).
- Ejemplos reales: "sin salsa", "sin pepinillos y sin lechuga".
- Frecuencia: **2 de 367** pedidos (0,5%). RARÍSIMAS pero CRÍTICAS (suelen ser alérgenos/exclusiones).
- Last separa `comments` (texto libre del cliente) de `modifiers` (estructurado de la carta). Ambos importan.
- La nota es POR LÍNEA (no del pedido entero) → debe mostrarse PEGADA A SU PLATO, no como banda global.

## Principio de cocina (Julio): lo COCINABLE manda
- El nombre del combo NO se cocina → va atenuado/gris (contexto).
- Los COMPONENTES sí se cocinan → grandes y claros.
- La nota de cliente, aunque rara, es peligrosa precisamente porque la cocina baja la guardia → debe GRITAR.

---

## NIVEL 1a — Combos + modificadores + notas en tarjeta y Cook Mode (CONSTRUIR HOY)

### Backend `kds_board`
1. **Dejar de filtrar solo `product`.** Traer también `combo_item` y `modifier`, anidados bajo su
   `parent_sale_line_id`. Cada línea producto lleva:
   - `children`: array de sus `combo_item` (componentes) y `modifier` (opciones), con su `name`, `qty`, `line_type`.
2. **Extraer `comments` por línea** del `raw_tab::jsonb -> products[]` y casarlo a la `sale_line`
   correspondiente (por `external_product_id`/`organizationProductId` o por orden). Exponer en cada línea:
   - `customer_note`: el texto de `comments` si no está vacío; si no, null.
   - Si el casado línea↔producto-del-raw es frágil, alternativa: exponer las notas del pedido como
     lista a nivel ticket con el nombre del producto, y la tarjeta las ancla por nombre. (Decidir en RECON de implementación.)

### Frontend `KdsTicketCard`
3. **Combo**: cabecera pequeña/gris ("▸ Menú Doble Big Mikes") + componentes en grande debajo
   (1 La Doble · 1 Classic Fries · 1 Coca Cola Zero). Lo cocinable destaca; el combo es contexto.
4. **Modificadores**: bajo su plato, estilo diferenciado (sangrado, "+ queso", "sin cebolla").
5. **Nota de cliente**: PEGADA a la línea del plato al que aplica, en banda/chip ⚠ ámbar-rojo,
   imposible de ignorar (icono + color + peso). NO como banda global del ticket (la nota es por plato).
   Considerar sonido/realce distinto al entrar un ticket CON nota.

### Cook Mode
6. Combo (sin `menu_item_id` propio) → al tocarlo muestra **sus componentes** (cada uno con su receta si
   la tiene). Plato con modificador → refleja el modificador. La nota de cliente también visible aquí.

---

## NIVEL 1b — (absorbido en 1a) Las notas entran HOY
Razón (Julio): que sean raras (0,5%) las hace MÁS peligrosas, no menos — la cocina no las espera.
Por seguridad (alérgenos), entran ya con alerta destacada. Coste bajo (extraer `comments`), riesgo de NO
tenerlas alto (un alérgeno servido).

---

## NIVEL 2 — Impacto del modificador en receta y coste (DISEÑO HOY, construir después)

La tabla `modifier_recipe_impact` YA existe (3 filas, casi vacía). Columnas:
`modifier_option_id, impact_type, target_recipe_item_id, quantity, unit_id, status, confidence, source,
rationale, confirmed_by, confirmed_by_name, confirmed_at`.

Visión (diferenciador Folvy, batir tspoon/R365):
- Cada `modifier_option` puede ALTERAR la receta: añadir/quitar/sustituir un ingrediente (`impact_type`),
  con `quantity`+`unit`, ligado a `target_recipe_item_id`.
- Coste al vuelo: el coste de la línea = receta base ± impactos de sus modificadores.
- Margen REAL ponderado por el mix de modificadores realmente vendido (vía bills).
- "IA propone, humano decide": `confidence` + `confirmed_by` (anti-invención, como todo Folvy).

Construir requiere: poblar el mapeo de los 221 modificadores → su impacto (IA propone, Pamela confirma).
Es un frente propio. Hoy: solo el documento de diseño.

---

## DEUDA declarada
- Casado línea↔`comments` del raw: validar la vía exacta en el RECON de implementación (por
  `organizationProductId` es lo más robusto; el raw lo trae como `organizationProductId`).
- `combo_item` sin `menu_item_id` → su receta en Cook Mode no se puede mostrar hasta casarlos (o no
  aplica si el componente no necesita ficha). Declarar.
- Regenerar `database.ts` (sigue pendiente del frente anterior).
