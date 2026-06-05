# Folvy — Importador de Catálogo Last.app (Tramo A6)
## Diseño de lógica para revisión

**Fecha:** 5 junio 2026
**Estado:** BORRADOR PARA REVISIÓN — no construir hasta aprobación
**Edge Function:** `lastapp-catalog-import` (nueva, separada del webhook de ventas)
**Fuente:** `GET /organizations/{orgId}/catalog` (Last.app API v2)
**Destino:** tablas de catálogo de marca de Folvy (Fase A)

---

## 1. Qué hace y qué NO hace

### Hace
- Lee el catálogo completo de la organización desde Last.app API
- Lo normaliza al modelo de Folvy
- Crea/actualiza: menu_category, menu_item, modifier_group, modifier_option, modifier_group_assignment, modifier_recipe_impact, combo_slot, combo_slot_option, menu_schedule
- Crea recipe_items mínimos (dish vacío para productos, raw para opciones de modifier que son artículos comprados)
- Es idempotente (re-ejecutable sin duplicar)
- Resuelve la marca de cada producto

### NO hace
- NO crea escandallos (recipe_lines) — eso lo hace el cocinero después
- NO crea artículos de compra raw (excepto opciones de modifier que son artículos) — esos vienen de facturas/master/manual
- NO calcula costes — esos vienen de las compras
- NO toca ventas históricas
- NO publica nada a ningún canal (solo lee)

---

## 2. Resolución de marca

**Problema:** el catálogo de la API viene a nivel de organización (todos los productos juntos), sin campo `brandId` en cada producto.

**Solución:** usar `lastapp_catalog_product` (snapshot que ya tiene Folvy) como tabla de resolución:
- `lastapp_catalog_product.organization_product_id` → `lastapp_brand_name`
- `lastapp_brand_name` → `brand` de Folvy (por nombre, con normalización)

**Flujo de resolución por producto:**
```
1. catalog.products[].id (= organization_product_id en Last.app)
2. Buscar en lastapp_catalog_product WHERE organization_product_id = ese id
3. Tomar lastapp_brand_name
4. Buscar brand WHERE name ILIKE lastapp_brand_name (o vía tabla de alias de marca)
5. Si no se encuentra brand → crear brand o marcar needs_review
```

**Decisión sobre el snapshot:** antes de importar el catálogo, el importador REFRESCA `lastapp_catalog_product` desde la API (para tener el mapeo marca↔producto actualizado). Esto requiere el endpoint que da la relación catálogo→marca. Si la API no lo da directamente, se usa el snapshot existente (poblado por el backfill).

**Pendiente de confirmar:** cómo obtener la relación catálogo→marca de la API. Opciones:
- `GET /catalogs` + `GET /catalogs/{id}` (cada catálogo es de una marca, pero el objeto no expone brandId explícito — el nombre del catálogo mapea a la marca)
- `GET /locations/{id}` → `location.brands` (las marcas por ubicación)
- Usar el snapshot `lastapp_catalog_product` existente (más simple, ya poblado)

**Recomendación:** arrancar con el snapshot existente. Es suficiente para Llorente29 y para el primer importador. Refinar la resolución vía `/catalogs` en una iteración posterior.

---

## 3. Mapeo campo a campo

### 3.1 Productos (`catalog.products[]` → `menu_item` + `recipe_item`)

| Last.app | Folvy menu_item | Notas |
|---|---|---|
| `id` | (clave de idempotencia, guardado en menu_item_override.external_id o campo dedicado) | organization_product_id |
| `name` | `name` | |
| `price` (céntimos) | `price` (÷100) | 1690 → 16.90 |
| `course` | `kitchen_name` o ignorar | "Segundos" |
| `enabled` | `is_active` | |
| `allergens[]` | (futuro — campo allergens en recipe_item) | de momento ignorar |
| `schedules[]` | `menu_schedule` (cuando exista la tabla — Fase D) | de momento ignorar o guardar |
| `modifierGroups[]` | vía `modifier_group_assignment` | IDs de grupos |
| (marca resuelta) | `brand_id` | vía lastapp_catalog_product |
| (canal) | `channel_id` | NOT NULL — usar canal por defecto o el del catálogo |

