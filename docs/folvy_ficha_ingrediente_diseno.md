# Ficha de ingrediente (artículo) — Documento de decisión

> **Fecha:** 2026-06-07 · **Autor:** Claude (sesión con Julio Gª Colón)
> **Propósito:** fijar el modelo de campos y la maqueta de la ficha de detalle de
> artículo (`recipe_item type='raw'`) ANTES de construir, al estándar visual v2
> (el de la ficha de plato: hero + secciones apiladas colapsables).
> **Base:** RECON contra BBDD real (6 verificaciones), no contra el CONTEXTO.
> Benchmark: tspoon (incumbente Llorente29), Apicbase, meez, R365, Supy, gstock.

---

## 0. Qué se verificó en la BBDD (RECON)

1. `recipe_item` — 66 columnas; `account_id` **NOT NULL**; `type` ∈ {raw, recipe, dish, tool}; `source` ∈ {manual, ai_recipe, ocr_invoice, import}; `cost_strategy` ∈ {fixed, last_purchase, average_weighted, average_window}. Tiene ya: family_id, base/purchase/stock_unit_id, is_purchasable/sellable/stockable, conservation_type, nutrition jsonb, recyclable_packaging jsonb, season_start/end, vat_category_id, indirect_cost_pct, needs_review, completeness jsonb, media jsonb.
2. `recipe_family` — árbol AECOC vía `parent_family_id` (NO vía scope); `scope` ∈ {dish, ingredient}; hoy 17 familias de ingrediente, **casi planas** (16 raíces, 1 hija). `template_id` existe pero en ingredientes va a null → NO es mecanismo master.
3. `kitchen_unit` — `account_id` **NULLABLE** + flag `is_seed` → master de unidades global ya funciona así. `dimension` + `factor_to_base` = conversión física por dimensión.
4. `recipe_item_unit_conversion` — conversiones específicas del artículo (no físicas): `from_unit_id` → `qty_in_base`, con `source`/`ai_confidence`/`needs_review`. Es el modelo compra→stock→uso.
5. `article_supplier` — N:M ingrediente×proveedor: supplier_code, supplier_item_name, last_price, is_preferred, purchase_format_id.
6. Alérgenos — `allergen` (catálogo UE 1169) + `recipe_item_allergen` con `state` (contiene/trazas/no contiene) + source + manual_reason.

---

## 1. Decisiones de modelo (cerradas en sesión)

- **Un solo catálogo `recipe_item`**, discriminado por `type` (raw/recipe/dish/tool). La ficha de este documento es la de **`raw`** (artículo de compra).
- **Alimento / packaging / limpieza NO se separan por `type`** — todos son `raw`; el split es por **familia AECOC + `vat_category`** (`no_alimentario`). Quién toca el food cost: alimento→`recipe_line`; packaging→`menu_item.packaging_cost`; limpieza→overhead vía `indirect_cost_pct`.
- **`tool`** = categoría aparte; ni escandallo ni stock perpetuo.
- **Master de ingredientes con ADOPCIÓN AL VUELO (opción 2).** El cliente NO ve un catálogo global. Al montar un escandallo y teclear "albahaca", el sistema propone desde el master y, al elegirlo, **crea la fila en su cuenta**. La lista de ingredientes solo muestra lo adoptado/en uso. Cero filas dormidas.
- **Estándar visual v2** (hero + índice sticky + secciones apiladas colapsables, las vacías ocultas/colapsadas). Sustituye al patrón antiguo de "panel navy fijo a la derecha": la verdad económica en vivo del artículo pasa a ser una **sección**.

---

## 2. Huecos de esquema declarados (deuda explícita)

| # | Hueco | Disparador / decisión |
|---|---|---|
| H1 | **No existe master de ingredientes.** `recipe_item.account_id` es NOT NULL → el master no puede ser filas con account NULL (a diferencia de `kitchen_unit`). Hace falta una **tabla `ingredient_template`** (o equivalente) global de la que nace el `recipe_item` del cliente. | Diseñar antes de la adopción al vuelo. Es el cimiento de la opción 2. |
| H2 | **`recipe_item` sin `template_id`** → no se puede rastrear "este ingrediente vino del master X". | Añadir columna `template_id` nullable al construir el master (migración + database.ts). |
| H3 | **Familias AECOC casi planas** (17, sin jerarquía real). | NO sobre-ingenierizar: el modelo soporta árbol (`parent_family_id`), pero en la práctica es 1 nivel. Sembrar AECOC en el master, no forzar 3 niveles. |
| H4 | **Descripción comercial/botánica** (tspoon la tiene) no tiene campo propio claro (`notes` es interno). | Decidir: ¿campo `description` para el master, heredable? Propuesta: sí, vive en el master (plantilla), editable por cuenta. |

---

## 3. Maqueta de la ficha — secciones al estándar v2

