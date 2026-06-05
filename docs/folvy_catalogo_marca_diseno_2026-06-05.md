# Folvy — Catálogo de Marca
## Documento de diseño formal

**Fecha:** 5 junio 2026
**Autor:** Claude (coordinador/diseñador) para Julio Gª Colón (CEO)
**Estado:** BORRADOR PARA REVISIÓN — no ejecutar hasta aprobación de Julio
**Dependencias:** CONTEXTO_CLAUDE.md, benchmark modificadores/consumo, investigación catálogo marca
**Principio rector:** deuda 0 — cada pieza funciona sola, sin depender de las demás

---

## 0. Propósito y alcance

Este documento define la arquitectura del **catálogo de marca** de Folvy: la estructura que conecta lo que el cliente vende (menú, modificadores, combos, promociones) con lo que la cocina produce (escandallos, ingredientes, stock) y lo que los canales muestran (Glovo, Uber, Last.app, sala, web).

Es la pieza fundacional del sistema. Si está mal, mal calcula el coste, mal descuenta el stock, mal publica a los canales, y mal analiza el margen.

**Alcance de este documento:**
1. Modelo de datos (tablas nuevas, evolución de existentes)
2. Caminos de entrada (cómo llega la información al sistema)
3. Arquitectura de modificadores
4. Arquitectura de combos
5. Override por ubicación y por canal
6. Unificación interna de artículos entre marcas
7. Motor de consumo (Capa 2 del MRP II)
8. Publicación multi-canal + auto-86
9. Horarios y disponibilidad
10. Ofertas y promociones
11. Edge cases reales (Llorente29)
12. Plan de construcción por fases

**Fuera de alcance:** UI/pantallas (se diseñan después de aprobar la arquitectura), integración directa con Glovo/Uber API (se diseña cuando exista el conector), TPV propio de Folvy (V3+).

---

## 1. Principios de diseño

### P1 — La marca es la fuente de verdad comercial
El menú canónico se define a nivel de MARCA. Las ubicaciones heredan y sobreescriben. Los canales adaptan. Pero la marca es la verdad.

### P2 — El artículo interno es la fuente de verdad operativa
`recipe_item` es la identidad real del producto. Un recipe_item puede tener N nombres comerciales en N marcas/canales. El stock, el coste, el proveedor y el escandallo viven en recipe_item. El nombre, la foto, el precio y la descripción viven en la cara comercial.

### P3 — Nunca bloquear por datos incompletos
Cada pieza funciona con datos parciales. Un producto sin escandallo se vende pero no descuenta stock (y Folvy avisa). Un modifier sin recipe_item se vende pero no depleciona (y Folvy avisa). Un escandallo sin precio de compra se estructura pero no calcula margen (y Folvy avisa). El KPI de cobertura empuja a completar.

### P4 — Evolucionar el esquema, no reemplazar
Se aplica al ESQUEMA (las tablas), no a los datos. `menu_item` se evoluciona añadiendo columnas (product_type, menu_category_id, etc.) — no se crea una `menu_item_v2` paralela. Es multi-tenant: todos los clientes (nuevos y existentes) usan las mismas tablas. Un cliente nuevo arranca con tablas vacías + columnas nuevas desde el día 1. Llorente29 necesita migración para rellenar los campos nuevos. Si al construir se descubre un defecto estructural irreconciliable en `menu_item` (ej: `channel_id` en la tabla base vs en la variante), se rediseña — pero la hipótesis es que se puede evolucionar.

### P5 — Diseñar para el futuro, construir para hoy
El modelo soporta publicación a canales, auto-86, promociones y horarios desde el diseño. Se construyen por fases. Los ganchos están desde el día 1.

### P6 — Independencia de TPV + dirección del flujo de catálogo
El modelo interno no sabe de Last.app, Glovo ni ningún TPV. Los adaptadores de cada fuente/destino traducen entre el formato externo y el modelo interno. Cambiar de TPV = cambiar un adaptador, no el modelo.

**Dirección del flujo — configurable POR MARCA (`catalog_source`):**

| Modo | Dirección | Cuándo aplica | Estado |
|---|---|---|---|
| **A — TPV manda** | TPV → Folvy | Marcas gestionadas en el TPV (Llorente29 hoy) | Viable ahora |
| **B — Folvy manda** | Folvy → TPV/canales | Marcas gestionadas en Folvy | Viable con Glovo/Uber (CRUD API). Con Last.app: pendiente de confirmar escritura API |
| **C — Bidireccional** | TPV ↔ Folvy | Marcas con gestión compartida | Más complejo, diferido |

