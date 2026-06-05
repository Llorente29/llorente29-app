# Folvy — Pantalla de Catálogo de Marca (diseño)
## Folvy Kitchen → "Carta" / "Catálogo"

**Fecha:** 5 junio 2026
**Estado:** DISEÑO PARA APROBACIÓN — no construir hasta visto bueno
**Ubicación en la app:** Folvy Kitchen (el catálogo es el esqueleto sobre el que se construyen los escandallos)
**Datos:** ya en BBDD (151 productos + 17 combos + 43 grupos + 160 opciones + 247 slot_options, importados de Last.app)

---

## 1. Benchmark (lo investigado)

| Plataforma | Qué hace bien | Qué le falta |
|---|---|---|
| **Otter** | Navegación por pestañas (Categorías/Items/Modifiers/Grupos/Horas/Fotos/Pricing), preview en vivo del lado cliente, lista rica (foto+nombre+"contiene N grupos"+canales+precio como rango), filtros Ubicación×Canal | NO sabe el coste (no tiene escandallo) → no muestra margen ni food cost |
| **Supy** | Dashboard menu engineering que agrega coste+ingreso a nivel padre **con modifiers incluidos** (expandes y ves desglose); recetas por marca; parent-child (base costeada una vez, heredada) | Es más backoffice que carta visual |
| **R365** | "Concatenation" (modifier con precio → su propia receta para depleción exacta); item record con Cost·Price·Target Margin; matriz Stars/Puzzles/Plowhorses/Dogs | Setup pesado, orientado a contable |
| **Apicbase** | Pestaña "Financial" por receta; food cost por porción; aviso de items bajo margen objetivo | UI corporativa, no de cocina rápida |

**Donde Folvy GANA (no empata):** fusiona usabilidad Otter + inteligencia de coste Supy/R365/Apicbase, y añade lo que ninguno tiene junto:
- **KPI de cobertura de escandallo** (motor de onboarding: "0 de 168 productos costeados")
- **needs_review** transparente (IA propone, humano decide)
- Visión transversal carta+APPCC+ventas (memoria Folvy)
- Pensado para que lo use un cocinero, no un contable

---

## 2. Estructura de la pantalla

### 2.1 Cabecera
```
[Selector de marca ▾]   Milanesa House
KPI: 168 productos · 0 con escandallo (0%)  [barra de progreso]
     [Solo sin escandallo] [Solo agotados] [buscar...]
```
El selector de marca lista solo las marcas con catálogo (9). El KPI de cobertura es el gancho: arranca en 0% y sube según se rellenan escandallos.

### 2.2 Cuerpo — productos por categoría (estilo Otter, enriquecido)
```
🍽️ MILANESAS XL (AL PLATO)
┌──────────────────────────────────────────────────────────────┐
│ [foto] The Heritage Classic        16,90 €   ● Sin escandallo │
│        Mila Clásica · 1 grupo modif.          [Crear escandallo]│
│        chips: "Escoge la base"                                 │
├──────────────────────────────────────────────────────────────┤
│ [foto] The Big Napo                16,90 €   ✓ Escandallo OK   │
│        coste 4,12 € · margen 12,78 € · FC 24%  [Ver ficha]     │
└──────────────────────────────────────────────────────────────┘
```
Cada fila: foto, nombre, precio, **estado de escandallo** (el diferenciador):
- `● Sin escandallo` → botón "Crear escandallo" (lleva al editor Kitchen ya existente)
- `✓ Escandallo OK` → muestra coste · margen · food cost % (de la función SQL `menu_item_economics`)
- `⚠ needs_review` → si el coste está marcado para revisar
- chips de modifiers que tiene; badge "agotado" si is_available=false

### 2.3 Sección COMBOS (estilo expandible Supy)
```
🍱 COMBOS
┌──────────────────────────────────────────────────────────────┐
│ ▸ The Full Experience              26,90 €   [4 slots]        │
│   (expandir) → Elige tu Milanesa · Escoge Base · Bebida · Postre│
│   coste estimado = Σ slots elegidos (cuando haya escandallos)  │
└──────────────────────────────────────────────────────────────┘
```
El combo no tiene escandallo propio; su coste se calcula por suma de slots (cuando los componentes tengan escandallo).

### 2.4 Detalle de producto (al pinchar — estilo Otter + coste)
Pestañas: **Datos · Modificadores · Escandallo · Economía · Disponibilidad**
- **Datos:** nombre, nombre interno (kitchen_name), descripción, foto, categoría, precio
- **Modificadores:** los grupos asignados, con sus opciones y price_impact (read-only v1)
- **Escandallo:** el editor Kitchen existente (crear/editar receta)
- **Economía:** coste · PVP · margen · food cost % · target (de menu_item_economics)
- **Disponibilidad:** is_available por ahora; variantes canal×ubicación = Fase B

---

## 3. Alcance v1 vs futuro (deuda explícita)

**v1 (este tramo):**
- Pantalla read-only del catálogo importado: marca → categorías → productos + combos
- Estado de escandallo por producto (sin/ok/review) + KPI de cobertura
- Economía donde haya escandallo (vía menu_item_economics existente)
- Navegación a crear/ver escandallo (reusa editor Kitchen)
- Combos expandibles con sus slots

**Fase B (siguiente):**
- Edición del catálogo en Folvy (CRUD productos/modifiers/combos)
- Variantes por canal×ubicación (menu_item_override) — precios distintos Glovo/Uber/sala
- Definir modifier_recipe_impact (qué cambia cada opción en la receta)
- Publicación a canales (push a Glovo/Uber/JustEat)

**Fase C:**
- Dashboard menu engineering (Stars/Puzzles/Plowhorses/Dogs) con sales-mix real
- Margen ponderado por mix vendido (vía sale_line normalizada)
- Sincronización viva (catalog:updated) + alarmas de disponibilidad

---

## 4. Componentes y servicios a construir (v1)

**Servicios de lectura (nuevos):**
- `catalogService.ts`: listar marcas con catálogo; listar categorías+productos por marca; listar combos+slots; estado de escandallo por menu_item (recipe_item_id null = sin escandallo)
- Reusar `getMenuItemEconomics(brandId)` existente para coste/margen

**Componentes (nuevos):**
- `BrandCatalogPage.tsx` — página principal (selector marca + KPI + listas)
- `CatalogCategorySection.tsx` — categoría con sus productos
- `CatalogProductRow.tsx` — fila de producto con estado escandallo
- `CatalogComboCard.tsx` — combo expandible con slots
- `CatalogProductDetail.tsx` — detalle con pestañas

**Navegación:**
- Añadir entrada "Carta" o "Catálogo" en el menú de Folvy Kitchen
- (requiere ver cómo está montada la navegación de Kitchen — pendiente)

---

## 5. Lo que NO se toca en v1
- App.tsx (sin permiso explícito)
- El editor de escandallos Kitchen (se reusa tal cual)
- La función menu_item_economics (se reusa)
- El esquema (ya está completo)

---

*Diseño para aprobación. Tras visto bueno: ver navegación de Kitchen → construir servicios → componentes → integrar.*