Orden de arriba a abajo. Las marcadas (vacía→oculta) no se muestran si no hay dato.
Cada sección indica de dónde sale el dato y si es **[M]aster** (viene de plantilla, editable) o **[C]liente** (propio de la cuenta).

### HERO (cabecera cálida)
- Foto (`kitchen_photo_url` / `media`) — botón Cambiar/Eliminar (mismo patrón que plato).
- Nombre (`name`) + familia AECOC (`family_id`, chip) + `type` + conservación (`conservation_type`).
- Estado semáforo de **utilizable** (hallazgo Apicbase): precio ✓ · unidad base ✓ · alérgenos ✓ · proveedor ✓. Tooltip "qué falta".
- Acción principal contextual.

### IDENTITY CARD
- **Coste por unidad base** en grande (`computed_cost`/`fixed_cost` + `cost_updated_at`, ⏰ si supera `cost_window_days`).
- Estrategia de coste (`cost_strategy`) + IVA (`vat_category_id`, % vigente por fecha).
- `is_purchasable` ("incluir en pedidos") · `is_stockable` · `is_sellable`.
- Botones: Editar · "Mejorar con IA" (futuro).

### S1 — Coste y uso  [verdad económica en vivo]
- Coste/unidad base + estrategia + ventana.
- **"Usado en N platos/preparaciones"** (derivado de `recipe_line`) — feature clave de tspoon a conservar.
- Última compra (fecha + precio).

### S2 — Formatos y unidades  [C, con IA enchufable]
- Unidad base del artículo.
- Conversiones de compra (`recipe_item_unit_conversion`): "1 Pack = 0,125 kg → X €/Pack". `source`/`needs_review` visibles (OCR puede proponer).

### S3 — Proveedores  (`article_supplier`)  [C]
- Tabla: proveedor · código (`supplier_code`) · nombre del proveedor (`supplier_item_name`) · formato (`purchase_format_id`) · último precio (`last_price`) · preferente (`is_preferred`).
- Variación de precio vs histórico (el "8,8%" de tspoon).

### S4 — Alérgenos  (`recipe_item_allergen` + `allergen`)  [M base, C ajusta]
- Los 14 UE con estado tri: **contiene / trazas / no contiene** (`state`). `source` (manual/ia/heredado) + `manual_reason`.
- "Verificar con IA" (futuro).

### S5 — Nutrición  (`nutrition` jsonb)  [M, /100 g]
- Valor energético, grasas (saturadas), HC (azúcares), fibra, proteínas, sal.

### S6 — Cortes y merma  (`kitchen_cut_type` + rendimiento)  [C]
- Cortes con % rendimiento → coste resultante ("Deshojada 85% → 32,66 €/kg"). El bruto sube el coste (regla coste = cantidad bruta).

### S7 — Stock  (`recipe_item_location_stock` + `stock_movement`)  [C] (vacía→oculta hasta inventario)
- Por almacén: inventario · entradas · salidas · total · coste (WAC).

### S8 — Histórico de compras  [C] (vacía→oculta)
- Últimas N recepciones/facturas + total/año.

### S9 — Conservación y temporada  [M/C]
- `conservation_type`, `shelf_life_days`, `season_start/end`, `recyclable_packaging`.

### S10 — Descripción  [M, editable por cuenta]
- Descripción comercial/botánica (ver H4).

### S11 — Avanzado  [C]
- `code`/`folvy_code`, `external_codes`, `alt_names`, `is_active`, auditoría (creado/actualizado por).

---

## 4. Master vs cliente — qué hereda la adopción al vuelo

Al adoptar un ingrediente del master, **nace en la cuenta** con (heredado [M]):
nombre, familia AECOC, unidad base, alérgenos (estado por defecto), nutrición,
descripción, conservación, temporada, reciclaje.

**NO se hereda (es [C], se rellena después):** precio, proveedores, formatos de
compra propios, cortes, stock, histórico. **El precio JAMÁS vive en el master.**

`recipe_item.source` del adoptado = `'import'` (o un valor nuevo a decidir) +
`template_id` apuntando al master (H2).

---

## 5. Orden de construcción propuesto (tramos)

1. **T1 — Master de ingredientes (esquema):** tabla `ingredient_template` global + `recipe_item.template_id` + seed AECOC + seed de ingredientes comunes ES. Migración + database.ts. (Resuelve H1, H2, H3.)
2. **T2 — Ficha de ingrediente (UI v2):** la maqueta de §3 sobre un `recipe_item` raw existente, secciones reales que ya tienen dato (coste, unidades, proveedores, alérgenos, nutrición) + empty states honestos para stock/histórico.
3. **T3 — Adopción al vuelo:** el buscador que propone desde el master y crea la fila al elegir (se enchufa al editor de escandallo, P3 núcleo).

> Nota: T2 puede construirse ANTES que T1 si se quiere ver la ficha ya (sobre los
> ingredientes que el cliente cree a mano), porque la ficha no depende del master.
> El master (T1) es lo que acelera el alta, no lo que la habilita.