**Hallazgos de Last.app (05/06/2026):**
- **Webhook `catalog:updated` EXISTE** — Last.app notifica cuando el catálogo cambia en su backoffice. Folvy puede suscribirse para recibir cambios en tiempo real (mejor que import XLS manual). Habilita Modo A de forma reactiva.
- **Tipologías del integrador Folvy:** Creador de pedidos ✅, Pantallas de cocina ✅, Gestión de inventario ✅, Reportes ✅, Sistemas de pago ✅. NO hay checkbox de "Gestión de catálogo" → la escritura de catálogo por API probablemente no está expuesta a integradores. Pendiente de confirmar con Last.app.
- **Eventos webhook disponibles** (confirmados): 30+ eventos incluyendo tab lifecycle (created/closed/cancelled/merged), delivery-status-updated, kitchen_order (created/updated), catalog:updated, promotions (created/updated/deleted), reservations, floorplan, customer/points, payments.
- **Si Last.app NO soporta escritura de catálogo:** el operador mantiene el menú en Last.app (backoffice) y los escandallos/costes en Folvy. No es ideal pero funciona. Folvy se entera de cambios vía `catalog:updated`.
- **Glovo/Uber SÍ soportan escritura** (CRUD completo en sus Partner APIs). Cuando Folvy se integre directamente, el Modo B es viable desde el día 1 para estos canales.

**Decisión de implementación:** el modelo interno soporta las 3 direcciones desde el diseño. Se construye Modo A primero (TPV→Folvy). Se añade Modo B cuando se confirme la capacidad de escritura del canal destino. El campo `catalog_source` en `brand` ('folvy'|'pos'|'mixed') determina la dirección por marca.

---

## 2. Modelo de datos

### 2.1 Tablas existentes que se EVOLUCIONAN

#### `menu_item` (evolución — añadir columnas)

Columnas nuevas:
```sql
product_type       text NOT NULL DEFAULT 'item'    -- 'item' | 'combo'
  CHECK (product_type IN ('item', 'combo'))
menu_category_id   uuid REFERENCES menu_category(id)  -- reemplaza text "category" gradualmente
short_name         text                             -- nombre corto para KDS/ticket
kitchen_name       text                             -- nombre de cocina (si difiere del comercial)
```

La columna `category` (text) se mantiene por compatibilidad pero se depreca a favor de `menu_category_id`.

#### `recipe_item` (sin cambios de esquema)
Ya soporta todo: type (raw/dish/prep/tool), escandallo vía recipe_line, coste vía computed_cost, proveedor vía article_supplier. El modifier option apunta aquí.

### 2.2 Tablas NUEVAS

#### `menu_category` — categorías del menú de una marca

```sql
CREATE TABLE menu_category (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  brand_id        uuid NOT NULL REFERENCES brand(id),
  name            text NOT NULL,             -- "🍽️ MILANESAS XL (AL PLATO)"
  slug            text,                      -- "milanesas-xl"
  emoji           text,                      -- "🍽️" (extraído o manual)
  position        integer NOT NULL DEFAULT 0,
  parent_id       uuid REFERENCES menu_category(id), -- jerarquía 1 nivel opcional
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, slug)
);
-- RLS: belongs_to_account
```

#### `modifier_group` — grupo de modificadores

```sql
CREATE TABLE modifier_group (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  brand_id        uuid NOT NULL REFERENCES brand(id),
  name            text NOT NULL,              -- "Escoge la base de tu milanesa"
  internal_name   text,                       -- nombre interno si difiere (para el operador)
  min_selections  integer NOT NULL DEFAULT 0, -- 0 = opcional, 1+ = obligatorio
  max_selections  integer NOT NULL DEFAULT 1, -- 1 = elige uno, N = elige varios
  allow_repetition boolean NOT NULL DEFAULT false,
  group_type      text NOT NULL DEFAULT 'choice',
    -- 'choice' (elige versión, obligatorio),
    -- 'extras' (añadir ingredientes),
    -- 'removal' (quitar ingredientes),
    -- 'side' (acompañamiento),
    -- 'cross_sell' (producto independiente: postre/bebida),
    -- 'info' (solo KDS, sin impacto)
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- RLS: belongs_to_account
```

#### `modifier_option` — opción dentro de un grupo

```sql
CREATE TABLE modifier_option (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_group(id),
  name              text NOT NULL,             -- "Base Ternera (Premium Selection)"
  recipe_item_id    uuid REFERENCES recipe_item(id), -- artículo interno (NULLABLE: si null, sin impacto inventario)
  price_impact      numeric NOT NULL DEFAULT 0, -- céntimos de suplemento (puede ser negativo)
  is_default        boolean NOT NULL DEFAULT false,
  position          integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- RLS: belongs_to_account
-- CONSTRAINT: máximo 1 is_default=true por modifier_group_id
```

**Nota sobre `recipe_item_id`:** la opción apunta al artículo interno. "Base Ternera" → recipe_item "Milanesa de ternera" (artículo comprado). Si el artículo no existe al crear la opción, se crea al vuelo (create-on-fly, mismo patrón que el OCR de albarán). Si la opción no tiene impacto en inventario (ej: "Poco hecha"), recipe_item_id es NULL.

#### `modifier_group_assignment` — qué productos usan qué grupo

