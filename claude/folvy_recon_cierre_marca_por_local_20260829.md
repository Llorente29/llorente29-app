# RECON — Cerrar una marca la cierra en TODOS los locales (29/08/2026)

Estado: **RECON. No se ha construido nada.** Se reporta para acordar antes de tocar.
Verificado contra producción (`xzmpnchlguibclvxyynt`) el 29/08/2026 por la tarde.

---

## 0. Lo urgente: Meraki Pita sigue cerrada mientras se escribe esto

```
brand.id            cc89c6eb-afb8-4308-884e-9aac83986b22
brand.name          Meraki Pita
closure_mode        paused
closure_resume_at   NULL          <- no se reabre sola
closure_set_at      2026-08-29 10:13:38 UTC  =  12:13 Madrid
```

Es la marca real: 31 fichas vivas y 184 ventas en los últimos 30 días. (Hay una
segunda fila `441afae9…` con el mismo nombre, 54 fichas y **0 ventas** — marcas
duplicadas por nombre, igual que los locales. Ver §7.)

El cierre es de cuenta, así que **está apagada en Alcalá y en Carabanchel a la
vez**, en sábado. En `availability_event` hay 7 eventos sobre Meraki Pita entre
las 11:23 y las 12:13 de hoy, alternando close/open/close: alguien peleándose
con un interruptor que no hace lo que dice.

Los 19 eventos de cierre de marca de los últimos 3 días tienen **todos**
`location_id = NULL`.

No se reabre desde aquí: con la herramienta de hoy, reabrir la abriría también
en Carabanchel, donde puede estar cerrada con motivo. Decisión de Julio.

**Mitigación hasta que esto esté hecho: decir hoy a las dos cocinas que no usen
«Cerrar marca».** Para agotar en un solo local ya sirve el 86 por producto, que
desde el 28/08 sí es por local.

---

## 1. Por qué es global: la causa exacta

El estado de cierre son **cinco columnas de la tabla `brand`**, y `brand` no
tiene `location_id` — no puede tenerlo, una marca es una sola fila para toda la
cuenta:

| columna | tipo |
|---|---|
| `brand.closure_mode` | `text` NOT NULL default `'normal'` |
| `brand.closure_resume_at` | `timestamptz` |
| `brand.closure_reason` | `text` |
| `brand.closure_set_at` | `timestamptz` |
| `brand.closure_set_by` | `uuid` |

No es un filtro que falte en una consulta: es la **grano de la tabla**. Por eso
no hay parche pequeño.

Hay una segunda mitad, en el empuje. `set_brand_status` manda al despachador:

```
'external_location_ids',  to_jsonb(array[]::text[]),
'location_id',            null,
```

`supabase/migrations/20260731T1020_set_brand_status_v3_event.sql:144-145` (RPC de
oficina) y `:280-281` (RPC por token). Es decir: aunque el estado fuese por
local, el push seguiría yendo a todos los catálogos de la marca.

---

## 2. La buena noticia: el despachador YA sabe hacerlo por local

`supabase/functions/availability-dispatch/index.ts` acepta `location_id` desde
hace tiempo y lo resuelve él solo:

- `:107` — `const locationId = body.location_id ?? null;`
- `:206-210` — si viene `locationId`, lee `external_location_map` y saca los
  `external_location_id` de ESE local.
- `:229`, `:252`, `:282`, `:301` — filtra catálogos y conexiones por esa lista.

Y el mapa está completo para Meraki Pita:

| local | `external_location_map` | `brand_hubrise_catalog` |
|---|---|---|
| Foodint Alcalá | `1b6p8-0` | `1b6p8-0` · cat `dmmj9` |
| Foodint Carabanchel | `1b6p8-2` | `1b6p8-2` · cat `x77xp` |

**`availability-dispatch` no hay que tocarlo.** Es exactamente el camino que ya
usa el 86 por producto desde el 28/08.

---