**recipe_item asociado:** cada producto crea (o reusa) un `recipe_item` type='dish' con el mismo nombre, SIN recipe_lines. menu_item.recipe_item_id apunta a él.

**Categoría:** del catálogo de Last.app (`catalog.categories[]` en el endpoint por catálogo) o del campo `course`. Crea `menu_category` por marca.

### 3.2 Modifiers (`catalog.modifiers[]` → `recipe_item` + cara comercial)

| Last.app modifier | Folvy | Notas |
|---|---|---|
| `id` | clave de idempotencia | modifier global de Last.app |
| `name` | nombre de la opción | "Base Ternera (Premium Selection)" |
| `priceImpact` | (precio base — pero el real viene del grupo) | el priceOverride del grupo manda |
| `enabled` | is_active | |

**Unificación clave:** si el `modifier.id` (o su `modifierId`) coincide con un `product.id`, ambos comparten el mismo `recipe_item`. Es decir: "Base Pollo" como producto y "Base Pollo" como opción de modifier → un solo recipe_item.

### 3.3 Modifier Groups (`catalog.modifierGroups[]` → `modifier_group` + `modifier_option`)

| Last.app modifierGroup | Folvy modifier_group | Notas |
|---|---|---|
| `id` | clave de idempotencia | |
| `name` | `name` | "Escoge la base de tu milanesa" |
| `min` | `min_selections` | |
| `max` | `max_selections` | |
| `enabled` | `is_active` | |
| `modifiers[]` (IDs) | → modifier_option (uno por ID) | |
| `organizationModifiers[].modifierId` | recipe_item de la opción | el modifier global |
| `organizationModifiers[].priceOverride` | `modifier_option.price_impact` | precio EN ESTE GRUPO |
| (marca resuelta) | `brand_id` | |

**group_type:** inferir del nombre y estructura:
- Contiene "base"/"elige"/"escoge" + min≥1 → 'choice'
- Contiene "extra"/"añade"/"añadir" → 'extras'
- Contiene "sin"/"quitar"/"quieres" + opciones Con/Sin → 'removal'
- Contiene "postre"/"bebida"/"acompañar" → 'cross_sell'
- Contiene "punto"/"hecho"/"cocción" → 'info'
- Por defecto → 'choice'

**modifier_recipe_impact:** el importador NO lo crea automáticamente (no sabe qué ingrediente reemplaza cada opción — eso es conocimiento de cocina). Lo deja vacío → el cocinero lo define después (los prototipos que iteramos). EXCEPCIÓN: si la unificación detecta que la opción es un artículo (modifier=product), puede pre-rellenar impact_type='replace_item' como sugerencia needs_review.

### 3.4 Combos (`catalog.combos[]` → `menu_item` product_type='combo' + `combo_slot` + `combo_slot_option`)

| Last.app combo | Folvy | Notas |
|---|---|---|
| `id` | clave de idempotencia | |
| `name` | menu_item.name | "The Full Experience" |
| `price` (céntimos) | menu_item.price (÷100) | 2690 → 26.90 |
| `enabled` | is_active | |
| `schedules[]` | menu_schedule (Fase D) | |
| `categories[]` | → combo_slot (uno por categoría) | los slots |
| `categories[].name` | combo_slot.name | "Elige tu Milanesa" |
| `categories[].min/max` | combo_slot.min/max_selections | |
| `categories[].products[]` | → combo_slot_option | |
| `categories[].products[].productId` | combo_slot_option.menu_item_id | enlaza al menu_item del producto |
| `categories[].products[].priceImpact` | combo_slot_option.price_impact | |

**recipe_item del combo:** el combo NO tiene escandallo propio. Crea un recipe_item type='dish' vacío solo para satisfacer el NOT NULL de menu_item.recipe_item_id, pero el coste se calcula dinámicamente (suma de slots). O se evalúa hacer recipe_item_id nullable para combos (decisión de esquema — ver §6).

---

## 4. Idempotencia

**Clave:** todos los objetos de Last.app tienen `id` estable. El importador guarda ese ID externo y lo usa como clave de upsert.

**Dónde guardar el external_id:**
- menu_item: necesita un campo `external_id` (NUEVO — añadir columna) o usar menu_item_override.external_id
- modifier_group: añadir `external_id`
- modifier_option: añadir `external_id`
- combo_slot: añadir `external_id`
- (etc.)