```sql
CREATE TABLE modifier_group_assignment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_group(id),
  menu_item_id      uuid NOT NULL REFERENCES menu_item(id),
  position          integer NOT NULL DEFAULT 0, -- orden de los grupos en el producto
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(modifier_group_id, menu_item_id)
);
-- RLS: belongs_to_account
```

#### `modifier_recipe_impact` — qué cambia en el escandallo cuando se elige una opción

```sql
CREATE TABLE modifier_recipe_impact (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  modifier_option_id uuid NOT NULL REFERENCES modifier_option(id),
  impact_type       text NOT NULL,
    -- 'replace_item': quita target_recipe_item_id, pone modifier_option.recipe_item_id
    -- 'add_item': añade modifier_option.recipe_item_id con quantity
    -- 'remove_item': quita target_recipe_item_id del escandallo base
    -- 'multiply': multiplica target_recipe_item_id por quantity (doble carne)
    -- 'bundle': modifier_option.recipe_item_id es un producto independiente (no altera la receta base)
    -- 'none': sin impacto en inventario (info KDS)
    CHECK (impact_type IN ('replace_item','add_item','remove_item','multiply','bundle','none'))
  target_recipe_item_id uuid REFERENCES recipe_item(id),
    -- el ingrediente que se quita/reemplaza/multiplica en el escandallo base (null para add/bundle/none)
  quantity          numeric,                    -- cantidad en unidad base (null para replace/remove/none)
  unit_id           uuid REFERENCES kitchen_unit(id), -- unidad de la cantidad (null si no aplica)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- RLS: belongs_to_account
```

**Esta tabla es el corazón del problema de los modificadores.** Separa la DEFINICIÓN COMERCIAL (modifier_option: nombre, precio) de la DEFINICIÓN OPERATIVA (modifier_recipe_impact: qué cambia en la receta). Esto permite:
- Definir un modifier comercialmente ANTES de tener el impacto operativo (no bloquea).
- Que un mismo modifier_option tenga impactos distintos según el plato (si se necesita en el futuro, vía campo menu_item_id en esta tabla — de momento NO, por simplicidad).

**Ejemplo concreto — Milanesa House:**

```
modifier_group: "Escoge la base de tu milanesa" (choice, min:1, max:1)
  ├── modifier_option: "Base Pollo (The OG)" price_impact:0, is_default:true
  │     └── recipe_item_id → "Milanesa de pollo" (artículo comprado)
  │     └── modifier_recipe_impact: impact_type='replace_item'
  │           target_recipe_item_id=NULL (ES el default, no reemplaza nada)
  │
  ├── modifier_option: "Base Cerdo (New Vibe)" price_impact:100
  │     └── recipe_item_id → "Milanesa de cerdo" (artículo comprado)
  │     └── modifier_recipe_impact: impact_type='replace_item'
  │           target_recipe_item_id → "Milanesa de pollo" (lo que quita)
  │
  └── modifier_option: "Base Ternera (Premium)" price_impact:250
        └── recipe_item_id → "Milanesa de ternera" (artículo comprado)
        └── modifier_recipe_impact: impact_type='replace_item'
              target_recipe_item_id → "Milanesa de pollo" (lo que quita)
```

Para el default (Pollo), el motor de consumo usa la receta base del plato tal cual. Para Cerdo o Ternera, el motor quita "Milanesa de pollo" del escandallo y pone el artículo de la opción elegida.

#### `combo_slot` — slot de un combo

```sql
CREATE TABLE combo_slot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  combo_item_id   uuid NOT NULL REFERENCES menu_item(id), -- el combo (product_type='combo')
  name            text NOT NULL,               -- "Elige tu Milanesa"
  min_selections  integer NOT NULL DEFAULT 1,
  max_selections  integer NOT NULL DEFAULT 1,
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- RLS: belongs_to_account
```

#### `combo_slot_option` — opciones de cada slot

```sql
CREATE TABLE combo_slot_option (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  combo_slot_id   uuid NOT NULL REFERENCES combo_slot(id),
  menu_item_id    uuid REFERENCES menu_item(id),       -- producto del catálogo
  modifier_group_id uuid REFERENCES modifier_group(id), -- O un grupo de modifiers (ej: "Escoge la Base")
  price_impact    numeric NOT NULL DEFAULT 0,           -- suplemento sobre el precio del combo
  is_default      boolean NOT NULL DEFAULT false,
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_option_target CHECK (
    (menu_item_id IS NOT NULL AND modifier_group_id IS NULL) OR
    (menu_item_id IS NULL AND modifier_group_id IS NOT NULL)
  )
);
-- RLS: belongs_to_account
```

**El slot puede apuntar a un PRODUCTO (elige una milanesa) o a un MODIFIER GROUP (elige la base).** Esto refleja la realidad de Last.app donde "The Full Experience" tiene slots que son productos (Elige tu Milanesa) y slots que son modifier groups (Escoge la Base de tu Milanesa).

#### `menu_item_location_override` — override por ubicación

