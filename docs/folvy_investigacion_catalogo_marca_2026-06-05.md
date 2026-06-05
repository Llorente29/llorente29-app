# Investigación: Catálogo de Marca en Hostelería
## Cómo resuelven los mejores SaaS las 6 piezas del problema

**Fecha:** 5 junio 2026
**Contexto:** Fundamento para el diseño del modelo de catálogo de marca de Folvy
**Fuentes:** Toast MLM, Apicbase, R365, Crunchtime, MarketMan, Lightspeed, Supy, Otter, Deliverect, UrbanPiper, Oracle Simphony, MenuClips
**Datos reales:** Llorente29 / Milanesa House (Last.app exports + capturas + BBDD Folvy)

---

## 0. Las 6 piezas del problema

| # | Pieza | Pregunta | Riesgo si se hace mal |
|---|---|---|---|
| 1 | Catálogo de marca (fuente de verdad) | ¿Dónde vive la definición canónica del menú? | Duplicación, inconsistencia entre canales |
| 2 | Override por ubicación | ¿Cómo varía precio/foto/disponibilidad por local? | Precios incorrectos, margen invisible |
| 3 | Modifier groups y options | ¿Cómo se definen las opciones de personalización? | Consumo de inventario incorrecto, coste real desconocido |
| 4 | Combos / menús | ¿Cómo se estructuran las ofertas combinadas? | Margen del combo invisible, slot sin costear |
| 5 | Unificación interna de artículos | ¿Cómo se evita contar 3 veces lo mismo? | Stock triplicado, pedidos al proveedor fragmentados, AvT roto |
| 6 | Publicación multi-canal | ¿Cómo llega el menú a Glovo/Uber/sala/TPV? | Menús desincronizados entre canales |

---

## 1. Catálogo de marca como fuente de verdad

### 1.1 Patrón universal: Master Menu

Todas las plataformas enterprise usan un patrón de "Master Menu" o "Menu Template":

**Toast MLM (Multilocation Management):** El menú maestro se crea a nivel de "restaurant group" (empresa). Las ubicaciones HEREDAN el menú maestro. Cambios en el maestro se propagan a todas las ubicaciones automáticamente. Los menús se pueden "targetear" a un grupo de ubicaciones o a ubicaciones individuales. Existe el concepto de "menu versions" — variantes del mismo menú para ubicaciones específicas (ej: Portland tiene una versión del menú Dinner distinta de Boston, pero ambas comparten la estructura base).

**Deliverect:** Tiene un "master menu" por marca que se publica a múltiples canales y ubicaciones. El flujo es: crear menú en Deliverect → publicar a Glovo/Uber/DoorDash para las ubicaciones seleccionadas. Soporta "custom tags" para publicar el mismo menú a múltiples brands de un canal en un clic.

**Otter:** "Multi-Menus" — múltiples menús para una misma ubicación (desayuno, comida, cena). Cada virtual brand tiene su propio menú gestionado desde un dashboard único. La gestión es centralizada pero la publicación es por marca + canal.

**Apicbase:** Las recetas (que son la base del menú) se crean centralmente y se "asignan a outlets". Los precios de venta se sincronizan desde el POS o se gestionan en Apicbase. Las recetas contienen todo: ingredientes, costes, alérgenos, nutrición, pasos. Son datos vivos, no documentos estáticos.

**Supy:** Para operadores multi-marca, permite "shared ingredient management across multiple brands while tracking consumption, costing, and performance separately". Las recetas se asignan a marcas, menús o sites específicos — "teams only see what's relevant".

### 1.2 Hallazgo: dos niveles de "menú"

Hay una distinción crítica que todos los sistemas hacen (explícita o implícitamente):

| Nivel | Qué contiene | Quién lo gestiona | Cambia cuándo |
|---|---|---|---|
| **Catálogo de producto** (interno) | Recipe items, ingredientes, costes, proveedores | Operaciones / cocina central | Cuando cambia la receta o el proveedor |
| **Menú comercial** (externo) | Nombres, descripciones, fotos, precios, disponibilidad, modifier groups, combos | Marketing / gerente de marca | Cuando cambia la oferta al cliente |