## 3. Quién lee el cierre hoy (lista cerrada, verificada en el catálogo)

Cinco funciones, **ninguna vista, ningún trigger** (comprobado en
`information_schema.views` y `pg_trigger`):

| función | firma | qué hace | ¿sabe de local? |
|---|---|---|---|
| `set_brand_status` | `(p_brand_id, p_mode, p_resume_at, p_reason, p_reason_code)` | escribe las 5 columnas + empuja | **no** |
| `set_brand_status_by_token` | `(p_device_token, p_brand_id, p_mode, p_resume_at, p_reason, p_reason_code)` | igual, desde tablet | **no** (el `location_id` del evento es informativo: el propio comentario de la migración dice «el cierre en sí es de cuenta») |
| `brand_status` | `(p_brand_id, p_token)` | estado actual para el botón | **no** |
| `closed_brands` | `(p_account_id, p_token)` | indicador de marcas cerradas | **no** |
| `anomalous_brand_closures` | `(p_account_id, p_token)` | alarma de cierre olvidado | **no** |
| `brands_for_closure` | `(p_account_id, p_token)` | qué marcas se pueden cerrar | **no** |

Front (ningún componente pasa ni conoce un local al cerrar):

- `src/modules/kds/services/kdsService.ts:385` `getBrandStatus`, `:390`
  `setBrandStatus`, `:407` `setBrandStatusByToken`, `:431`
  `listBrandsForClosure`, `:452` `getClosedBrands`, `:474`
  `getAnomalousBrandClosures`.
- `src/modules/kds/components/BrandCloseControl.tsx:100-101` y `:116-117` — el
  botón. Montado en `AvailabilityBoard.tsx:68`.
- `src/modules/kds/components/ClosedBrandsCard.tsx:87-88` — montado en
  `AvailabilityBoard.tsx:75` y `ClosuresChip.tsx:132`.
- `src/modules/kds/components/ClosureAnomalyAlarm.tsx:71-72` — montado en
  `OrdersFeed.tsx:288`.
- `supabase/functions/availability-watchdog/index.ts:127-133` — el vigía lee
  `brand` con `closure_mode='paused'`, sin local.

`availability_event` **ya tiene `location_id`**: el rastro de auditoría no hay
que cambiarlo de forma, solo dejar de escribir NULL.

---

## 4. Modelo de datos: (a) o (b)

**(a) Colgarlo de `brand_location_availability`.** La tabla ya existe con el
grano exacto `(account_id, brand_id, location_id)` — 52 filas, una por marca ×
local. Se le añadirían las 5 columnas de cierre.
*En contra:* esa tabla es el **catálogo comercial** («¿esta marca opera en este
local?», con `active_since` / `inactive_since`). Mezclar en ella una pausa
operativa de 30 minutos junta dos vidas distintas en la misma fila: una que dura
años y otra que dura una freidora rota. El día que alguien filtre por
`is_active` para saber dónde opera la marca, se llevará por delante los cierres.

**(b) Tabla nueva `brand_closure`** — *recomendada*.
`(account_id, brand_id, location_id, mode, resume_at, reason, reason_code,
set_at, set_by)`, única por `(brand_id, location_id)`. **Fila ausente = abierta.**
*A favor:* es exactamente la forma de `product_availability`, que ya funciona y
ya es por local para el 86. Misma cabeza para el operario y para quien lea el
código. No hay que rellenar 3 locales × 18 marcas de golpe, y el estado
operativo queda separado del comercial.

**Recomiendo (b).**

Con (b), `brand.closure_*` se queda como segunda verdad, y eso es justo lo que
costó el incidente del 24/08 con `menu_item.is_available`. Propuesta, con las
lecturas migradas primero: las cinco funciones de §3 pasan a leer
`brand_closure`, se comprueba que nadie más las toca, y **entonces** se hace
DROP de las cinco columnas. Son columnas, no una tabla, y ya está verificado que
no las lee ninguna vista ni ningún trigger. Si prefieres no dropear todavía, la
alternativa honesta es dejarlas **derivadas** (`paused` sólo si lo está en TODOS
los locales activos de la marca), nunca las dos escribiéndose a mano.

