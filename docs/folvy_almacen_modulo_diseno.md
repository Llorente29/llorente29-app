# Folvy — Módulo Almacén / Zonas (el cuerpo de gestión)

**Frente "almacenes" del guion vivo · diseño para construir.**
Estado: aprobado pieza a pieza por Julio (17/06/2026). **No se ha tocado código.**
RECON (BBDD + repo) + benchmark web (MarketMan, WISK, NetSuite, WMS slotting) completos.
Método de este frente: **cada paso, su visual antes de construir; nada se construye sin visto bueno sobre el dibujo.**

---

## 0. Qué es y qué NO es

Es el **cuerpo de gestión de almacén** que faltaba debajo del motor de inventario. El motor
(conteo, consumo teórico, merma, apertura, autoinventario IA A1–A4) está vivo y **no se toca**;
lo que falta es la gestión básica de zonas sobre la que ese motor se apoya. Diagnóstico de Julio
(16/06): *"hacemos muy bien el autoinventario pero poco más"* — la joya antes que el chasis.

El RECON lo cuantificó: **5 de 6 locales con 0–1 zona**; Folvy Interno/Alcalá con un árbol de 13
zonas y **0 ítems dentro** (la prueba de que hoy *crear zonas* y *poblarlas* van sueltos). En
producción, ningún local es contable salvo con el atajo "conteo completo" que ignora zonas.

**NO es** un rediseño del motor de coste/consumo/conteo/merma (sanos). **NO** valora stock por
almacén (ver §1). **NO** añade selector manual de local. **NO** toca `App.tsx`.

> Nota de vocabulario: la tabla es `storage_area`; la etiqueta de producto es **"zona"** (más de
> cocina que "almacén/ubicación"). Tabla y etiqueta pueden diferir.

---

## 1. La bisagra (decisión cerrada): stock por LOCAL, zona organizativa

**Decisión:** el saldo valorado se queda **por local** (`recipe_item_location_stock`, ya vivo);
la **zona** sube a entidad de primer nivel para tres cosas: ordenar el conteo (shelf-to-sheet),
dar el **status de cobertura**, y semántica (conservación → futuro FEFO/APPCC). **No** copiamos a
tspoon (saldo por almacén).

- **Mover entre zonas dentro de un local = reasignar el hogar** (cero fricción, no es evento de valor).
- **El movimiento de valor real solo ocurre entre LOCALES** (capa F: central → punto), fuera de este frente.
- **El € por zona SÍ se enseña**, como **vista derivada**: `SUM(stock_value)` de los artículos
  cuya zona principal es esa. No requiere ledger por zona.

**Por qué golea, no empata:** tspoon confunde "dónde está" con "cuánto vale" → le obliga a inventar
un traspaso por cada movimiento físico y a **adivinar de qué almacén descuenta una venta del POS**
(imposible). Folvy da las mismas vistas (stock por zona, desviación por zona en el conteo —ya
derivable porque `inventory_count_line` lleva `storage_area_id`—) **sin** ese lastre.

**Multi-zona (decisión cerrada):** un artículo puede estar en varias zonas (el esquema ya lo
soporta: `recipe_item_storage_area UNIQUE(recipe_item_id, storage_area_id)`). Consecuencias:
- En el **conteo** genera **una línea por zona**, que se **suman** (correcto: se cuenta en cada sitio).
- El **€ se imputa a la ZONA PRINCIPAL** (la de menor `position`); las demás muestran el artículo
  con € en gris/0. Así `Σ(€ por zona) = € total del local`, sin doble conteo. *(Confirmado por Julio.)*

---

## 2. Estado del área (RECON contra BBDD + repo)

**Tablas que existen** (`storage`/`stock`/`inventory`): `storage_area` (jerárquica, `parent_id`
self-ref), `recipe_item_storage_area` (N:M con `position`, `UNIQUE(recipe_item_id, storage_area_id)`),
`recipe_item_location_stock` (`qty_on_hand`, `avg_unit_cost`, `stock_value`, `UNIQUE(recipe_item_id, location_id)`),
`stock_movement`, `stock_waste`, `inventory_count`, `inventory_count_line`.