**Decisión:** añadir columna `external_id text` + `external_source text DEFAULT 'lastapp'` a las tablas de catálogo. Índice único parcial (external_source, external_id) por tabla. Esto permite:
- Upsert por external_id (no duplica)
- Soportar `catalog:updated` (re-sincronización continua)
- Trazar el origen de cada objeto

**Lógica de upsert por objeto:**
```
PARA cada producto del catálogo:
  buscar menu_item WHERE external_source='lastapp' AND external_id = producto.id
  SI existe → UPDATE (name, price, is_active, ...)
  SI NO existe → INSERT (+ crear recipe_item dish vacío)
```

---

## 5. Orden de procesamiento (dependencias)

```
1. Refrescar lastapp_catalog_product (snapshot marca↔producto) [opcional]
2. Resolver/crear brands
3. Crear menu_categories por marca
4. Procesar modifiers → recipe_items (con unificación modifier=product)
5. Procesar products → menu_items + recipe_items dish
6. Procesar modifierGroups → modifier_group + modifier_option
   (enlazar opciones a recipe_items del paso 4)
7. Enlazar products a groups → modifier_group_assignment
8. Procesar combos → menu_item(combo) + combo_slot + combo_slot_option
   (enlazar opciones a menu_items del paso 5)
9. Reportar: creados, actualizados, needs_review, marcas no resueltas
```

---

## 6. Decisiones de esquema pendientes (antes de construir)

1. **external_id en tablas de catálogo:** añadir columna a menu_item, modifier_group, modifier_option, combo_slot, combo_slot_option, menu_category. Con external_source. → Migración A6-schema previa.

2. **recipe_item_id nullable para combos:** hoy menu_item.recipe_item_id es NOT NULL. Un combo no tiene escandallo. Opciones:
   - a) Crear recipe_item dish vacío para el combo (cumple NOT NULL, pero ensucia recipe_item con entradas que nunca tendrán líneas)
   - b) Hacer recipe_item_id nullable y que el combo no tenga recipe_item
   - **Recomendación: (b)** — más limpio. El combo calcula coste por slots, no necesita recipe_item. Migración: ALTER menu_item ALTER COLUMN recipe_item_id DROP NOT NULL.

3. **channel_id en menu_item (NOT NULL):** el catálogo de Last.app no es por canal en el endpoint de organización. Hay que decidir qué canal asignar. Opciones:
   - Canal "interno"/"base" por defecto
   - El canal del catálogo (si se importa vía /catalogs que sí tiene canal)
   - **Recomendación:** crear un canal 'base' o usar el primero, y gestionar los canales reales vía menu_item_override (channel_variant). Revisar si channel_id debería ser nullable.

---

## 7. Reporte de ejecución

El importador devuelve un resumen:
```json
{
  "brands_resolved": 9,
  "brands_unresolved": 0,
  "categories_created": 12,
  "products_created": 333,
  "products_updated": 0,
  "modifiers_created": 391,
  "modifier_groups_created": 121,
  "combos_created": 20,
  "recipe_items_created": 353,
  "needs_review": [...],
  "warnings": [...]
}
```

---

## 8. Pieza relacionada NO incluida (documentada para no perder)

### Master de artículos de Folvy (FRENTE NUEVO, no ahora)
Catálogo maestro sectorial de artículos de hostelería pre-cargado en Folvy, que un cliente nuevo "adopta" para no partir de cero:
- Artículos genéricos normalizados (harinas, aceites, lácteos, carnes, refrescos...)
- Clasificación AECOC CEP (secciones→familias→subfamilias→variedades)
- Unidades típicas de compra/stock/uso
- Sin precio (el precio es de cada cliente)
- Referente competitivo: catálogo de productos de MarketMan
- Deuda 0: nadie lo da bien en el SMB español
Se construye como front dedicado tras cerrar el importador y el OCR de factura.

### Artículos desde facturas (Supply C3, medio hecho)
El feeder natural de artículos de compra + costes es el OCR de factura (ocr-albarán existe). Siguiente frente tras A6.

---

*Documento de diseño del importador para revisión.*
*Tras aprobar: migración A6-schema (external_id + ajustes) → Edge Function → borrado limpio → ejecución → validación.*