---

## 5. §6 — Qué MÁS manda sin local

Barrido completo de las tablas con `brand_id` y de las funciones que gobiernan
disponibilidad, precio o estado operativo.

### 5.1 Deuda real, misma familia

**1. `menu_item.is_available` — 125 fichas apagadas ahora mismo por un 86 que es de un solo local.** *(hallazgo nuevo, no estaba en el encargo)*

El 28/08 (`20260824T1100_availability_verdad_unica.sql`) se decidió que
`product_availability` es la verdad y `menu_item.is_available` su espejo
derivado. Pero el recálculo del espejo **no filtra por local**:

```sql
update menu_item mi
   set is_available = not exists (
         select 1 from product_availability pa
          where pa.account_id = mi.account_id
            and pa.is_available = false
            and ( ... ) )        -- <- ni una mención de location_id
```

`supabase/migrations/20260824T1100_availability_verdad_unica.sql:63-78` (dentro
de `_set_product_availability_core`) y `:80-95` (el backfill).

Medido hoy en producción: de los 52 agotados activos, **52 son por local y 0
globales**. Y **125 fichas vivas** tienen `is_available = false` por un 86 que
sólo aplica a un local; **121** son de marcas con tienda. Reparte por 18 marcas:
Ay Mamita Bowls, Bendito Burrito, Big Mike´s, Birria Burrito, Chivuos, Deep
Pizza, Dirty Burger, Dos Coyotes, Koreans do it better, Lobbers, Lovers Burgers,
Meraki Pita, Mila's Sandwiches, Milanesa Haus, Milanesa House, Scandal Burgers,
Smash Brothers, The Urban Kebab.

Lo caro es que **la tienda se contradice a sí misma**:

- `shop_brand_menu_by_slug` (líneas 56-80 del cuerpo vivo) mira
  `product_availability` con la cascada por local y **sólo esconde el producto si
  está agotado en TODOS los locales activos de la marca**. O sea: lo enseña.
- `place_shop_order` (línea 383 del cuerpo vivo) rechaza con
  `mi.is_available is not false` — el espejo global. O sea: lo rechaza.

Un cliente ve el producto, lo pide, y el pedido se cae. No lo he cuantificado en
pedidos perdidos: haría falta mirar el log de `place_shop_order`, y no quería
alargar el RECON antes de reportar.

*Propuesta:* el mismo arreglo que la marca. El espejo global no puede
representar una verdad por local — o se le añade el local, o `place_shop_order`
pasa a leer `product_availability` con la misma cascada que ya usa el menú de la
tienda. Lo segundo es más pequeño y quita una verdad en vez de añadirla.

### 5.2 Sin local por construcción, hay que decidir si importa

| qué | dónde | hoy | comentario |
|---|---|---|---|
| `menu_category.is_active` | tabla, sin `location_id` | esconder una categoría la esconde en los 3 locales | ¿alguien necesita una categoría sólo en un local? |
| `modifier_group.is_active`, `modifier_option.is_active` / `price_impact` | tablas, sin `location_id` | global | un extra que se acaba en Alcalá no se puede quitar sólo allí |
| `brand_channel.is_active` | tabla, sin `location_id` | en qué canales vende la marca, global | leído por `menu_item_economics`, `resolve_channel_commission`, `menu_item_channel_economics` |
| `order_acceptance_config` | `(account_id, channel_id, brand_id)`, sin `location_id`; 4 filas | auto-aceptación y respeto de horario | ninguna función SQL la lee: la leen `hubrise-webhook/index.ts:246` y `src/modules/orders/services/orderAcceptanceService.ts:71`. Auto-aceptar en un local y no en otro hoy es imposible |
| `catalog_publish.status` | tabla, sin `location_id` | publicación de carta por marca | `brand_hubrise_catalog` sí tiene local; la publicación no |
| `brand.own_delivery_enabled` | columna de `brand` | reparto propio sí/no, global | |