En Toast, estos dos niveles están en sistemas separados (Toast Web = menú comercial, xtraCHEF = catálogo de producto). En Apicbase, están más integrados (la receta contiene ambas caras). En Supy, la separación es explícita: "base items" (inventario) vs "recipes" (coste) vs "POS menu items" (comercial).

**Folvy tiene la oportunidad de unificarlos** mejor que nadie porque ya tiene Kitchen (catálogo de producto) y construirá el catálogo de marca (menú comercial) sobre la misma base.

### 1.3 Datos reales de Llorente29

En Last.app, el catálogo tiene 3 niveles:
- **Catálogo** (ej: "MILANESA HOUSE") → asignado a una marca y a canales destino (Glovo, Uber, Local, Para llevar)
- **Categorías** dentro del catálogo (🚀 COMBOS SAVER, 🥪 MILA-SÁNDWICHES, 🍽️ MILANESAS XL, 🍟 ENTRANTES, 🍦 POSTRES, 🥤 BEBIDAS)
- **Productos** dentro de cada categoría, con modifier groups asignados

Hay 15+ catálogos para 10 marcas, algunos duplicados por canal (BENDITO BURRITO - Glovo / BENDITO BURRITO - Uber Eats and Glovo). Esto confirma que Last.app gestiona variantes por canal.

---

## 2. Override por ubicación

### 2.1 Patrón universal: herencia con override selectivo

**Toast MLM — el más documentado:**
- El menú maestro define precios base.
- Se puede habilitar "Location-Specific Pricing" en items o grupos específicos. Solo esos items son editables a nivel local.
- Un manager con permiso "Local Menu Edit" puede: cambiar precio (si habilitado), añadir/quitar items del menú de su ubicación, gestionar disponibilidad (86 un item).
- Lo que NO puede: cambiar la estructura del menú, crear modifier groups, crear items nuevos fuera del catálogo corporativo.
- Los cambios de precio se pueden programar para el futuro ("scheduled publishing").
- "Menu versions" permiten variantes más profundas por ubicación (items distintos) sin duplicar el menú entero.

**Deliverect:**
- Override de precio por ubicación (si el item tiene un precio custom en Deliverect, se mantiene incluso después de un product sync con el POS).
- Override de disponibilidad por ubicación y por canal.
- Override de horarios de menú por ubicación.
- El override es explícito: si no se pone override, hereda del master.

**Apicbase:**
- Los precios de las recetas se sincronizan desde el POS nightly. Si un outlet tiene un precio distinto en el POS, Apicbase lo refleja en sus reports.
- Las recetas en sí NO varían por outlet (una receta = una receta global). Lo que varía es: disponibilidad, precio de venta, y los proveedores/precios de compra (que SÍ son por outlet).

**Lightspeed K-Series:**
- Las recetas se pueden "compartir" entre ubicaciones con un clic (Share).
- Los precios pueden diferir por outlet (gestionados en el POS local).

### 2.2 Hallazgo: qué atributos son overrideables

| Atributo | Nivel marca (master) | Nivel ubicación (override) |
|---|---|---|
| Nombre del producto | ✓ (fuente de verdad) | Raro (solo si el local tiene nombre distinto para un plato) |
| Descripción | ✓ | ✓ (adaptación local) |
| Foto | ✓ | ✓ (foto del local vs foto de estudio) |
| Precio de venta | ✓ (precio base) | ✓ (el más común — precios distintos por zona/ciudad) |
| Disponibilidad (visible/oculto) | ✓ (activo globalmente) | ✓ (un local puede quitar un item si no tiene ingredientes) |
| Modifier groups asignados | ✓ (fuente de verdad) | Raro (excepto disponibilidad de opciones dentro del grupo) |
| Receta/escandallo | ✓ (fuente de verdad, global) | Raro (solo si la receta varía por local, ej: receta adaptada a un equipo de cocina distinto) |
| Horario de disponibilidad | ✓ (franjas por defecto) | ✓ (un local puede tener horarios distintos) |

