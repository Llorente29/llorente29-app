# Folvy — Ficha de producto/artículo: benchmark + diseño
### Documento de diseño para aprobación · 06/06/2026

> **Objetivo:** diseñar la mejor ficha de producto del mercado, basada en benchmark
> de los 8 referentes más avanzados (Apicbase, R365, meez, Supy, Otter, MarketMan,
> gstock, Crunchtime). La ficha es el HUB central de Folvy — todo converge aquí.

---

## 1. LO QUE MUESTRAN LOS MEJORES (benchmark real)

### Apicbase (Bélgica, cadenas medianas-grandes)
Tabs: General · Ingredients · Method · Allergens & Nutrition · Financial · Outlets.
- Financial = coste por porción + "Show Detailed Cost per Ingredient" desplegable
- Allergens auto-calculados desde ingredientes, con bases de datos externas (USDA, etc.)
- Indicador visual: 4 iconos (pricing ✓/✗, measurement ✓/✗, allergens ✓/✗, nutrition ✓/✗)
- Recipe Comparison: compara coste/margen entre recetas del mismo menú
- Print/Export: costing sheet, allergen sheet, recipe sheet (PDF)
- AI: genera recetas desde constraints (dietary, allergens, target cost, cuisine)

### R365 (USA, referente en AP + inventory)
Campos: Display Name · Estimated Cost · Price · Target Margin · Entree flag.
- Menu Item → Recipe mapping (N:1, un menu item puede tener varias recetas/sub-recetas)
- Menu Item Links: mismo item con distinto nombre en cada location/POS
- Recipe Item Record: general info + yield + UoM + ingredients + prep steps + location settings
- Location-specific settings por recipe item
- Menu Item Categories (agrupación para reporting)
- Reports: Menu Item Analysis + Menu Price Analysis (matrix Stars/Puzzles/Plowhorses/Dogs)

### meez (USA, referente en UX para chefs)
- Granular Ingredient Management: tipo específico ("all-purpose flour, unbleached, King Arthur"),
  unidades, densidad, coste por unidad. No es solo "harina".
- Photos + videos POR PASO de la receta
- Nutritional breakdowns auto (bases de datos integradas)
- Allergen flagging automático
- AI: NLP para importar recetas en texto libre
- Supplier information vinculada al ingrediente
- Version control de recetas
- Scaling automático (batch up/down)
- Inventory connection: ingredient usage → stock forecast

### Supy (Golfo/global, referente multi-marca)
- Jerarquía: base recipes → sub-recipes → modifiers (costeados independientemente)
- Coste por: last purchase price / average price / supplier — configurable
- Prep wastage + cooking yields para depleción precisa
- Asignación: brand × menu × site (ves solo lo relevante)
- POS linking incluye modifiers
- Alertas cuando margen está en riesgo (threshold configurable)
- Ingredient deduplication across brands (lo que Folvy llama "unificación")
- Version control + audit logs
- 200+ permisos customizables

### Otter (USA/global, referente UX catálogo delivery)
- Display name + nombre interno + descripción + "Generate with AI"
- Fotos (sección dedicada)
- Precios con overrides por location × channel
- Categorías (multi-categoría por producto)
- Modifier groups expandibles
- Tax rates
- Dietary data (alcohol: sí/no, etc.)
- Locations + kitchen station (estación de cocina para KDS)
- Channels con toggle on/off
- Order data (print on label)
- Preview en vivo (cómo se ve en la plataforma mientras editas)
- 9 secciones apiladas, las avanzadas colapsadas

### MarketMan (global, inventario sobre TPV)
- Ingrediente = ficha con: nombre, categoría, unidades, proveedores (múltiples),
  packaging info, precio por unidad, stock mínimo, ubicación de almacenamiento
- Sugerencia de receta por foto de ingredientes (IA)
- OCR de facturas vinculado al ingrediente → precio actualizado auto
- Conteo de inventario por ingredient con barcode/EAN

### gstock (España, back-office serio)
- Escandallo dinámico: recalcula con cada recepción
- OCR albaranes con detección de variación de precio
- Mermas por centro de coste
- Multi-almacén con traspasos
- Propuesta de pedido por IA (plan Premium)
- Coste real vs teórico + integración TPV