**Funciones que existen:** `apply_inventory_count` (v3, 14/06), `build_inventory_count`,
`close_inventory_count`, `autoinventory_queue`, `register_waste`, `recompute_location_stock_core`, etc.

**Superficie UI hoy** (auditoría del repo): pestañas sueltas en `src/modules/supply/` —
`pages/InventoryPage.tsx` + `AutoInventorySection`/`InventoryCountSheet`/`WasteSection` +
servicios `storageAreaService`, `inventoryCountService`, `autoinventoryService`, `wasteService`.
**No existe módulo propio.** (Justifica AL4.)

**Lo que falta en esquema:**
- **Máx/mín NO existe** en ninguna tabla → sin él no hay To-Par ni alarma de bajo stock. (AL2)
- `storage_area` **no distingue zona de subzona por tipo** ni guarda **conservación**. (AL2)

**Causa raíz confirmada del "0 líneas en frío":** en `build_inventory_count`, la cláusula
`p_area_ids IS NULL AND p_full = false AND sa.id IS NOT NULL` → en modo normal solo entran ítems
**con zona asignada**. Cuenta nueva = 0 zonas = 0 líneas. AL1 (colocar huérfanos) + AL3 (seed) lo
eliminan de raíz; mientras tanto el atajo es `p_full = true`.

**Cuentas (RECON 17/06):**

| Cuenta · local | zonas | colocados | huérfanos |
|---|---|---|---|
| Llorente29 · Alcalá | 1 | 28 | 129 |
| Llorente29 · Carabanchel | 0 | 0 | 71 |
| Llorente29 · Plaza Castilla | 0 | 0 | 85 |
| Folvy Interno · Alcalá | 13 | 0 | 105 |

---

## 3. Benchmark (web, 17/06) — dónde igualamos, dónde goleamos

**Igualamos (base obligatoria, lo hacen todos):** MarketMan/WISK usan zonas como "hogar", multi-zona
que se suma en el conteo, **asignación en bloque** y shelf-to-sheet. WISK enseña stock por zona "al
instante". Nada de AL1 es lujo: es el listón de entrada.

**Goleamos (nadie en hostelería lo tiene):**
1. **Auto-colocación por capas** (AL3): master + seed + afinidad de familia + IA. Los WMS industriales
   hacen *directed putaway / AI slotting*, pero opaco y de fábrica; Folvy lo trae a un cocinero,
   **explicado** ("IA propone, humano decide"). A 1.000 artículos, colocar a mano es el muro donde
   se atascan los demás.
2. **Status de cobertura con huérfanos por valor**: a escala, sin esa señal no sabes qué falta por
   colocar ni qué importa.

**Ideas robadas e incorporadas:** orden de huérfanos por **valor × rotación** (del *putaway*: empezar
por lo que más mueve); **slotting por afinidad** (nuevo ítem hereda la zona de sus hermanos de familia);
**conservación por defecto en el master** (WISK gana el alta con catálogo precargado). Aparcadas:
par dinámico, básculas Bluetooth, slotting por velocidad, tercer nivel zona→estante→artículo
(sobre-ingeniería SMB; nos quedamos en dos niveles).

---

## 4. El módulo por tramos (AL1–AL4)

Cada tramo es completo y usable solo; el siguiente enchufa sin reescribir (principio MRP II).
Marcado: ✅ hecho · 🟡 media pieza · 🔴 a construir.

| Tramo | Qué es | Estado |
|---|---|---|
| **AL1** | Status de cobertura + gestión de zonas (vivas) + asignación en bloque + navegación | 🔴 (frente activo) |
| **AL2** | Semántica zona/subzona + conservación + máx/mín (par) | 🔴 |
| **AL3** | IA propone zona + seed del árbol al alta + afinidad de familia + conservación al master | 🔴 |
| **AL4** | Módulo propio (tipo tspoon) + entrada directa / establecer cantidad / mover + Excel | 🔴 |

**Orden:** AL1 primero — hoy producción es **incontable** y es lo que más mueve la aguja.

---