```sql
CREATE TABLE menu_item_location_override (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  menu_item_id    uuid NOT NULL REFERENCES menu_item(id),
  location_id     uuid NOT NULL REFERENCES locations(id),
  price           numeric,       -- NULL = hereda de la marca
  photo_url       text,          -- NULL = hereda
  description     text,          -- NULL = hereda
  is_available    boolean,       -- NULL = hereda; false = oculto en esta ubicación
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(menu_item_id, location_id)
);
-- RLS: belongs_to_account
```

#### `menu_item_channel_variant` — variante por canal

```sql
CREATE TABLE menu_item_channel_variant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  menu_item_id    uuid NOT NULL REFERENCES menu_item(id),
  channel_id      uuid NOT NULL REFERENCES sales_channel(id),
  name            text,          -- NULL = hereda (Glovo puede llamarlo distinto)
  description     text,          -- NULL = hereda
  photo_url       text,          -- NULL = hereda
  price           numeric,       -- NULL = hereda (Glovo puede tener precio distinto)
  category_name   text,          -- NULL = hereda (en Glovo la categoría puede ser otra)
  external_id     text,          -- ID del producto en el canal externo (Glovo product ID, etc.)
  is_available    boolean,       -- NULL = hereda
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(menu_item_id, channel_id)
);
-- RLS: belongs_to_account
```

**Este es el que resuelve el hallazgo de Glovo vs Last.app:** "The Heritage Classic" en Last.app se llama "Milanesa de Pollo Clásica" en Glovo y cuesta 18.90€ en vez de 16.90€. Son el MISMO menu_item con channel_variants distintos.

#### `menu_schedule` — horarios de disponibilidad

```sql
CREATE TABLE menu_schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  -- Polimórfico: aplica a un menú entero, a una categoría, o a un producto
  menu_category_id uuid REFERENCES menu_category(id),
  menu_item_id    uuid REFERENCES menu_item(id),
  -- Scope: por ubicación y/o canal (NULL = todas)
  location_id     uuid REFERENCES locations(id),
  channel_id      uuid REFERENCES sales_channel(id),
  -- Horario
  day_of_week     integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=lunes
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_target CHECK (
    menu_category_id IS NOT NULL OR menu_item_id IS NOT NULL
  )
);
-- RLS: belongs_to_account
```

#### `brand_promotion` — ofertas y promociones

```sql
CREATE TABLE brand_promotion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  brand_id        uuid NOT NULL REFERENCES brand(id),
  channel_id      uuid REFERENCES sales_channel(id),  -- NULL = todos los canales
  location_id     uuid REFERENCES locations(id),       -- NULL = todas las ubicaciones
  name            text NOT NULL,                        -- "2x1 Milanesas"
  promo_type      text NOT NULL,
    -- '2x1', 'percentage_discount', 'fixed_discount', 'bundle_price', 'free_item'
    CHECK (promo_type IN ('2x1','percentage_discount','fixed_discount','bundle_price','free_item'))
  discount_pct    numeric,          -- para percentage_discount
  discount_amount numeric,          -- para fixed_discount
  bundle_price    numeric,          -- para bundle_price
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz,      -- NULL = sin fin
  is_active       boolean NOT NULL DEFAULT true,
  conditions      jsonb,            -- condiciones adicionales (mín. pedido, solo Prime, etc.)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- RLS: belongs_to_account
```

#### `brand_promotion_product` — productos en la promoción

```sql
CREATE TABLE brand_promotion_product (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  promotion_id    uuid NOT NULL REFERENCES brand_promotion(id),
  menu_item_id    uuid NOT NULL REFERENCES menu_item(id),
  role            text NOT NULL DEFAULT 'target',
    -- 'target' (el producto con descuento),
    -- 'trigger' (el que hay que comprar para activar),
    -- 'free' (el que se regala)
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- RLS: belongs_to_account
```

### 2.3 Extensión de `sale_line` para consumo normalizado

```sql
-- Nuevas columnas en sale_line
parent_sale_line_id  uuid REFERENCES sale_line(id),  -- para sub-líneas de modifier/combo
line_type            text NOT NULL DEFAULT 'product',
  -- 'product': línea principal del producto vendido
  -- 'modifier': opción de modifier elegida
  -- 'combo_item': sub-producto de un combo
  CHECK (line_type IN ('product', 'modifier', 'combo_item'))
modifier_option_id   uuid REFERENCES modifier_option(id), -- si line_type='modifier'
combo_slot_id        uuid REFERENCES combo_slot(id),       -- si line_type='combo_item'
```

Esto normaliza la información que hoy vive en `raw_products` JSON. El webhook (o cualquier adaptador) descompone la venta en sale_lines tipadas. El motor de consumo trabaja SOLO con sale_lines normalizadas.

### 2.4 Diagrama de relaciones (resumen textual)