### Crunchtime (USA, enterprise)
- "Auto-Generate POS Recipes" desde PLU del TPV
- Above-store reporting con drill-down a ingredient level
- AvT por location, category, ingredient
- Alertas por umbral de varianza (±5%)

---

## 2. LAS 10 DIMENSIONES DE LA FICHA (síntesis del benchmark)

Cada referente cubre un subconjunto. Nadie cubre las 10 juntas. Folvy sí puede.

### D1 — Identidad
Nombre comercial, nombre interno cocina (kitchen_name), nombre corto (KDS/ticket),
descripción (+IA para generar), fotos (galería), categoría(s), marca, tipo (item/combo),
IDs externos (Last.app, Glovo, Uber).

**Quién lo hace mejor:** Otter (display name + internal name + AI description + preview).
**Dónde Folvy gana:** nombre interno de cocina separado del comercial (Otter lo tiene pero
sin vínculo al escandallo). Folvy cruza los tres nombres (comercial, cocina, corto) porque
controla las tres caras del producto.

### D2 — Escandallo / Receta
Ingredientes con cantidades (bruto/neto, merma), sub-recetas, pasos de preparación
(con ingredientes vinculados), rendimiento (yield_portions), tiempo prep/cocción,
temperatura, fotos por paso. Versionado con historial.

**Quién lo hace mejor:** meez (steps con fotos/videos, scaling, NLP import) + Apicbase
(sub-recipes, version control, AI recipe generation).
**Dónde Folvy gana:** pasos INTELIGENTES (E8) con ingredientes vinculados al paso, no
texto muerto. Nadie más lo tiene.

### D3 — Economía
Coste del escandallo (food cost), food cost %, PVP base (sin IVA), PVP cliente (con IVA),
margen por canal (barras visuales — diferenciador Folvy), target food cost / target margin,
alerta al superar umbral. Coste por porción + coste detallado por ingrediente.

**Quién lo hace mejor:** R365 (target margin por item) + Supy (alerts when margins at risk) +
Apicbase (financial tab con detalle por ingrediente).
**Dónde Folvy gana:** margen por canal con comisiones de plataforma (barras visuales).
Nadie más une food cost + comisión delivery + transporte en una vista del producto.

### D4 — Precios y canales
Precio base de marca, override por ubicación, override por canal, override por canal×ubicación.
Disponibilidad por canal (toggles on/off). Horarios de disponibilidad (por producto/canal).

**Quién lo hace mejor:** Otter (precios por location×channel, toggles).
**Dónde Folvy gana:** precios con margen neto integrado (Otter muestra precios, no márgenes).

### D5 — Modificadores
Grupos asignados al producto, opciones con price_impact, impacto en receta
(modifier_recipe_impact: qué cambia en el escandallo), coste del modificador calculado.

**Quién lo hace mejor:** Supy (base→sub→modifiers costeados independientemente).
**Dónde Folvy gana:** modifier_recipe_impact conectado al escandallo del plato padre.
El modifier no es solo un precio — es un cambio en la receta con impacto en coste visible.

### D6 — Alérgenos y nutrición
Alérgenos auto-calculados desde ingredientes (14 obligatorios UE), info nutricional
(per 100g y per porción), datos dietéticos (vegano, sin gluten, halal, etc.),
etiquetado obligatorio, exportación de fichas de alérgenos.

**Quién lo hace mejor:** Apicbase (databases lookup, Nutri-Score, QR, etiquetas auto) +
meez (flagging automático + nutritional databases).
**Dónde Folvy gana:** alérgenos obligatorios para hostelería española (Ley de Información
Alimentaria + normativa autonómica). Base de datos BEDCA/AESAN española integrada.

### D7 — Proveedores y compras
Ingredientes → proveedores (article_supplier), último precio, historial de precios,
formato de compra, código del proveedor, denominación del proveedor. Enlace directo
a facturas/albaranes donde se compró.