## 5. AL1 al detalle (aprobado pieza a pieza)

Pantalla "Almacén · zonas" de un local. Universo honesto = **raw activos del local**
(`recipe_item.type='raw' AND is_active`), el mismo denominador que usa el conteo.

### 5.1 Status de cobertura
Cabecera con KPIs (gemelo del badge sin-coste): **raw activos · colocados · sin zona · valor en
stock**, y barra de % colocado. Es la señal que hace el arranque en frío soportable y que, a escala,
dice qué falta por colocar.

### 5.2 Zonas con preview adaptativo
Lista de zonas. **En reposo, cada zona muestra sus ~5 artículos de más valor** (coherente con "lo que
mueve dinero, primero"):
- Si la zona tiene **≤5**, los muestra todos → quien tiene pocos **no necesita buscador**.
- Si tiene **más**, un botón **"Ver los N"** abre la **lista completa**: buscador + subzonas + lista
  paginada/virtualizada; **"Ver menos"** vuelve al preview.

La **vista general** son los previews de todas las zonas (≈15 zonas × 5 = ~75 filas, scroll normal).
Opción (no defecto): colapsar del todo una zona para una vista más densa.

### 5.3 € por zona y conservación
Cada zona muestra su **nº de artículos** y su **€** (suma de los que la tienen como zona principal).
*(El chip de conservación de la zona es AL2; en AL1 la zona se muestra por nombre.)*

### 5.4 Huérfanos y asignación en bloque
Bucket **"Sin zona"** destacado, **ordenado por valor × rotación**. **Asignación en bloque:**
seleccionar varios → panel "Asignar a zona":
- **Modo añadir / reemplazar** (para huérfanos da igual; importa al reasignar).
- **Marcar una o varias zonas** (varias = multi-zona; quedan en todas).
- Si varias → **elegir zona principal** (la que lleva el €).
- Pie con la consecuencia: salen de "Sin zona"; en el conteo cada zona se cuenta y se suma; el valor va a la principal.
- **Filtros + "seleccionar todo el filtro"** (familia/conservación/buscador) para colocar por tandas
  de familia, no de uno en uno.

### 5.5 Navegación de dos niveles (nada estático)
Cada fila —en preview o en la lista completa— abre una **vista rápida (peek lateral)** con lo esencial
(coste/ud, stock, zonas, estado, conservación) **sin salir** de la lista. Dentro, **"Ver ficha completa"**
salta a la ficha de Kitchen (`KitchenItemDetailPage`) y "volver" regresa. **Requiere cablear la
navegación Almacén↔Kitchen** (el patrón lista+detalle ya apuntado como idea). No se duplica la ficha.

### 5.6 Condiciones de escala (1.000 artículos) — diseño, no deuda
Las zonas **no crecen** con los artículos (~15 zonas para 1.000), así que el esquema convierte 1.000
sueltos en ~15 cajones navegables. Para que aguante:
1. **Buscador + paginación/virtualización** en la lista de artículos de una zona (no pintar 312 de golpe).
2. **Subzonas** (`parent_id`) para partir zonas grandes (Seco → Estante A/B/Cámara).
3. **Filtros + "seleccionar todo el filtro"** en la asignación en bloque.

> A 1.000 nadie cuenta los 1.000 a diario: el día a día es el autoinventario IA (cobertura) y el
> conteo completo es de cierre. El esquema lo soporta porque ambos son el mismo motor.

### 5.7 Decisiones cerradas
- Stock por **local**; zona organiza + cobertura + semántica; **€ por zona = vista** (a la principal).
- Multi-zona: **N líneas de conteo que se suman**; **€ a la zona principal** (`position` mínima); las demás en gris.
- Preview adaptativo: reposo = top 5 por valor; ≤5 = todos; >5 = "Ver los N" → completa + "Ver menos".
- Huérfanos por **valor × rotación**.
- Navegación: fila → **peek** → **ficha completa de Kitchen** → volver.
- Escala: buscador+paginación, subzonas, filtros+seleccionar-todo en bloque.

### 5.8 Esquema y RECON puntual antes de construir
- **Esquema nuevo en AL1: ninguno.** Usa `storage_area`, `recipe_item_storage_area` (`position` =
  principal cuando es 0), `recipe_item_location_stock`, `recipe_item`. La "zona principal" se resuelve
  con `position`, sin columna nueva.
- **Backend a construir:** RPC de **cobertura** (`storage_coverage(location)` → por zona: count + €
  a principal + huérfanos) y de **asignación en bloque** (`assign_items_to_zones(item_ids[], zone_ids[],
  primary_zone_id, mode)`), ambas `SECURITY DEFINER` con guard, verificadas desde la app (no en SQL Editor).
- **RECON puntual al pedir ficheros:** firmas reales de `storageAreaService.ts` / `inventoryCountService.ts`,
  cómo `InventoryPage` monta las pestañas, y el patrón de navegación a `KitchenItemDetailPage` para reusarlo.

---

## 6. AL2 — semántica + máx/mín (esbozo)
- `storage_area`: tipo **zona|subzona** (derivado de profundidad) + **conservación** curada
  (ambiente/refrigerado/congelado/seco/limpieza/packaging/bebida). No campos a medida.
- `recipe_item_location_stock`: **`par_min` / `par_max`** (su casa natural, una fila por ítem×local).
  Habilita To-Par (modo del pedido) y alarma de bajo stock.
- La **conservación es la columna que une master ↔ familia ↔ zona** (ver AL3) → fijar su taxonomía aquí.

## 7. AL3 — IA propone zona + seed + afinidad (esbozo)
El arranque en frío se mata **por capas** (cada una reduce lo que cae a la siguiente):
1. **Master + seed:** `ingredient_template` con **conservación por defecto**; al alta de cuenta
   (gemelo de `seed_appcc_for_account`) se siembran el **árbol de familias AECOC** y el **árbol de
   zonas por defecto**; los ítems adoptados caen **ya clasificados y ubicados**.
2. **Afinidad de familia:** ítem nuevo **hereda la zona de sus hermanos** de familia.
3. **IA propone zona:** solo lo desconocido; propone, el humano confirma.
4. **Cocinero:** casi nada llega a decidir.

**Secuencia:** AL3 construye la **maquinaria** (seed de zonas+familias, conservación en master, afinidad)
sobre el master que haya hoy. **No se bloquea** en la "lista grande" AECOC de miles de ítems (sesión
dedicada aparte); el master **crece con efecto red** (atributos intrínsecos que un cliente corrige —
incl. conservación — suben al master con consentimiento + curación; lo económico nunca sube). Eso bate
a una base de millones estática: la nuestra aprende.

## 8. AL4 — módulo propio + entrada/mover (esbozo)
- Promover de "pestañas en Supply" a **módulo propio** (se registra en `moduleRegistry.ts`, **no toca
  `App.tsx`**), tipo tspoon: zonas+subzonas, teórico vs real + desviación, histórico por producto.
- **Entrada directa / establecer cantidad** (ya soportado por `stock_movement` ajuste/apertura, falta UI).
- **Mover entre zonas** = reasignación (según §1), no movimiento de valor.
- Atajos robados: **import/export Excel** de la hoja y **poner a cero en bloque** los no contados.
- Traspasos entre **locales** (capa F) siguen como frente aparte.

---

## 9. Contención (lo que NO toca este frente)
- No toca los motores de coste, consumo teórico, conteo, merma ni autoinventario (sanos).
- No añade selector manual de local (sale del contexto de sesión — deuda conocida).
- **No toca `App.tsx`** sin permiso explícito.
- Antes de CADA tramo: RECON puntual de tablas/funciones que toca + benchmark de la pieza.

## 10. Deuda relacionada (declarada, no de este frente)
- Versionar `apply_inventory_count` v3 en `supabase/migrations/` (vive solo en BBDD).
- `build_inventory_count` aún rellena `system_qty` (ya no se usa) y filtra `sa.id IS NOT NULL` (causa
  del 0-en-frío que AL1+AL3 resuelven).
- Regenerar `database.ts` tras cualquier cambio de esquema (AL2 en adelante).