```
brand
  └── menu_category (categorías del menú)
  └── menu_item (productos de la marca)
        ├── recipe_item (artículo interno → escandallo, coste, stock)
        ├── menu_item_location_override (precio/foto/disponibilidad por local)
        ├── menu_item_channel_variant (nombre/precio/foto por canal)
        ├── modifier_group_assignment → modifier_group
        │     └── modifier_option
        │           ├── recipe_item (artículo interno del modifier)
        │           └── modifier_recipe_impact (qué cambia en el escandallo)
        ├── combo_slot (si product_type='combo')
        │     └── combo_slot_option
        │           ├── menu_item (producto del slot)
        │           └── modifier_group (grupo de modifiers del slot)
        └── menu_schedule (horarios)
  └── brand_promotion → brand_promotion_product

sale
  └── sale_line (normalizada)
        ├── line_type: product → menu_item → recipe_item
        ├── line_type: modifier → modifier_option → recipe_item + recipe_impact
        └── line_type: combo_item → menu_item del slot → recipe_item
```

---

## 3. Caminos de entrada

### 3.1 Fuentes de datos del cliente

| # | Fuente | Lo que trae | Cómo llega a Folvy | Resultado |
|---|---|---|---|---|
| 1 | **Nada** (todo en la cabeza) | Conocimiento del cocinero | Entrada manual guiada | Estructura desde cero |
| 2 | **Recetas a mano** | Papel/libreta con recetas | Foto → OCR visión (ya existe: `ocr-albaran` adaptado) | recipe_items + recipe_lines |
| 3 | **Excel de recetas** | Spreadsheet con ingredientes y cantidades | Import Excel → parser → estructurar | recipe_items + recipe_lines |
| 4 | **Otro sistema** (tspoon, Apicbase, Gstock) | Export del sistema anterior | Import CSV/Excel del formato del competidor | recipe_items + recipe_lines + menu_items |
| 5 | **TPV** (Last.app, Revo, etc.) | Catálogo con productos, modifiers, combos, precios | API pull / webhook / import XLS | menu_items + modifier_groups + combos |
| 6 | **Delivery platform** (Glovo, Uber) | Menú público con nombres, fotos, precios, categorías | Scrape URL pública / API partner | menu_items + channel_variants + fotos |
| 7 | **Menú de papel/PDF** (sala, carta de diseño) | Productos, precios, descripciones, categorías | PDF/foto → OCR visión | menu_items + categorías + precios |
| 8 | **Web del restaurante** | Carta online | URL → scrape | menu_items + fotos + precios |
| 9 | **Facturas/albaranes** | Artículos comprados con precios | OCR (ya existe) | recipe_items (raw) + precios de compra |
| 10 | **Ya en Folvy** | Marca nueva sobre ingredientes existentes | Crear menu_items sobre recipe_items existentes | Solo capa comercial |
| 11 | **Clonar marca** | Marca existente como base | Copiar + adaptar | Copia con override |

### 3.2 Principio de entrada multi-fuente

El cliente puede traer datos de VARIAS fuentes simultáneamente. Ejemplo realista:
- Trae el export de Last.app (productos + modifiers + combos + precios)
- Trae la URL de Glovo (fotos + precios delivery + categorías Glovo)
- Trae fotos de recetas escritas a mano (escandallos)
- Trae facturas del proveedor (precios de compra)

Folvy CRUZA todas las fuentes:
1. Last.app da la estructura comercial (productos, modifiers, combos)
2. Glovo da las variantes de canal (nombres, precios, fotos distintos)
3. Las fotos de recetas dan los escandallos
4. Las facturas dan los precios de compra

El resultado es un catálogo completo con ambas caras (comercial + operativa) en una sola pasada.

### 3.3 Motor de ingesta

Patrón único para todas las fuentes:

```
FUENTE → PARSER (específico por fuente) → MODELO NORMALIZADO → MATCHER → ALMACENAR

Parser: extrae datos crudos de la fuente (JSON, XLS, foto, URL)
Modelo normalizado: la estructura interna de Folvy (menu_item, modifier_group, etc.)
Matcher: busca coincidencias con lo que ya existe (por nombre, por ID externo, por recipe_item)
Almacenar: crea o actualiza, marcando needs_review lo que no matchea
```

El matcher reutiliza la cascada existente de `run_mapping` (código proveedor → nombre exacto → normalizado → trigram difuso). Si no matchea, ofrece create-on-fly.

---

## 4. Motor de consumo (Capa 2 del MRP II)

### 4.1 Flujo completo