**Quién lo hace mejor:** gstock (variación de precio en OCR) + MarketMan (multi-supplier
por ingredient con packaging info).
**Dónde Folvy gana:** el enlace es bidireccional — desde el producto ves los proveedores,
desde el proveedor ves los productos. Y la factura actualiza el coste que actualiza el
margen del plato (eslabón C3.4 que ya existe).

### D8 — Ventas e inventario
Unidades vendidas (por período, por canal, por ubicación), revenue, stock actual
(por ubicación), historial de movimientos de stock, AvT (actual vs teórico).

**Quién lo hace mejor:** R365 (AvT por location/category/ingredient) + Supy (variance
reports con causa probable).
**Dónde Folvy gana:** AvT conectado al margen del plato (nadie lo hace), con
autoinventario IA que selecciona qué contar (Capa 3, futuro).

### D9 — Marcas y ubicaciones
En qué marcas participa el producto (unificación), en qué ubicaciones está activo,
estación de cocina (para KDS/impresora), ajustes location-specific.

**Quién lo hace mejor:** Supy (brand/menu/site assignment) + Otter (locations + kitchen station).
**Dónde Folvy gana:** unificación transparente — ves que "Patatas Clásicas" (Lobbers) y
"French Fries" (Smash) son el mismo artículo interno, con un solo stock y un solo pedido.

### D10 — Auditoría e histórico
Versiones del escandallo con diff visual, quién creó/modificó, historial de cambios
de precio, historial de coste, reason codes de cambios.

**Quién lo hace mejor:** Supy (version control + audit logs + 200 permisos) + meez
(version control de recetas).
**Dónde Folvy gana:** recipe_item_version ya existe en el esquema (tabla construida).

---

## 3. ARQUITECTURA DE LA FICHA FOLVY (propuesta)

### Principio rector
La ficha NO es una pantalla monolítica. Es un HUB con secciones que se llenan
progresivamente según el ciclo de vida del producto:

```
ONBOARDING (día 1)     → D1 Identidad (del importador) + D5 Modifiers (del importador)
PRIMEROS DÍAS          → D2 Escandallo (cocinero) + D6 Alérgenos (auto)
CON COMPRAS            → D7 Proveedores (de facturas/albaranes) + D3 Economía (food cost)
CON VENTAS             → D8 Ventas e inventario (del webhook) + D3 Economía (margen real)
MADURO                 → D4 Precios multi-canal + D9 Multi-marca + D10 Auditoría
```

Cada sección se muestra SIEMPRE (con su estado: "Pendiente de escandallo",
"Sin ventas aún", "Sin proveedores") — nunca se esconde. El usuario ve el
mapa completo y sabe qué le falta. Es el motor de onboarding.

### Layout (confirmado por Baymard + Otter + sesión anterior)
Secciones apiladas con índice sticky lateral (escritorio).
Las secciones avanzadas (Auditoría, Multi-marca) nacen colapsadas.

### Secciones propuestas (orden de arriba a abajo)

