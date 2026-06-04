# Folvy Inventario — Capa 1: motor de conteo + ajuste
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
La fundación del inventario perpetuo. El motor de conteo del que cuelgan el autoinventario
(N2) y la auditoría de cierre (N3): cambian QUÉ se cuenta y CADA CUÁNTO, pero el motor es este.
Convierte un conteo físico en un ajuste del saldo, con disciplina de auditoría (blind count,
tolerancias, aprobación, motivo). Iguala el shelf-to-sheet de MarketMan/Crunchtime/NetSuite.

## RECON (confirmado)
- NO existe nada de storage areas / conteos / ajustes → se construye de cero.
- Ledger listo: `stock_movement` (qty_base con signo, movement_type incl. 'recuento'/'ajuste',
  source_type incl. 'inventory_count'/'adjustment', lote, caducidad, unit_cost) +
  `recipe_item_location_stock` (qty_on_hand, avg_unit_cost, stock_value) + `recompute_location_stock`.
- Umbral por cuenta: patrón `supply_settings` reutilizable para tolerancias.

## Modelo nuevo (mínimo)
### `storage_area` — el "hogar" de los artículos (por local)
account_id, id, location_id, name ('Cámara', 'Seco', 'Barra', 'Congelador'…), position (orden
físico de recorrido), active, created_*. RLS belongs_to_account.

### `recipe_item_storage_area` — asignación artículo↔área (N:M con orden)
account_id, id, recipe_item_id, storage_area_id, position (orden dentro del área). Un artículo
puede estar en varias áreas (estándar MarketMan). La hoja de conteo se secuencia por
área.position + línea.position → contar rápido, no se olvida nada.

### `inventory_count` — la cabecera del conteo (la "hoja")
account_id, id, location_id, code (INV-00001 correlativo, patrón next_*_code), kind
('cycle'|'audit'|'full' — N2/N3/cierre), status ('abierto'|'contando'|'en_revision'|
'aprobado'|'anulado'), blind (boolean, default true), started_at/by/by_name, closed_at,
approved_at/by/by_name, notes, created_*. RLS belongs_to_account.

### `inventory_count_line` — una línea por artículo a contar
account_id, id, inventory_count_id, recipe_item_id, storage_area_id (de qué área), position,
system_qty (saldo del sistema al iniciar, SNAPSHOT; en blind NO se muestra al contador),
counted_qty (lo que cuenta, nace NULL/vacío), variance_qty (counted−system, calculado),
variance_pct, variance_value (€), abc_class ('A'|'B'|'C'), within_tolerance (boolean),
reason_code (merma|caducado|rotura|robo_desconocido|error_escandallo|error_recepcion|
traspaso|otro, NULL si OK), recount_of (id de la línea original si es recuento), counted_by_name.

## Flujo (el "cómo" = disciplina de auditoría)
1. **Crear conteo:** eliges local + alcance (todas las áreas, unas áreas, o lista de artículos).
   Se generan líneas y se congela system_qty (snapshot). blind=true por defecto.
2. **Contar (móvil, blind):** la hoja sale secuenciada por área. counted_qty nace VACÍO; NO se
   muestra system_qty (anti-sesgo). Varias personas pueden contar (por área). Se puede contar
   por equipo. (Online; offline = mejora futura.)
3. **Revisar variaciones:** al cerrar el conteo, por línea se calcula variance y se compara con
   la TOLERANCIA por clase ABC (de supply_settings: tol_a_pct ~2, tol_b_pct ~3, tol_c_pct ~5).
   - dentro de tolerancia → OK, autoajustable.
   - fuera de tolerancia → marca discrepancia; pide reason_code; opción de RECUENTO (nueva línea
     recount_of, primer resultado enmascarado).
   Resumen: "12 OK · 3 fuera de tolerancia · 2 sin contar". Efecto económico total en €.
4. **Aprobar → ajuste:** al aprobar (gating por rol, reutiliza patrón de aprobación de C3.5 o
   manager), por cada línea con variación se escribe UN movimiento `ajuste` en stock_movement
   (qty_base = variance con signo, source_type='inventory_count', source_id=línea, motivo en
   notes) → dispara recompute → el saldo queda alineado con la realidad. Nada se ajusta sin
   aprobación + motivo. Audit trail completo.

## Funciones SQL
- `next_inventory_count_code` + trigger (patrón FAC-/PED-).
- `build_inventory_count(count_id)` o al crear: generar líneas + snapshot system_qty desde
  recipe_item_location_stock. (SECURITY DEFINER, se ejecuta desde app.)
- `apply_inventory_count(count_id)` SECURITY DEFINER: por línea con variación, inserta ajuste en
  stock_movement + recompute. Idempotente. Devuelve resumen (n ajustes, efecto € total). Se
  ejecuta DESDE LA APP (recompute usa auth).
- Cálculo de variance/abc/tolerancia: en la función de cierre o en `run` dedicado.

## Decisiones (con recomendación)
1. blind=true por defecto, configurable por conteo (auditoría siempre blind; cycle también). (Rec.)
2. Tolerancias por ABC en supply_settings (tol_a/b/c_pct), no fijas en código. ABC se calcula por
   valor de consumo (stock_value o coste×rotación). Capa 1: abc_class manual o por stock_value;
   el cálculo fino ABC vive con el autoinventario (N2). (Rec.)
3. Aprobación → ajuste en bloque (un movimiento por línea con variación), no línea a línea. (Rec.)
4. storage_area opcional: si el cliente no define áreas, la hoja sale por familia o alfabética
   (no bloquea). Áreas = mejora de comodidad, no requisito. (Rec.)
5. reason_code obligatorio solo en líneas fuera de tolerancia; dentro de tolerancia, opcional. (Rec.)
6. Conteo por artículos sueltos o por áreas; "full" = todas las áreas del local. El kind
   (cycle/audit/full) es etiqueta + comportamiento de tolerancia, mismo motor. (Rec.)

## Esquema
- Nuevas: `storage_area`, `recipe_item_storage_area`, `inventory_count`, `inventory_count_line`.
- Funciones: `next_inventory_count_code`, `apply_inventory_count` (+ build/cierre).
- supply_settings: añadir tol_a_pct/tol_b_pct/tol_c_pct (default 2/3/5).

## Lo que NO entra en capa 1 (capas siguientes)
- Selección IA de qué/quién (N2, capa 3). Aquí el alcance se elige a mano.
- Cierre de período + AvT (N3, capa 4) — la auditoría 'audit'/'full' ya deja el dato listo.
- Consumo por ventas (capa 2) — las salidas automáticas.
- FEFO + portal del trabajador (capa 5).

## Diferencial vs benchmark
Igual que MarketMan/Crunchtime en shelf-to-sheet + blind, pero con: tolerancias ABC nativas,
efecto económico en € desde el primer conteo, reason codes que alimentarán el análisis IA, y
todo enchufado al saldo perpetuo + margen del plato.