```
VENTA LLEGA (webhook / pull)
  │
  ├── 1. NORMALIZAR: el adaptador (Last.app, Glovo, etc.) descompone la venta
  │     en sale_lines tipadas (product + modifier + combo_item)
  │
  ├── 2. MAPEAR: cada sale_line se enlaza a su menu_item → recipe_item
  │     (reutiliza el mapeo existente por organizationProductId)
  │
  ├── 3. EXPLOTAR: para cada sale_line type='product':
  │     a. Leer recipe_lines del recipe_item (escandallo base)
  │     b. Dividir por yield_portions si > 1 (NULL/0 → 1)
  │     c. Multiplicar por sale_line.quantity
  │     d. Aplicar modifier_recipe_impacts de las sale_lines type='modifier'
  │        que sean hijas de esta línea:
  │        - replace_item: quitar target del escandallo, poner recipe_item del modifier
  │        - add_item: sumar ingrediente + cantidad
  │        - remove_item: restar ingrediente
  │        - multiply: multiplicar cantidad del ingrediente target
  │        - bundle: NO altera la receta base — es un producto independiente (explota su propia receta)
  │        - none: ignorar
  │     e. Si hay sub-recetas (recipe_line.child_item_id → type='dish'/'prep'),
  │        explotar recursivamente
  │     f. Convertir unidades a base (misma lógica que kitchen_recompute_item)
  │
  ├── 4. ESCRIBIR: por cada ingrediente raw resultante:
  │     stock_movement type='consumo', source_type='sale_line',
  │     source_id=sale_line.id, qty_base (negativo), unit_cost (WAC del momento)
  │     + recompute_location_stock
  │
  └── 5. ALERTAR: si algún ingrediente no tiene stock suficiente → alarma
         Si algún sale_line no tiene menu_item → needs_review
         Si algún menu_item no tiene recipe_item → coverage gap
         Si algún modifier no tiene recipe_impact → coverage gap
```

### 4.2 Timing

Batch process. Configurable:
- **Nightly** (como Apicbase): suficiente para el 99% de los casos. Más robusto.
- **Hourly**: para clientes que quieren stock más actualizado.
- **Near-real-time** (por venta): para auto-86 (desconectar producto agotado).

Se arranca con nightly. Se evoluciona a near-real-time cuando se implemente auto-86.

### 4.3 Cancelaciones y reembolsos

```
Estado de la venta (sale.status — NUEVO campo):
  'confirmed' → consumo normal
  'cancelled' → NO descuenta (o reversa si ya descontó)
  'refunded'  → reversa parcial/total (refund_amount)

Si una venta se cancela DESPUÉS de que el batch haya descontado:
  → stock_movement type='consumo_reverso', source_type='sale_line',
    qty_base positivo (devuelve al stock)
```

### 4.4 KPIs de cobertura

| KPI | Qué mide | Objetivo |
|---|---|---|
| **Cobertura de mapeo** | % de sale_lines con menu_item_id | 100% |
| **Cobertura de escandallo** | % de facturación sobre menu_items con recipe_lines | 100% |
| **Cobertura de modifiers** | % de modifier_options con recipe_impact definido | 100% (excluyendo type='info') |
| **Cobertura de compras** | % de recipe_items raw con precio de compra | 100% |
| **AvT calculable** | % de facturación donde se puede calcular consumo teórico | Derivado de los anteriores |

---

## 5. Override por ubicación y por canal

### 5.1 Resolución de precio

```sql
-- Precio efectivo de un menu_item para una ubicación y canal
SELECT
  COALESCE(
    cv.price,                  -- 1º: override de canal
    lo.price,                  -- 2º: override de ubicación
    mi.price                   -- 3º: precio base de marca
  ) AS effective_price
FROM menu_item mi
LEFT JOIN menu_item_channel_variant cv
  ON cv.menu_item_id = mi.id AND cv.channel_id = :channel_id
LEFT JOIN menu_item_location_override lo
  ON lo.menu_item_id = mi.id AND lo.location_id = :location_id
WHERE mi.id = :menu_item_id;
```

Prioridad: canal > ubicación > marca. El canal gana porque la misma ubicación puede tener precios distintos en Glovo vs sala.

### 5.2 Caso real Glovo vs Last.app

```
menu_item: "The Heritage Classic" (Milanesa House)
  price: 16.90€ (precio base en Last.app/sala)
  
  channel_variant (Glovo):
    name: "Milanesa de Pollo Clásica"  -- nombre distinto
    price: 18.90€                      -- precio distinto
    category_name: "Milanesas de Pollo" -- categoría distinta
    photo_url: (foto de Glovo)

  channel_variant (Uber):
    name: "Heritage Classic"
    price: 17.50€
```

### 5.3 Variante de canal para modificadores

En Glovo, la versión ternera NO es un modifier — es un PRODUCTO INDEPENDIENTE ("Milanesa de Ternera Clásica" a 16.90€). Esto significa que el mismo concepto se puede presentar como modifier en un canal y como producto en otro.

Solución: el channel_variant puede marcar que un modifier_group se "explota" en productos independientes para ese canal. Esto es un gancho para la publicación futura, NO se construye ahora — se documenta como decisión diferida.

---

## 6. Unificación interna de artículos

### 6.1 Mecanismo de unificación

Folvy ofrece tres niveles:

**Nivel 1 — Automático por recipe_item_id:** Múltiples menu_items ya apuntan al mismo recipe_item. Esto funciona desde hoy (ratio 4:1).

**Nivel 2 — Sugerencia de unificación:** Folvy detecta recipe_items con nombres similares (trigram) y propone merge. "Tienes 'Patatas Clásicas (raw)' y 'Patatas fritas (raw)' — ¿son el mismo artículo?" Si el operador confirma, se unifica (un recipe_item sobrevive, el otro se marca como alias).

