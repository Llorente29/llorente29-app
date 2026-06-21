# Folvy · Disponibilidad (86) — diseño para aprobar

> Estado: **DISEÑO EN PAPEL** (no construido). Pendiente de OK de Julio antes de tocar código.
> Fecha: 2026-06-21. Frente: 86 / disponibilidad de producto.
> Regla viva: NADA se prueba sobre la cuenta del cliente; las pruebas van a **Folvy Interno** (sandbox).

---

## 0. Por qué este documento existe (lección del 21/06)

La Fase 1 del 86 (RPC `set_product_availability` + despachador `availability-dispatch` + toggle en ficha) se
construyó y se probó **en producción real (Llorente29) sin red de seguridad**, y resultó que:

1. Apaga en **todos los locales a la vez** (el `is_available` es a nivel marca, sin dimensión de local).
   Eso no vale: **cada local tiene su stock**.
2. No había confirmación seria de "esto apaga AHORA en producción".
3. La navegación (ficha enterrada) no es operativa para el día a día.

Este rediseño cierra los tres. Lo ya construido **se conserva** (RPC, despachador, espejo por local del paso 0)
y se le añade la dimensión de local + seguridad + las pantallas operativas.

---

## 1. Benchmark (deuda-0, qué hacen los mejores)

| Producto | Dónde vive el 86 | Granularidad | Patrón a robar |
|---|---|---|---|
| **Otter** | dentro de **Menús** (no en pedidos); 86 rápido en app móvil aparte (Otter Go) | por item, **contador "no disponible en N ubicaciones"**, sub-pestaña "No disponibles" | **3 estados**: disponible / agotado hoy (reactiva solo a medianoche) / agotado indefinido; lista filtrada de agotados |
| **Deliverect** | gestión de menús; "stock sync / 86ing" atado al stock | **ubicaciones seleccionadas o grupos**, plataformas y canales | asignar disponibilidad a locales concretos o grupos |
| **R365 / Apicbase** | inventario | atado al **stock por ubicación** | el 86 nace del consumo real |

**Conclusión:** el panel de gestión del 86 vive en **Carta/Menús**, NO en pedidos. Pedidos/cocina es donde se
**dispara rápido** (un toque). Robamos de Otter: contador "en N locales" + 3 estados.

**Dónde Folvy golea (y ellos no):**
- **Cross-brand**: apagas la Coca-Cola física → cae en las 8 marcas que la comparten. Otter va item a item.
- **Auto-86 por stock real** (Fase 3): el módulo Almacén ya está construido; escandallo + stock vivo juntos =
  nadie más puede agotar automáticamente cuando se acaba el ingrediente.

---

## 2. Modelo de datos — tabla dedicada `product_availability`

**Decisión (con RECON):** tabla nueva, NO reusar `menu_item_override`.
Razón: el override hoy es **solo precios** (47 filas, 47 con precio, 0 agotados, 0 con local). Meter ahí el 86
obliga a filas "fantasma" sin precio y ensucia el motor de márgenes. El 86 tiene cosas que el precio no tiene
(reason, timer, rastro de quién/cuándo) y opera a nivel **producto físico**, no menu_item de una marca.

**Grano:** una fila por *(producto físico × local)* **que esté agotado**. Sin fila → disponible (defecto sano).

```sql
-- PROPUESTA (no ejecutar hasta aprobar)
create table public.product_availability (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  -- identidad del PRODUCTO FÍSICO (no menu_item por marca):
  external_id   text,           -- matrícula (organizationProductId); cubre bebidas/reventa compartida
  recipe_item_id uuid,          -- escandallo compartido; cubre platos sin matrícula uniforme
  location_id   uuid,           -- NULL = todos los locales (caso "descatalogar", con más fricción)
  -- estado:
  is_available  boolean not null default false,   -- la fila SOLO existe si está agotado
  reason        text not null default 'manual'    -- manual | stock_out | schedule
                check (reason in ('manual','stock_out','schedule')),
  available_until timestamptz,                     -- timer: "agotado hasta" (3 estados de Otter)
  -- rastro (seguridad / legal):
  set_by        uuid,           -- user_profiles.id de quien lo agotó
  set_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- una sola fila activa por (producto físico × local): clave por la identidad disponible
-- (external_id O recipe_item_id) + location. Se resuelve con índice único parcial por cada eje.
create unique index uq_prod_avail_ext on public.product_availability (account_id, external_id, coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid)) where external_id is not null;
create unique index uq_prod_avail_rec on public.product_availability (account_id, recipe_item_id, coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid)) where recipe_item_id is not null;
alter table public.product_availability enable row level security;
-- lectura/escritura por manager/admin de la cuenta (helpers ya en uso).
```