```
FOTO HERO + CARD IDENTIDAD (siempre visible, el ancla visual)
├── Nombre comercial · marca · categoría · precio · PVP · IVA
├── Editar · Vincular escandallo · Añadir foto
└── Estado: "Sin escandallo" / "FC 31%" / "Revisar"

ESCANDALLO                           ← D2
├── Ingredientes (recipe_lines con coste por línea)
├── Sub-recetas (si existen)
├── Pasos de preparación (E8, con ingredientes vinculados)
├── Rendimiento (yield_portions) · Merma · Tiempo prep
└── "Sin receta vinculada. Conecta el escandallo para ver costes."

ECONOMÍA                             ← D3
├── 3 metric cards: PVP · Food Cost · Mejor Margen
├── Barras de margen por canal (food cost + comisión + transporte + margen)
├── Target food cost / target margin (configurable)
└── "Configura comisiones en Ajustes para ver margen neto."

PRECIOS Y CANALES                    ← D4
├── Precio base (marca)
├── Overrides por ubicación × canal (tabla editable)
├── Disponibilidad por canal (toggles)
└── Horarios de disponibilidad

MODIFICADORES                        ← D5
├── Grupos asignados (expandibles con opciones + price_impact)
├── Impacto en receta (modifier_recipe_impact: qué cambia)
├── Coste del modificador
└── "Añadir grupo de modificadores"

ALÉRGENOS Y NUTRICIÓN                ← D6
├── Alérgenos (auto-calculados desde ingredientes)
├── Info dietética (vegano, sin gluten, halal, etc.)
├── Valores nutricionales (per 100g y per porción)
└── "Sin escandallo no se pueden calcular alérgenos."

PROVEEDORES                          ← D7
├── Ingredientes → proveedores (con último precio y formato)
├── Historial de precios
└── Enlace a facturas/albaranes

VENTAS                               ← D8
├── Unidades vendidas (periodo, canal, ubicación)
├── Revenue
├── Tendencia (gráfico sparkline)
└── "Sin ventas registradas."

MARCAS Y UBICACIONES                 ← D9 (colapsada por defecto)
├── En qué marcas participa (unificación)
├── En qué ubicaciones está activo
├── Estación de cocina (KDS)
└── "Este artículo se usa en 3 marcas."

AVANZADO                             ← D10 (colapsada por defecto)
├── Kitchen name · Short name
├── External IDs
├── Versiones del escandallo
├── Historial de cambios
├── Quién creó / modificó / cuándo
```

---

## 4. PLAN DE CONSTRUCCIÓN (fases, no todo a la vez)

### Fase B1-complete (inmediata)
Lo que ya existe: Hero + Card identidad + Economía (barras margen) + Modificadores (read-only).
Lo que se añade:
- **D1 completar:** kitchen_name, short_name editables, fotos (upload a menu-photos)
- **D4 base:** precios con overrides (tabla editable), toggles de disponibilidad
- **D5 completar:** expandir modifiers para mostrar opciones detalladas

### Fase B2 (tras escandallos)
Requiere que haya recipe_items con recipe_lines:
- **D2 escandallo:** mostrar/enlazar recipe_lines + pasos + rendimiento
- **D3 completar:** food cost real + target food cost + alertas
- **D6:** alérgenos auto-calculados desde ingredientes

### Fase B3 (tras compras)
Requiere que haya article_supplier + facturas/albaranes:
- **D7:** proveedores vinculados + historial de precios
- **D2 enriquecer:** coste por ingrediente detallado

### Fase B4 (tras ventas)
Requiere que haya sale_lines normalizadas:
- **D8:** unidades vendidas, revenue, tendencia
- **D3 enriquecer:** margen real ponderado por mix vendido

### Fase B5 (madurez)
- **D9:** multi-marca, unificación visual, estación cocina
- **D10:** versionado, auditoría, historial

---

## 5. DÓNDE FOLVY GOLEA (no empata)

| Dimensión | Lo mejor del mercado | Lo que Folvy añade |
|-----------|---------------------|--------------------|
| D3 Economía | R365 target margin + Apicbase financial tab | Barras de margen por canal con comisiones de delivery |
| D5 Modifiers | Supy costeados independientemente | modifier_recipe_impact: el modifier CAMBIA la receta, no solo el precio |
| D2 Pasos | meez fotos/videos por paso | E8 pasos inteligentes con ingredientes vinculados |
| D9 Multi-marca | Supy brand/menu/site | Unificación transparente + un solo stock + un solo pedido |
| D7 Proveedores | gstock variación precio | Factura → coste → margen del plato (eslabón C3.4) |
| D6 Alérgenos | Apicbase databases + QR | Base BEDCA/AESAN española + normativa autonómica |
| D8 AvT | R365 actual vs theoretical | AvT conectado al margen del plato + autoinventario IA |

La tesis: ningún competidor une las 10 dimensiones en una sola ficha.
Apicbase tiene D2+D3+D6 pero no D4+D5.
R365 tiene D3+D8 pero no D4+D5+D6.
Otter tiene D1+D4+D5 pero no D2+D3+D6+D7+D8.
Supy tiene D2+D5+D9 pero no D4+D6.
Folvy las tiene todas porque controla las tres caras (cocina + comercial + finanzas).