**Nivel 3 — Prevención de duplicados al crear:** Al dar de alta un nuevo recipe_item (manual, OCR, o import), Folvy busca duplicados antes de crear y propone enlazar al existente.

### 6.2 Tabla de alias (opcional, para merge)

```sql
CREATE TABLE recipe_item_alias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  canonical_id    uuid NOT NULL REFERENCES recipe_item(id), -- el que sobrevive
  alias_id        uuid NOT NULL REFERENCES recipe_item(id), -- el que se unifica
  alias_name      text NOT NULL,                             -- nombre del alias (para referencia)
  merged_at       timestamptz NOT NULL DEFAULT now(),
  merged_by       uuid,
  UNIQUE(alias_id)
);
```

Al unificar, todas las references al alias_id se actualizan al canonical_id (menu_items, recipe_lines, modifier_options, article_supplier, stock_movements).

---

## 7. Publicación multi-canal y auto-86

### 7.1 Modelo de publicación (gancho, no se construye ahora)

```
brand_menu_publication
  id, brand_id, channel_id, location_id
  status: 'draft' | 'published' | 'out_of_date'
  published_at, published_by
  external_menu_id (ID del menú en Glovo/Uber/etc.)
```

Cuando se modifique un menu_item que tenga publicaciones activas, el status cambia a 'out_of_date' → el operador ve que hay cambios sin publicar.

### 7.2 Auto-86 (desconectar producto agotado)

```
Trigger: stock de un recipe_item baja de umbral (0 o safety_stock)
  → Folvy identifica TODOS los menu_items que usan ese recipe_item
    (directamente o vía modifier_option.recipe_item_id)
  → Marca is_available=false en menu_item_channel_variant para los canales activos
  → Publica la desconexión al canal (API Glovo/Uber/etc.)
  → Notifica al gerente

Trigger inverso: stock sube por recepción
  → Revierte el auto-86 si was_auto_disabled
```

**NOTA:** el auto-86 requiere integración directa con los canales (API push). Se diseña ahora, se construye cuando exista el conector Glovo/Uber directo.

---

## 8. Horarios y disponibilidad

### 8.1 Niveles de horario

| Nivel | Ejemplo | Tabla |
|---|---|---|
| Marca completa | "Milanesa House abre L-D 12:00-23:00" | Gestionado en ubicación/canal externo |
| Categoría | "Combos solo disponibles 12:00-16:00" | menu_schedule (menu_category_id) |
| Producto | "Tarta 3 Leches solo hasta las 15:00" | menu_schedule (menu_item_id) |
| Por ubicación | "Plaza Castilla cierra los lunes" | menu_schedule (location_id) |
| Por canal | "En Glovo solo cena" | menu_schedule (channel_id) |

Se pueden combinar: "Los combos solo están disponibles en Glovo de L-V de 12:00 a 16:00 en la ubicación Alcalá".

---

## 9. Ofertas y promociones

### 9.1 Tipos soportados

| Tipo | Ejemplo | Campos |
|---|---|---|
| 2x1 | "2x1 Cheese-Sticks en Glovo" | promo_type='2x1', products=[Cheese-Sticks] |
| % descuento | "20% en milanesas" | promo_type='percentage_discount', discount_pct=20, products=[milanesas] |
| Fijo | "3€ menos en tu primer pedido" | promo_type='fixed_discount', discount_amount=3 |
| Precio bundle | "Combo a 19.50€ (vale 24€)" | promo_type='bundle_price', bundle_price=19.50 |
| Item gratis | "Postre gratis con 2 milanesas" | promo_type='free_item', trigger=[2 milanesas], free=[postre] |

### 9.2 Impacto en margen

Las promociones afectan al margen real. Folvy calcula:
- Margen sin promo: (PVP − coste) / PVP
- Margen con promo: (PVP_efectivo − coste) / PVP_efectivo
- Coste de la promo por unidad vendida
- Coste total de la promo en el período

Esto permite evaluar si una promo es rentable ANTES de lanzarla y medirla DESPUÉS con datos reales.

---

## 10. Edge cases reales (Llorente29)