**Disponibilidad efectiva** de un producto en un local =
`menu_item.is_available (base de marca / Last)` **Y** `no existe fila agotada en product_availability para (producto, ese local o NULL)`.

- `menu_item.is_available` se **queda** como **base de marca** (lo que viene de Last / descatalogado de fábrica).
- El nuevo eje por local vive en `product_availability`. Las columnas `availability_reason`/`available_until`
  que metimos en `menu_item` en Fase 1 quedan como **espejo del estado base** (o se retiran si no aportan; decidir al construir).

**3 estados (de Otter):**
- **Disponible** → no hay fila.
- **Agotado hoy** → fila con `available_until = fin del día` → pg_cron la borra/reactiva a medianoche.
- **Agotado indefinido** → fila con `available_until = null` → hasta reactivar a mano.

---

## 3. Empuje a Last — POR LOCAL (corrige el fallo de "todos los locales")

El espejo `external_catalog_product` ya distingue local (`external_location_id`, relleno en el paso 0).
Verificado: 5 locations de Last, cada una con sus catálogos por canal.

`set_product_availability` gana un parámetro **`p_location_id`**:
- resuelve los hermanos cross-brand (igual que hoy),
- escribe/borra la fila en `product_availability` para **ese local**,
- el despachador filtra el espejo por `external_location_id = <local>` → `PUT enable:false` **solo a los
  catálogos de ese local**. Carabanchel sigue vendiendo si agotas en Plaza Castilla.
- `p_location_id = null` → comodín "todos los locales" (empuja a todos; caso descatalogar).

Mapa local físico ↔ `external_location_id`: ya existe el cruce (cada local físico = 1+ location de Last; el
contexto de sesión/dispositivo da el local; en oficina se **elige** — ver §5).

---

## 4. Seguridad (requisito de Julio, bloqueante)

1. **Confirmación con alcance real de producción**, antes de ejecutar:
   *"Vas a marcar AGOTADO **Coca-Cola Zero** en **[LOCAL]** · se apagará en **N marcas · N catálogos** de
   Glovo/Uber/JustEat **AHORA, en producción**."* Botón explícito "Sí, agotar en [LOCAL]".
   - La confirmación **es** la simulación: enseña la cascada calculada antes de tocar nada (sin toggle aparte).
2. **Pruebas en Folvy Interno** (sandbox), nunca sobre el cliente. Regla de oro.
3. **Rastro**: `set_by` + `set_at` en cada fila (quién agotó, cuándo). Visible en el panel.
4. (Futuro) permiso fino `can_86_products` separado de admin, si hace falta limitar a ciertos roles.

---

## 5. Dónde vive (operativo y cómodo)

| Pieza | Módulo | Usuario | Detalle |
|---|---|---|---|
| **Panel "Agotados"** | **Carta / Kitchen** | oficina | lista filtrable por **local** y por **marca/menú**; contador "agotado en N locales"; 3 estados; quién/cuándo; interruptores grandes + **selección en bloque** |
| **86 a un toque** | **Cocina / KDS** (tablet) | cocinero | local por **contexto del dispositivo** (no se elige a mano = error seguro); un toque agota/reactiva |
| **Toggle en ficha** | ficha de producto | oficina | se queda como control "de fondo" autoritativo, **secundario** (no protagonista) |

**Punto 1 (Julio):** en oficina, el 86 es **en el local seleccionado**; si el producto está en varios y se quiere
agotar en varios, se **eligen los deseados** (no todo-o-nada). "Todos los locales" = el comodín `location_id null`.
→ El panel de oficina lleva un **selector de local** (o "todos"); la cocina lo toma del dispositivo.

