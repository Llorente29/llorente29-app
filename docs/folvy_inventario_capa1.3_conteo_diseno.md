# Folvy Inventario — Sub-tramo 1.3: el conteo
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
El corazón de la capa 1: crear un conteo, generar su hoja secuenciada por área,
contar a ciegas (blind) en pantalla, y calcular la variación de cada línea contra
la tolerancia ABC. NO escribe ajustes todavía (eso es 1.4) — aquí se cuenta y se
diagnostica. Equivale al shelf-to-sheet de MarketMan/Crunchtime + blind count.

## RECON (confirmado)
- `recipe_item_location_stock`: qty_on_hand (saldo), avg_unit_cost (coste) por item/local.
- `recipe_item.base_unit_id` → kitchen_unit.abbreviation (unidad de conteo: g, ml, ud).
- Modelo 1.1 ya tiene: inventory_count (kind/status/blind), inventory_count_line
  (system_qty, counted_qty, variance_*, abc_class, within_tolerance, reason_code, recount_of).
- Tolerancias en supply_settings: tol_a_pct (2), tol_b_pct (3), tol_c_pct (5).
- storage_area + recipe_item_storage_area (1.2): el "hogar" y el orden de recorrido.

## Flujo
### 1. Crear conteo (elegir alcance)
- Eliges local + alcance:
  - **Por áreas**: una o varias áreas → se cuentan los artículos asignados a ellas.
  - **Completo del local**: todos los artículos con stock o asignados a alguna área.
  - (El alcance "IA elige" es N2, capa 3 — aquí se elige a mano.)
- kind: 'cycle' (por defecto) | 'audit' | 'full'. blind: true por defecto.
- Al crear → `build_inventory_count(count_id, scope)` genera las líneas:
  - una por artículo en alcance, con su storage_area_id y position (orden área+artículo),
  - **system_qty = snapshot de qty_on_hand** (congelado en ese instante),
  - abc_class: provisional por valor de stock (qty×coste) — A/B/C por percentil simple, o
    NULL si no hay dato (se afina en N2). counted_qty = NULL (nace vacío).

### 2. Contar (blind, secuenciado por área)
- La hoja se muestra agrupada por área en el orden físico (position). Dentro, artículos por position.
- Cada línea: nombre + unidad de conteo (g/ml/ud) + casilla counted_qty VACÍA.
- **Blind**: NO se muestra system_qty (anti-sesgo). Solo se teclea lo contado.
- Se puede guardar progresivamente (status 'contando'). Botón "Cerrar conteo" cuando acabas.
- (Conteo simultáneo por varias personas / offline = mejora futura; ahora un contador, online.)

### 3. Calcular variación (al cerrar → status 'en_revision')
- Función `close_inventory_count(count_id)`: por línea con counted_qty no NULL:
  - variance_qty = counted_qty − system_qty
  - variance_pct = variance_qty / system_qty × 100 (si system_qty>0)
  - variance_value = variance_qty × avg_unit_cost (efecto económico en €)
  - within_tolerance = |variance_pct| ≤ tolerancia de su abc_class (de supply_settings)
- Líneas sin contar quedan marcadas (no se ajustan en 1.4).
- Devuelve resumen: n total, n OK (dentro tol.), n fuera tol., n sin contar, efecto € total.

### 4. Revisar (pantalla de revisión)
- Tras cerrar, la pantalla muestra las líneas con su system_qty YA visible (ya se contó:
  el blind solo aplica durante el conteo), counted, variación, % y € con color
  (verde dentro tol., ámbar/rojo fuera). Las fuera de tolerancia piden reason_code.
- Opción RECUENTO de una línea (1.4 lo cierra): crea línea recount_of con primer valor enmascarado.
- (La APROBACIÓN → ajuste en el ledger es 1.4.)

## Funciones SQL (1.3)
- `build_inventory_count(p_count_id uuid, p_area_ids uuid[], p_full boolean)` SECURITY DEFINER:
  genera las líneas + snapshot. Se ejecuta desde la app.
- `close_inventory_count(p_count_id uuid)` SECURITY DEFINER: calcula variación/tolerancia/€,
  pasa status a 'en_revision', devuelve resumen. Idempotente (recalculable).
- (apply_inventory_count → 1.4.)

## Servicio + UI (1.3)
- inventoryCountService.ts: createCount, buildCount(rpc), getCountWithLines, saveCountedQty
  (guardado progresivo), closeCount(rpc), listCounts.
- En InventoryPage: nueva vista 'counts' (lista de conteos del local) + 'count' (la hoja de
  conteo, agrupada por área, blind) + 'review' (revisión tras cerrar). Botón "Nuevo conteo".

## Decisiones (con recomendación)
1. abc_class provisional por valor de stock (qty×coste) en build; el ABC fino (rotación,
   anomalías) llega con N2. Si no hay coste, NULL → usa tolerancia 'C' (la más laxa). (Rec.)
2. Alcance por áreas o completo en 1.3; "IA elige qué/quién" es N2. (Rec.)
3. Blind solo durante el conteo; en revisión ya se ve todo (necesario para decidir). (Rec.)
4. Guardado progresivo (status 'contando') para no perder trabajo en conteos largos. (Rec.)
5. counted_qty se teclea en unidad BASE (g/ml/ud). Conversión a formato de compra = mejora
   futura (contar "2 sacos" en vez de "10000 g"); ahora unidad base, simple y exacto. (Rec.)

## Esquema
- Ninguno nuevo (el modelo 1.1 ya tiene todo). Solo funciones build_/close_.

## Fuera de 1.3 (siguientes)
- 1.4: aprobación → ajuste en stock_movement + recompute + reason codes obligatorios.
- N2 (capa 3): selección IA de qué/quién, análisis y comunicación automática, efecto vs escandallo.
- N3 (capa 4): auditoría de cierre de período + AvT.