| # | Edge case | Solución |
|---|---|---|
| 1 | Marcas duplicadas en menu_item (2 "Milanesa House") | Merge de brands + actualizar FKs |
| 2 | Modifier sin org_modifier_id (marcas licenciadas Cloudtown) | Mapear por catalog_modifier_id + nombre |
| 3 | Mismo modifier con precios distintos por marca/grupo (BBQ 0€ en una marca, 0.50€ en otra) | Cada modifier_option tiene su price_impact. El modifier_group pertenece a la marca. |
| 4 | Cross-sell disfrazado de modifier (Tarta como modifier) | group_type='cross_sell', recipe_impact type='bundle' |
| 5 | Combo con slots planos en raw_products (sin tipado) | El adaptador Last.app infiere los slots del combo usando la estructura del catálogo |
| 6 | Producto en Glovo que no existe en Last.app (Croquetas) | channel_variant con el producto de Glovo. Si se vende, se crea menu_item + se mapea |
| 7 | Precio distinto por canal (16.90€ Last vs 18.90€ Glovo) | menu_item_channel_variant.price |
| 8 | Estructura comercial distinta por canal (modifier en Last, producto en Glovo) | Gancho para publicación futura — documentado en §5.3 |
| 9 | Artículo "Milanesa de ternera" es comprado, no cocinado — no tiene sub-ingredientes | recipe_item type='raw', sin recipe_lines. El coste viene del proveedor directamente |
| 10 | Patatas Clásicas = mismo artículo en 5 marcas | Unificación: todos los menu_items apuntan al mismo recipe_item |

---

## 11. Plan de construcción por fases

### Fase A — Modelo base + ingesta desde Last.app (habilita Capa 2)

**Qué se construye:**
- Tablas: modifier_group, modifier_option, modifier_recipe_impact, modifier_group_assignment, combo_slot, combo_slot_option, menu_category
- Evolución de menu_item (product_type, menu_category_id)
- Evolución de sale_line (parent_sale_line_id, line_type, modifier_option_id, combo_slot_id)
- Adaptador Last.app ampliado: webhook descompone modifiers y combos en sale_lines normalizadas
- Semilla: extraer modifier groups y combos de `raw_products` histórico para poblar las nuevas tablas

**Qué NO se construye:** location override, channel variant, schedules, promotions, publicación.
**Qué habilita:** Motor de consumo (Capa 2). El AvT puede incluir modifiers.

### Fase B — Override + variantes de canal (habilita multi-local real)

**Qué se construye:**
- Tablas: menu_item_location_override, menu_item_channel_variant
- UI de gestión de precios por ubicación
- Import de catálogo Glovo (desde URL pública o export)
- Cruce Last.app ↔ Glovo para detectar variantes

### Fase C — Catálogo de marca como fuente de verdad (habilita publicación)

**Qué se construye:**
- menu_category (gestión visual de categorías)
- UI completa de gestión de menú de marca
- Definición de modifier groups y opciones desde Folvy (no solo import)
- Alta de modifier_recipe_impact (con IA de apoyo)
- Combos como entidad de primer nivel

### Fase D — Horarios, promociones, auto-86 (habilita operación completa)

**Qué se construye:**
- Tablas: menu_schedule, brand_promotion, brand_promotion_product
- UI de gestión de horarios y promos
- Motor auto-86 (gancho de stock → disponibilidad)
- Publicación a canales (cuando exista conector directo)

### Fase E — Unificación y onboarding inteligente

**Qué se construye:**
- Detección de duplicados (trigram matching entre recipe_items)
- Sugerencia de merge
- Motor de ingesta multi-fuente (OCR de carta, import multi-formato)
- Onboarding guiado para cliente nuevo

---

## 12. Verificación del diseño

### 12.1 Preguntas de validación

Antes de construir, verificar contra cada pregunta:

1. ¿Un hostelero con un local y una marca puede usar esto sin complejidad extra? → Sí: una marca, cero overrides, cero variantes.
2. ¿Llorente29 con 10 marcas, 3 locales y 4 canales puede funcionar? → Sí: modifier groups por marca, overrides por local, variantes por canal.
3. ¿Un cliente nuevo sin datos puede arrancar? → Sí: crea desde cero o importa.
4. ¿Un cliente con todo en tspoon puede migrar? → Sí: import + mapeo.
5. ¿Si falta el escandallo se bloquea algo? → No: vende sin descontar stock, avisa.
6. ¿Si falta el modifier_recipe_impact? → No: vende sin descontar el modifier, avisa.
7. ¿Si cambia de TPV? → Solo cambia el adaptador. El modelo interno no se toca.
8. ¿El auto-86 funciona con modifiers? → Sí: si "Milanesa de ternera" se agota, se desactiva el modifier option "Base Ternera" en todos los canales.

### 12.2 Coherencia con lo existente

| Componente existente | Cómo se integra |
|---|---|
| Kitchen (recipe_item + recipe_line) | recipe_item sigue siendo la verdad operativa. menu_item apunta a recipe_item. |
| Supply (pedido + recepción + factura) | El pedido se hace sobre recipe_items (artículos de compra). Nada cambia. |
| Inventario (stock_movement + ledger) | El motor de consumo escribe stock_movements type='consumo'. Mismo ledger. |
| Ventas (sale + sale_line) | sale_line se amplía con parent/type/modifier. Compatible hacia atrás. |
| Coste (kitchen_recompute_item) | El coste del modifier se calcula con la misma lógica. El impacto usa la misma conversión de unidades. |

---

*Documento de diseño cerrado para revisión.*
*Siguiente paso: revisión por Julio → aprobación → Fase A (modelo base + ingesta).*
*RECON obligatorio de BBDD antes de ejecutar cualquier DDL.*