### 5.3 Ya es por local — no tocar

- `set_location_status(p_location_id, …)` — el cierre de **local** sí es por local.
- `business_hours` y `business_hours_exception` — tienen `location_id`.
- `product_availability` + `_set_product_availability_core` — por local desde el 28/08.
- `availability_panel(p_account_id, p_location_id)`, `pos_item_config(…, p_location_id, …)`.
- `brand_hubrise_catalog`, `external_location_map`, `uber_store_map`, `campaign_rule`, `promo_price_origin`, `channel_*`.

### 5.4 Capaz por local, usado en global a propósito — no es deuda

La cascada de precios ya acepta local en las tres puntas:
`set_menu_item_override(…, p_location_id)`, `clear_menu_item_override(…,
p_location_id)`, `effective_price(p_menu_item_id, p_channel_id, p_location_id)`,
`menu_item_channel_economics(…, p_location_id)`. El front las llama con
`locationId ?? undefined` (`src/modules/kitchen/services/menuOverrideService.ts:
181-190, 222-228, 235-240`).

`menu_item_override` tiene **71 filas y las 71 con `location_id = NULL`**: hoy el
mismo precio en los tres locales, que es lo que se quiere. La maquinaria está y
funciona; sólo no se usa. **No es deuda, es una decisión.** Se anota para que
nadie la confunda con lo de arriba.

---

## 6. Resumen del RECON

| | |
|---|---|
| Sitios que mandan sin local **y son deuda** | **2** — el cierre de marca (el encargo) y `menu_item.is_available` (nuevo, 125 fichas vivas) |
| Sitios sin local **pendientes de decisión** | 6 (§5.2) |
| Sitios ya correctos por local | 9 (§5.3) |
| Capaces pero usados en global a propósito | 4 RPC de precio (§5.4) |
| Pendientes sin mirar | **0** |

---

## 7. Cabo suelto que aparece de paso

`locations` y `brand` **tienen filas duplicadas por nombre**:

- `locations`: dos «Foodint Alcalá», dos «Foodint Carabanchel», dos «Foodint
  Plaza Castilla» (una de ellas `active=false`, la que se excluyó del cron esta
  mañana), más «Kitchen Grill LstQ».
- `brand`: dos «Meraki Pita», dos «Milanesa House», «Milanesa Haus» y «Milanesa
  House» conviviendo, dos «Ay Mamita Bowls», dos «Bendito Burrito», dos «Big
  Mike´s Burger Joint».

Ya costó un error esta semana (una subconsulta por nombre devolvió más de una
fila). **Cualquier cosa que se construya aquí se ancla por `id`, nunca por
nombre.** Si mañana el cierre por local se hiciera por nombre, cerraría el local
equivocado.

No lo arreglo: no es este encargo y borrar filas duplicadas sin saber cuál
cuelga de qué venta es exactamente el tipo de cosa que no se hace un sábado.

---

## 8. Lo que hace falta acordar antes de construir

1. **Meraki Pita está cerrada ahora.** ¿Se reabre en las dos y se cierra a mano
   sólo lo de Carabanchel por producto, o se deja hasta que esto esté hecho?
2. **Modelo: (a) o (b).** Recomiendo (b), tabla `brand_closure`.
3. **`brand.closure_*`: DROP o derivada.** Recomiendo DROP tras migrar las 5
   lecturas, para no repetir lo del 24/08.
4. **`menu_item.is_available` (§5.1):** ¿entra en este encargo o va aparte? Son
   125 fichas vivas y la tienda contradiciéndose, así que a mi juicio no debería
   esperar — pero es un frente distinto del que pediste.
5. **§5.2:** cuáles de los 6 importan de verdad y cuáles se documentan como
   «global a propósito».