### 2.3 Patrón de datos

El modelo más limpio (Deliverect/Toast):

```
menu_item (canónico de marca)
  ├── id, brand_id, name, description, photo_url, price, ...
  └── modifier_groups[], category, position

menu_item_location_override (solo campos sobreescritos)
  ├── menu_item_id, location_id
  ├── price (nullable — si null, hereda)
  ├── photo_url (nullable — si null, hereda)
  ├── description (nullable — si null, hereda)
  ├── is_available (nullable — si null, hereda)
  └── schedule_override (nullable)

Consulta: COALESCE(override.price, master.price)
```

---

## 3. Modifier groups y options — arquitectura

### 3.1 Modelo universal de datos

Todas las plataformas usan el mismo modelo conceptual de 3 niveles:

```
MODIFIER GROUP (grupo)
  ├── name: "Escoge la base de tu milanesa"
  ├── min_selections: 1 (obligatorio)
  ├── max_selections: 1 (elige exactamente 1)
  ├── allow_repetition: false
  │
  └── MODIFIER OPTIONS (opciones)
       ├── "Base Pollo (The OG)"      → price_impact: 0€
       ├── "Base Cerdo (New Vibe)"    → price_impact: +1.00€
       └── "Base Ternera (Premium)"   → price_impact: +2.50€

PRODUCT → tiene N modifier groups asignados
```

**Last.app (confirmado por capturas):** Exactamente este modelo. Grupo tiene nombre + Min + Max + "Permitir repetición" + lista de opciones con precio. El grupo se asigna al producto desde la ficha del producto.

**Toast:** Modifier groups se crean globalmente y se asignan a items o a menu groups enteros. Soporta nested modifiers (sub-opciones dentro de una opción). Los modifier groups pueden tener pricing individual, pricing de tamaño (S/M/L), o pricing de secuencia (pizza mitades).

**Oracle Simphony:** El modelo más complejo — "Condiment Groups" con "Condiment Prefix Types" (Add, Remove, Sub, Plain, Reset, Description). Cada tipo tiene un comportamiento distinto en el POS y en la depleción de inventario.

**Lightspeed:** "Option Sets" con opciones. Pueden ser obligatorios u opcionales. Soportan upcharge por opción.

### 3.2 Hallazgo: la opción del modifier ES un producto

En todos los sistemas serios, la opción del modifier no es un texto — es una referencia a un producto o ingrediente del catálogo:

- **Toast/xtraCHEF:** El modifier se mapea a un "Product" o "Prep Recipe" con porción y unidad.
- **R365:** "POS modifiers are brought into R365 as regular Menu Items" — un modifier es literalmente un menu item.
- **Crunchtime:** Las opciones de modifier son recipes para depleción.
- **Last.app (confirmado):** "Base Pollo (The OG)" existe TANTO como modifier option dentro del grupo "Escoge la base" COMO producto en el catálogo global de Products (333 productos, los últimos 3 son Base Pollo 0€, Base Cerdo 1€, Base Ternera 2.50€).

**Implicación para Folvy:** La opción del modifier debe apuntar a un `recipe_item` (artículo interno). "Base Ternera" → `recipe_item` "Milanesa de ternera" (artículo comprado). La opción del modifier es la CARA COMERCIAL de un artículo interno.

### 3.3 Tipología de modifier groups

Del análisis de Llorente29 (391 modifiers, 10+ marcas), todos los modifier groups caen en una de estas categorías:

| Tipo | Ejemplo real Llorente29 | Min | Max | Impacto en receta |
|---|---|---|---|---|
| **Choice point (obligatorio)** | "Escoge la base de tu milanesa" (Pollo/Cerdo/Ternera) | 1 | 1 | SWAP: quita artículo A, pone artículo B |
| **Extras (opcional, múltiple)** | "¿Quieres algún ingrediente extra? LB" (Bacon, Queso, Huevo) | 0 | N | ADD: suma artículo + cantidad |
| **Remove (opcional, múltiple)** | "¿Quieres pepinillos?" (Con/Sin) | 0-1 | 1 | REMOVE: resta artículo |
| **Size (obligatorio)** | "¿Quieres dos discos o solo uno?" (1 disco/2 discos) | 1 | 1 | MULTIPLY: multiplica porción |
| **Side/acompañamiento** | "¿Quieres acompañar con patatas?" (Sí/No) | 0 | 1 | BUNDLE: añade producto independiente |
| **Cross-sell** | "¿Quieres añadir un postre?" (Tarta/Cheesecake/Sin postre) | 0-1 | 1 | BUNDLE: producto independiente con escandallo propio |
| **Salsa/condimento** | "Elige la salsa" (BBQ/Miel Mostaza/Chipotle) | 1 | 1 | SWAP o ADD de ingrediente de bajo coste |
| **Cocción (solo KDS)** | "Punto de la carne" (Al punto/Muy hecha/Poco hecha) | 0-1 | 1 | NINGUNO: solo información para cocina |

### 3.4 Dato real: duplicación masiva en Last.app

Los 391 modifiers de Llorente29 tienen duplicados masivos porque Last.app copia la opción en cada grupo donde se usa:
- "BBQ-Barbacue." aparece 7 veces (7 grupos de salsas en 7 marcas)
- "Patatas Clásicas" aparece 7 veces con 4 precios distintos (4.30€/4.40€/0.00€ cuando es incluida)
- "Tiras de Pollo Kentucky (4 uds)" aparece 12 veces con 5 precios distintos

Folvy NO debe copiar este modelo. Internamente, "BBQ-Barbacue" es UN artículo (`recipe_item`). Cada modifier group referencia ese artículo con su precio de impacto.

---

## 4. Combos / menús

### 4.1 Modelo universal: combo = producto + slots

Todas las plataformas modelan el combo como:

```
COMBO (producto con precio propio)
  ├── name: "The Full Experience (Menú Milanesa)"
  ├── price: 26.90€
  ├── description, photo, etc.
  │
  └── SLOTS (categorías/grupos del combo)
       ├── Slot 1: "Elige tu Milanesa" → [Heritage Classic, Big Napo, Parmigiana, ...]
       ├── Slot 2: "Escoge la Base"    → [Pollo, Cerdo, Ternera]
       ├── Slot 3: "Elige Bebida"      → [Coca-Cola, Fanta, Mahou, ...]
       └── Slot 4: "Elige Postre"      → [Cheesecake, Tarta 3 Leches]
```

**Last.app (confirmado por captura):** Exactamente este modelo. El combo tiene precio fijo y 4 "categorías" que son los slots. Cada slot tiene opciones que son productos o modifier groups.

**Toast:** Combos se crean como un menu item con modifier groups que representan los slots. El precio base es el del combo; las opciones premium tienen upcharge. Soporta "Auto Combo" (el POS detecta automáticamente si los items del ticket forman un combo y aplica el descuento).

**Oracle Simphony:** "Combo Meal Groups" y "Combo Meal Side Groups" con lógica de sustitución (Alternate Groups) y 3 algoritmos de auto-combo (First Deal, Best for Customer, Best for Merchant).

**Lightspeed:** "Option Sets" combinados en un producto combo. Cada Option Set es un slot.

### 4.2 Hallazgo: el combo NO tiene receta propia

En NINGÚN sistema el combo tiene su propia BOM/receta. El coste del combo = suma de los costes de las opciones elegidas en cada slot. Esto es universal porque las opciones de cada slot ya tienen su propia receta.

**Implicación para Folvy:** El combo apunta a sus slots, cada slot apunta a productos que ya tienen `recipe_item_id`. El coste se calcula dinámicamente: SUMA(coste de opción elegida en cada slot). No hay `recipe_line` para el combo.

### 4.3 Dato real: combos de Llorente29