---

## 6. Maquetas (esquemáticas)

### 6.1 Panel "Agotados" (Carta, oficina)
```
┌─ Disponibilidad ──────────────────────────────────────────────┐
│  Local: [ Plaza Castilla ▾ ]   Marca: [ Todas ▾ ]   [ Buscar ]│
│                                                                │
│  ⦿ AGOTADOS (3)                          [ + Agotar producto ] │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Coca-Cola Zero      agotado · 8 marcas · 2 locales        │ │
│  │   indefinido · por Pamela · hoy 08:44      [ Reactivar ]  │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ Fanta Limón         agotado hoy (hasta 23:59) · 1 local   │ │
│  │   por José · 12:10                          [ Reactivar ] │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Disponibles · [ ver carta completa para agotar ]              │
└────────────────────────────────────────────────────────────────┘
```
- Contador "N locales" por fila (idea Otter). Filtro local + marca (requisito Julio).
- "Agotar producto" → buscador → producto → **confirmación con alcance** (§4.1).

### 6.2 Cocina / KDS (tablet, un toque)
```
┌─ Cocina · Plaza Castilla ─────────────────────────────────────┐
│  [ Pedidos ]  [ Disponibilidad ]                               │
│                                                                │
│  Buscar: [ coca ]                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐     │
│  │ Coca-Cola Zero   ● Disp │  │ Fanta Limón     ○ Agot. │     │
│  │     [ AGOTAR ]          │  │     [ REACTIVAR ]       │     │
│  └─────────────────────────┘  └─────────────────────────┘     │
│  (local = este dispositivo; un toque; sin entrar en fichas)   │
└────────────────────────────────────────────────────────────────┘
```

### 6.3 Confirmación (seguridad, §4.1)
```
┌─ ¿Agotar Coca-Cola Zero? ─────────────────────────────────────┐
│  Local: Plaza Castilla                                        │
│  Se apagará AHORA, en producción, en:                        │
│    · 8 marcas                                                 │
│    · 2 catálogos de Glovo / Uber                             │
│  Podrás reactivarlo en un toque.                             │
│                                                              │
│  Hasta:  ( ) hoy (reactiva a medianoche)  (•) indefinido     │
│                                                              │
│         [ Cancelar ]            [ Sí, agotar en Plaza C. ]    │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. Plan de construcción (cuando se apruebe; por capas, deuda-0)

1. **Migración**: `product_availability` + índices + RLS. Regenerar `database.ts`.
2. **RPC** `set_product_availability` v2: añadir `p_location_id`; escribir/borrar fila; cascada cross-brand por
   local; devolver alcance `{brands, channels, location}`.
3. **Despachador** `availability-dispatch` v2: filtrar el espejo por `external_location_id`; push solo a ese local.
4. **Disponibilidad efectiva**: vista/función que combine base (`menu_item.is_available`) + `product_availability`.
5. **Panel "Agotados"** (Carta): lista filtrable, contador N locales, 3 estados, confirmación con alcance.
6. **Cocina/KDS**: pestaña Disponibilidad a un toque (local por contexto).
7. **Timer** (pg_cron): reactivar "agotado hoy" a medianoche.
8. **Ficha**: el toggle pasa a secundario y respeta el local seleccionado.

**Auto-86 por stock (Fase 3, futuro):** un llamador más de la misma RPC con `reason='stock_out'`, desde Almacén.
Sin rework (la firma ya lo admite).

---

## 8. Decisiones cerradas (registro)
- Tabla dedicada `product_availability` (no reusar override). [RECON: override = solo precios]
- 86 por **local**; "todos" = comodín; oficina elige local, cocina lo toma del dispositivo.
- Panel de gestión en **Carta**, 86 rápido en **Cocina**; ficha = secundario. [benchmark Otter]
- **3 estados** + timer `available_until`. [Otter]
- Seguridad: confirmación con alcance real + pruebas solo en Folvy Interno. SIN toggle de simulación aparte.
- Empuje por `external_location_id` (espejo del paso 0).