Los combos de Llorente29 en `raw_products` muestran los `comboProducts` como lista PLANA sin slots tipados — platos, bebidas, bases y opciones al mismo nivel. Folvy tiene que imponer la estructura de slots que Last.app SÍ tiene internamente (las 4 categorías del combo) pero que no exporta en el JSON de venta.

---

## 5. Unificación interna de artículos entre marcas

### 5.1 El problema

Caso real de Llorente29:
- "Patatas Clásicas" (Lobbers) = "Patatas Clásicas." (Milanesa House) = "Patatas Clásicas Meraki" (Meraki Pita) = "French Fries" (hipotético)
- "Coca-Cola Original" aparece en TODAS las marcas como modifier de combo o bebida independiente
- "Milanesa de pollo" (Mila's, como modifier) = "Base Pollo (The OG)" (Milanesa House, como modifier) = potencialmente el mismo artículo comprado

Si cada aparición crea un `recipe_item` distinto:
- Stock fragmentado (3 líneas de patatas en vez de 1)
- Pedido al proveedor con 3 líneas separadas
- AvT imposible de cuadrar (teórico descontó de 3 artículos, real es 1)
- Coste no comparable entre marcas

### 5.2 Cómo lo resuelven los mejores

**Supy (el más explícito en multi-marca):**
- "Shared ingredient management across multiple brands"
- "Track consumption, costing, and performance separately" por marca
- "Assign recipes to specific brands, menus, or sites — teams only see what's relevant"
- "Swap ingredients across all recipes they appear in — without editing each one manually"
- Modelo: un ingrediente base (`base item`) → múltiples recetas → múltiples marcas/menús. El ingrediente es UNO, las recetas que lo usan son de marcas distintas.

**Apicbase:**
- Las recetas se crean centralmente con ingredientes del catálogo global.
- "Attribute menus and recipes to specific outlets"
- El ingrediente es global; la asignación a outlets/marcas es la capa de encima.

**Crunchtime:**
- "Company Products" (catálogo global, above-store) → "Location Products" (con precio/proveedor local)
- Un producto global, múltiples instancias locales con precios distintos.

**R365:**
- "Purchased Items" (lo que compras, global) → "Recipe Items" (recetas, pueden ser multi-marca) → "Menu Items" (POS, por marca/canal)
- La relación es many-to-many vía mapeo.

**Toast/xtraCHEF:**
- "Products" (ingredientes/items) son globales dentro de la cuenta.
- Cada menu item de cada marca se mapea al mismo Product si es el mismo ingrediente.

### 5.3 Patrón universal: 3 capas de identidad

```
CAPA 1 — ARTÍCULO INTERNO (uno solo, global a la cuenta)
  recipe_item: "Patatas fritas caseras"
  → tiene escandallo, stock, proveedor, coste

CAPA 2 — RECETA / PREPARACIÓN (puede haber variantes)
  recipe_item: "Ración patatas Lobbers" (usa 200g de patatas + condimento)
  recipe_item: "Ración patatas Meraki" (usa 180g de patatas + orégano)
  → ambas usan el MISMO ingrediente base "Patatas fritas caseras"
  → o pueden ser EXACTAMENTE el mismo recipe_item si son idénticas

CAPA 3 — NOMBRE COMERCIAL (por marca/canal)
  menu_item: "Patatas Clásicas" (Lobbers) → apunta a recipe_item
  menu_item: "Patatas Meraki" (Meraki Pita) → apunta al MISMO recipe_item
  menu_item: "Patatas Clásicas." (Milanesa House) → apunta al MISMO recipe_item
```

**Si las raciones son idénticas:** todas las menu_items apuntan al mismo recipe_item. Stock = 1 línea. Pedido = 1 línea.

**Si las raciones difieren:** cada marca tiene su propio recipe_item (con cantidades distintas), pero los recipe_lines de ambas apuntan al MISMO ingrediente base. Stock sigue siendo 1 línea del ingrediente.

### 5.4 Hallazgo de Llorente29

Dato real: 852 menu_items → 213 recipe_items (ratio 4:1). Esto ya funciona parcialmente — múltiples menu_items apuntan al mismo recipe_item. Pero la unificación se hizo por mapeo de ventas (PLU → recipe_item), no por diseño de catálogo. Para hacerlo bien, hay que validar que los recipe_items que representan lo mismo estén efectivamente unificados (no 3 "Coca-Cola" distintos).

---

## 6. Publicación multi-canal

### 6.1 Patrón universal: master → publish → canal

```
MASTER MENU (en Folvy / Deliverect / Otter)
  │
  ├── Publish → Glovo (con precios Glovo, fotos Glovo, horarios Glovo)
  ├── Publish → Uber Eats (con precios Uber, etc.)
  ├── Publish → JustEat
  ├── Publish → TPV sala (con precios sala, carta impresa)
  └── Publish → Web / App propia
```

**Deliverect:** Publica desde un master menu a múltiples canales y ubicaciones. Soporta "product sync" bidireccional con el POS. Override de precio por canal (ej: 10% más caro en Glovo que en sala). Validación antes de publicar (imágenes faltantes, precios erróneos). "Scheduled publishing" para cambios futuros.

**Otter:** Publicación desde un dashboard único a todos los canales. "Automatically sync your menus, manage them across locations, and mark items unavailable in real-time."

**UrbanPiper:** Middleware entre POS y plataformas de delivery. "Sync Menu" publica el catálogo a todas las plataformas conectadas. Real-time stock sync (item out of stock → unavailable en todas las plataformas).

### 6.2 Implicación para Folvy

Folvy hoy no publica menús — los RECIBE de Last.app. Pero el diseño debe soportar ambas direcciones:

**Dirección 1 (hoy): TPV → Folvy** — el catálogo viene de Last.app. Folvy lo importa y lo enriquece con escandallos y costes.

**Dirección 2 (futuro): Folvy → canales** — Folvy es la fuente de verdad del menú y publica a Last.app, Glovo, Uber, web. El `catalog_source` por marca (decisión ya tomada: 'folvy' | 'pos') determina la dirección.

**Dirección 3 (híbrida):** Algunas marcas gestionadas en Folvy (propias), otras en el TPV (licenciadas como Cloudtown). Coexistencia.

---

## 7. Síntesis: modelo conceptual para Folvy

### 7.1 Las 4 entidades centrales

```
RECIPE_ITEM (artículo interno, global a la cuenta)
  → Es la VERDAD del producto: qué es, qué lleva, cuánto cuesta
  → No pertenece a una marca — es de la CUENTA
  → Tipos: raw (materia prima), dish (plato), prep (sub-receta), tool, modifier_option
  → "Milanesa de ternera" es UN recipe_item de tipo raw/comprado

MENU_ITEM (nombre comercial, por marca + canal)
  → Es la CARA COMERCIAL del recipe_item
  → Pertenece a una marca, opcionalmente a un canal
  → "Base Ternera (Premium Selection)" en Milanesa House
  → "Milanesa de ternera" en Mila's Sandwiches
  → Ambos apuntan al MISMO recipe_item
  → Tiene: nombre, descripción, foto, precio, posición, categoría

MODIFIER_GROUP (grupo de opciones, por marca)
  → "Escoge la base de tu milanesa"
  → min/max selections, obligatorio/opcional
  → Sus opciones son MENU_ITEMS (que apuntan a RECIPE_ITEMS)
  → Se asigna a productos de la marca

COMBO (producto con slots, por marca)
  → "The Full Experience (Menú Milanesa)"
  → Precio fijo + slots
  → Cada slot = un MODIFIER_GROUP
  → NO tiene receta propia — coste = suma de opciones elegidas
```

### 7.2 Override por ubicación

```
MENU_ITEM_LOCATION_OVERRIDE
  → menu_item_id + location_id
  → Solo campos sobreescritos (nullable = hereda del master)
  → price, photo_url, description, is_available, schedule
  → COALESCE(override, master) en toda consulta
```

### 7.3 Unificación

```
Cuenta Llorente29
  │
  ├── recipe_item: "Patatas fritas caseras" (id: xxx)
  │     └── recipe_lines: patata 200g, aceite 50ml, sal 2g
  │
  ├── menu_item: "Patatas Clásicas" (Lobbers, brand_id: LB) → recipe_item: xxx
  ├── menu_item: "Patatas Meraki" (Meraki Pita, brand_id: MP) → recipe_item: xxx
  └── menu_item: "Patatas Clásicas." (Milanesa House, brand_id: MH) → recipe_item: xxx

Stock: 1 línea. Pedido: 1 línea. AvT: correcto.
```

---

## 8. Lo que nadie hace (oportunidad Folvy)

1. **Unificar las 3 capas en un solo flujo:** Ningún competidor permite crear en un solo flujo: artículo interno + receta/escandallo + nombre comercial por marca + modifier groups + publicación. Todos requieren configurar cada capa por separado en pantallas distintas.

2. **Coste visible al configurar modificadores:** Nadie muestra el impacto en coste/margen AL MOMENTO de definir un modifier en el menú. El coste llega después, en otro módulo (xtraCHEF, R365 Ops), no integrado.

3. **Detección de oportunidades de unificación:** Ningún sistema dice "tienes 3 artículos que parecen lo mismo — ¿los unificas?" Supy permite gestionar ingredientes compartidos, pero la detección de duplicados es manual.

4. **Onboarding desde múltiples fuentes simultáneas:** Nadie combina OCR de menú de papel + import de TPV + import de delivery platform en un flujo integrado de onboarding. Cada fuente es un proceso separado.

5. **AvT con visibilidad de modifier:** El AvT estándar compara uso teórico (receta × ventas) vs uso real (inventario). Pero si los modifiers no están mapeados a recetas (que es lo habitual), el teórico es incorrecto. Folvy puede ser el primero en incluir modifiers en el teórico de serie.

---

## 9. Fuentes consultadas

- Toast: support.toasttab.com (MLM, Menu Builder, Modifier Groups, Prix Fixe, Price Editor, Local Menu Edit)
- Toast platform guide: doc.toasttab.com (multi-location menus, pricing strategies, modifier display)
- xtraCHEF: support.toasttab.com (Product Mix Mapping, Recipes, Yield, Item Library)
- R365: help.restaurant365.net + docs.restaurant365.com (POS Menu Item Modifier Management, Recipes, Menu Items)
- Crunchtime: crunchtime.com + support.crunchtime.com + developer.crunchtime.com (Inventory, Recipe, Menu Mix, Auto-Generate POS Recipes)
- MarketMan: marketman.com (POS integrations, ingredient-level tracking, modifier depletion)
- Apicbase: get.apicbase.com + support.apicbase.com + developers.apicbase.com (POS linking, recipe management, menu engineering, Generic POS API Guide)
- Lightspeed: k-series-support.lightspeedhq.com + o-series-support.lightspeedhq.com (recipes, combo deals, inventory, Deliverect integration)
- Supy: supy.io (multi-brand, shared ingredients, recipe management, cloud kitchens)
- Otter: tryotter.com + helpdesk.tryotter.com (multi-brand, virtual brands, menu management, multi-menus)
- Deliverect: deliverect.com + help.deliverect.com (menu publishing, multi-site, availability, modifier FAQs)
- UrbanPiper: urbanpiper.com (POS integrations, menu sync, middleware)
- Oracle Simphony: docs.oracle.com (combo meals, condiment groups, menu levels, recipe replacement)
- MenuClips: menuclips.com (ghost kitchen multi-brand menus)
- Restroworks: restroworks.com (recipe management, multi-brand, virtual items)
- Datos reales: Llorente29 / Last.app (3 exports XLS + 8 capturas backoffice + 8 queries RECON BBDD Folvy)

---

*Documento de investigación para fundamentar el diseño del catálogo de marca de Folvy.*
*Siguiente paso: documento de diseño formal con modelo de datos, flujos, estados y edge cases.*
