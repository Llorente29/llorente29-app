# Folvy — Diseño del KDS (Kitchen Display System)
### Documento de diseño para aprobación · v1 · 13/06/2026

> **Estado:** diseño previo a construcción. NADA construido. Igual método que Economía de
> Plataformas / Integraciones: se aprueba el modelo sobre papel antes de tocar BBDD.
>
> **Precede a esto:** `folvy_kds_benchmark.md` (fase BENCHMARK). Este es el paso DISEÑO.
>
> **Decidido con Julio:** (1) KDS más completo del mercado, sólido y fácil; (2) **partir de
> cambiar cómo se recibe el ticket** (ingerir el pedido en vivo, no solo la venta cerrada);
> (3) **ruteo por familia de plato + override manual**, con la **marca como etiqueta** (no como
> criterio de ruteo); (4) modelo de **estaciones** = N de elaboración + 1 de embolsado/entrega
> (caso Llorente29: 2; caso grande: frío/calor/parrilla…+expo; caso bar: 1); (5) **etiqueta por
> línea** dentro del KDS; (6) **foto-en-pase** (IA) fase 1, vídeo continuo estilo Agot fase lejana;
> (7) el **quick win de cancelaciones** se diseña aquí (mismo punto del webhook), no aparte.

---

## 0. RECON (contra BBDD + repo, 13/06/2026) — la verdad de hoy

- **Greenfield:** no existe tabla `kds_*`, `kitchen_order*`, `ticket*`, `kitchen_ticket*`.
- **`sale`** no tiene `status`/`state`/`received_at`/`closed_at`; sí `created_at`, `service_type`
  (y `is_active`, `sold_at`, `external_ref`, `brand_id`, `channel_id`, `location_id`, `raw_tab`,
  `raw_products`, economía). La venta es la **verdad contable**, materializada en `tab:closed`,
  **una `sale` por `bill.id`** (idempotente por `external_ref`).
- **Webhook `lastapp-webhook`:** frontera única. Valida token → parsea → **dispatch por `eventType`**
  (hoy: un solo `if (eventType === "tab:closed")`). Resuelve cuenta por `lastapp_location_map`,
  marca por `external_brand_map` (primario) + catálogo (respaldo), canal por `sales_channel`. Guarda
  `raw_tab` completo. Loguea SIEMPRE en `lastapp_webhook_log`. Responde **200 siempre**. Deploy
  **`--no-verify-jwt`** (regla crítica).
- **Reutilizable para el KDS sin reescribir:** `resolveSaleBrand`, `loadHeaderCaches`,
  `lastapp_location_map`, `external_brand_map`, `raw_tab`.

**Conclusión:** el KDS se construye nuevo (greenfield), pero **enchufa en la frontera que ya existe**
y reutiliza toda la resolución de cuenta/marca/local/canal. No se toca el motor contable.

---

## 1. Principio rector: UNA VENTA CON ESTADO, NACE AL ABRIR (modelo A)

> **Decisión de Julio (A):** la venta **figura en el informe desde que el pedido entra**
> (`tab:created`); si luego se cancela, **se resta**. Confirmado contra `tab:created` real
> (Glovo/Cloudtown, 13/06): el evento **ya trae `bills` valorados** (total, tax, taxableBase,
> payments, líneas) y el **mismo `bill.id`** que usamos hoy como `external_ref` → la identidad de
> la venta NO cambia, solo el momento en que nace.

```
                 ┌──────────────── lastapp-webhook (frontera única) ────────────────┐
   Last.app ───▶ │  dispatch por eventType                                          │
                 │                                                                  │
                 │  tab:created ──────────────▶ sale (status='open') por bill.id    │
                 │  tab:updated / tab_products:updated  refresca cabecera+líneas    │
                 │  tab:closed ───────────────▶ sale.status='closed' + CONSOLIDA    │
                 │                               (coste + consumo de stock AQUÍ)     │
                 │  tab:cancelled │                                                 │
                 │  bill:deleted  │ ─ revert ──▶ sale.status='cancelled' (resta)     │
                 │  payment:deleted                                                 │
                 │                                                                  │
                 │  (la MISMA sale alimenta el informe Y el pedido en vivo/KDS)      │
                 │  kitchen-order:* / course:sent ─ enriquece ▶ pase/coursing        │
                 └──────────────────────────────────────────────────────────────────┘
```

**Una sola venta con `status`** (`open` → `closed` → `cancelled`), no dos tablas. Nace en
`tab:created` por `bill.id`, se refresca en vivo, consolida en `tab:closed`, se cancela con el
ciclo de vida. El informe suma `open`+`closed` y **resta** `cancelled`, distinguiendo siempre
"en curso" de "cerrado" (cifras provisionales nunca se presentan como firmes).

**REGLA FIRME, vale para TODA la hostelería (no solo delivery):** el **coste y el consumo de
stock SOLO se consolidan en `tab:closed`**, nunca en `open`.
- **Delivery (Llorente29, 100%):** el pedido entra ya valorado y `tab:closed` llega casi
  inmediato → la venta pasa de `open` a `closed` enseguida y descuenta stock.
- **Sala (otros clientes):** la mesa vive `open` toda la comida (figura en el informe en vivo,
  importes provisionales, NO toca inventario) y consolida al cerrar.
- Mismo código, sin ramas por canal: **nada descuenta stock hasta el cierre** → el inventario
  nunca se corrompe aunque el pedido crezca o se cancele. Protege la columna del MRP II.

El **pedido en vivo / KDS** lee de esta misma venta `open` (o de una proyección de cocina sobre
ella); no hace falta una tabla `kitchen_ticket` separada para la identidad (la venta YA es el
pedido). El KDS añade lo suyo (estación por línea, estado de preparación) sobre las líneas.

---

## 2. Modelo de datos (modelo A)

### 2.1 `sale` — la venta con estado (cambios sobre la tabla existente)
La identidad NO cambia (`external_ref = bill.id`, idempotente). Se le añade el ciclo de vida:
| Campo | Tipo | Nota |
|---|---|---|
| status | text | **NUEVO** — `open` \| `closed` \| `cancelled` (default `open` al nacer en `tab:created`) |
| opened_at | timestamptz | **NUEVO** — cuándo entró (= `tab.creationTime`); semáforo del KDS |
| closed_at | timestamptz null | **NUEVO** — `tab:closed` (consolidación) |
| cancelled_at | timestamptz null | **NUEVO** — `tab:cancelled`/`bill:deleted`/`payment:deleted` |
| cancel_reason | text null | **NUEVO** — qué evento la canceló |
| (resto) | | igual que hoy: economía, `raw_tab`, `raw_products`, brand/channel/location |

**Coste/consumo:** `compute_sale_line_cost` y `compute_sale_line_consumption` se ejecutan **solo
al pasar a `closed`** (no en `open`). Si se cancela tras cerrar, se **revierte** el consumo (ver §5).
**Informe de ventas:** suma `open`+`closed`, resta `cancelled`; distingue "en curso" de "cerrado".

### 2.2 Lo que el KDS añade SOBRE las líneas existentes (`sale_line`)
No hay tabla de ticket aparte: la venta `open` **es** el pedido vivo. El KDS añade:
| Campo (en `sale_line` o tabla puente ligera) | Tipo | Nota |
|---|---|---|
| station_id | uuid null | **estación de elaboración** (familia→estación + override) |
| prep_status | text | `pending` → `done` (bump por estación) |
| (lectura) allergens, est_cost | — | de la receta (goleada, ya disponible) |

> Sub-decisión de construcción: si conviene no tocar `sale_line`, el estado de cocina vive en una
> tabla puente `kds_line_state (sale_line_id, station_id, prep_status)`. Se decide en RECON de build.

### 2.3 `kitchen_station` — estaciones (por local) — sin cambios respecto a v1
| Campo | Tipo | Nota |
|---|---|---|
| id / account_id / location_id | uuid | |
| name | text | "Elaboración", "Frío", "Calor", "Parrilla", "Pase/Embolsado" |
| kind | text | `prep` (elaboración) \| `expo` (pase/embolsado/entrega) |
| display_order / is_active | int / bool | |

**Onboarding por defecto:** toda cuenta/local nace con **2 estaciones** (`prep` "Elaboración" +
`expo` "Pase") — caso Llorente29. El cliente divide en frío/calor/parrilla cuando lo necesite.
Caso 1-estación = solo `expo`. Trigger de alta replicado de APPCC/vacaciones.

### 2.4 Ruteo (decidido: familia + override; marca = etiqueta) — sin cambios
- **Por familia de plato → estación** (`kitchen_family_route`); **override** por `recipe_item.kds_station_id`.
- **Fallback:** estación `prep` por defecto (en Llorente29, la única de elaboración).
- **Expo** ve el ticket entero. **Marca** = etiqueta en tarjeta/pegatina, no rutea.

---

## 3. CAPA 0 — cambiar cómo se recibe el ticket (el dispatch, diseñado una vez)

El `Deno.serve` del webhook pasa de un `if` a un **switch por `eventType`**. Cada rama es additiva;
ninguna toca la lógica de coste existente.

| Evento Last | Acción de la frontera (modelo A) |
|---|---|
| `tab:created` | resolver cuenta/local/marca/canal (cachés existentes) → **insertar `sale` con `status='open'`** por `bill.id` (idempotente) + adaptar líneas (motor actual). **SIN** coste/consumo todavía |
| `tab:updated` / `tab_products:updated` | **refrescar** cabecera+líneas de la venta `open` (re-adaptar). Sigue sin tocar stock |
| `tab:closed` | `status='closed'` + **consolidar**: refrescar importes + `compute_sale_line_cost` + `compute_sale_line_consumption` (descuento de stock AQUÍ, como hoy) |
| `tab:cancelled` / `bill:deleted` / `payment:deleted` | `status='cancelled'` + `cancelled_at`/`cancel_reason`; si ya estaba `closed`, **revertir consumo** |
| `course:sent` / `kitchen-order:*` / `kitchen-note:*` | enriquecer pase/coursing/notas del pedido vivo |

Idempotencia: `sale` por `(account_id, source, external_ref=bill.id)`. `tab:created` puede llegar
una vez y `tab:updated` varias → upsert por `external_ref`; las líneas se re-adaptan. Si por orden de
llegada `tab:closed` entra sin `open` previo (p. ej. delivery muy rápido), el handler de `closed` hace
upsert igual (nace y consolida en un paso). **Resiliencia de orden de eventos = obligatoria.**

Deploy: **`--no-verify-jwt`** (regla crítica; un deploy sin la flag tumba TODA la ingesta en silencio).

---

## 3b. CAPA DE SALIDA DE REPARTO — aviso automático al broker (NUEVO)

> **Decisión de Julio:** por cada pedido, según **quién hace el reparto**, Folvy actúa distinto.
> Plataforma (Glovo/Uber/JE) → no hace nada (su rider). Reparto propio vía broker
> (**Catcher / Jelp / Shipday**) → **lanza el aviso de recogida automáticamente AL RECIBIR el
> pedido** (`tab:created`). Esto es ESCRIBIR al exterior (primer adaptador de SALIDA de Folvy;
> hasta ahora solo leíamos). Encaja con Catcher = broker de last-mile (no agregador), credenciales
> y API ya confirmadas (Create Order, Update delivery price, Driver Location, webhooks).

### Modelo
- **`delivery_provider`** configurable por **marca×canal o local** (defecto) + **override por pedido**:
  valores `platform` (la plataforma reparte) \| `catcher` \| `jelp` \| `shipday` \| `none`. El defecto
  evita el selector manual en cocina (error seguro); el override es la válvula puntual.
- **`delivery_dispatch`** (pedido → proveedor → estado del envío → **coste real de transporte**):
  un registro por pedido, **idempotente** por `bill.id`/`tab.id`. Estado `pending`→`requested`→
  `assigned`→`delivered`/`failed`/`cancelled`.
- **Adaptador de salida genérico** (hermano de la frontera de entrada): interfaz `crear orden de
  reparto` / `consultar estado` / `cancelar`. **Catcher primero**; Jelp/Shipday se enchufan después
  sin reescribir (principio canónico, una capa N proveedores).

### Las TRES reglas firmes del disparo automático
1. **Solo en reparto propio.** Si `service_type = platform_delivery` → **NUNCA** se lanza (su rider
   lo pone la plataforma). Solo dispara si `own_delivery` **y** hay `delivery_provider` ∈
   {catcher,jelp,shipday}. Sin proveedor configurado → no se lanza (no se inventa rider). *(Una mesa
   de sala `tab:created` no es `own_delivery` → cubierta por esta regla, no dispara.)*
2. **Idempotencia absoluta — un pedido, un rider.** Reintentos de `tab:created` y los `tab:updated`
   NO relanzan: si ya existe `delivery_dispatch` para ese pedido, no se vuelve a pedir.
3. **Frontera de salida resiliente.** La venta nace SIEMPRE primero; el dispatch del rider es paso
   posterior. Si Catcher falla/tarda → pedido marcado **"reparto pendiente"**, reintento/visible en
   KDS; **nunca** tumba la ingesta ni bloquea el 200 del webhook.

### Válvula manual (decidido)
Automático al recibir **+ botón cancelar/relanzar** en el KDS (mundo real: lanzar antes/después o
corregir un fallo).

### Bonus economía
Catcher devuelve el **coste real de transporte** por pedido → alimenta `own_courier_cost` del modelo
de comisiones (Economía de Plataformas). No solo lanza el rider: cierra el dato de coste de reparto propio.

**Dónde encaja:** capa que se apoya en la **0b** (necesita el pedido nacido en `tab:created`). NO es
parte del KDS de paridad (Capa 1); es una capa de salida propia. Se construye tras 0b.

---

## 4. Estados del pedido en vivo y semáforo

`new` (acaba de entrar) → `in_progress` (alguna estación trabajando) → `ready` (todas las líneas
`done`, listo para embolsar) → `served`/`closed` (entregado / cuenta cerrada). `cancelled` desde
cualquier estado.

- **Semáforo por tiempo** desde `received_at`, con **umbrales por `service_type`** (delivery ≠ sala).
- **Sonido** al entrar `tab:created`. **Resaltado** de cambios en `tab:updated`.
- **Bump por estación** (línea `done`) y **bump final** en expo (ticket `ready`→`served`).

---

## 5. Cancelaciones — restan de verdad (parte del modelo A, no quick win aparte)

En modelo A las cancelaciones son parte natural del ciclo de vida de la venta:
- `tab:cancelled` / `bill:deleted` / `payment:deleted` → `sale.status='cancelled'` + `cancelled_at`
  + `cancel_reason` (no se borra: trazabilidad).
- Si la venta ya estaba `closed` (consumo descontado), se **revierte el consumo** de stock.
  *(Sub-decisión: `compute_sale_line_consumption` reversible idempotente, o `revert_sale_consumption`
  — RECON de build, §8.2.)*
- **Informe:** suma `open`+`closed`, **resta** `cancelled`. Las canceladas quedan visibles en auditoría.

Verificado contra payload real: `tab:created` ya trae `bill.id` y `bill.deleted` (bool) → el match de
reversión por `external_ref=bill.id` es directo.

---

## 6. Capas de goleada (cada una usable sola; enchufan en el ticket vivo)

- **6a. Cook Mode en el pase:** pasos E8 (`recipe_item_step_line`) ligados a ingredientes, a un toque desde la línea. Nadie lo tiene en vivo.
- **6b. Coste/margen del ticket en vivo (solo lectura):** `est_cost`/`est_margin` desde la receta + comisión marca×canal. "Este Glovo deja X €". No descuenta stock (eso es del cierre).
- **6c. Alérgenos por línea:** de `recipe_item_allergen`, no texto a mano. En tarjeta y etiqueta.
- **6d. Etiqueta por línea (impresora linerless):** nombre+modificadores+`order_code`+marca+alérgenos. Driver de impresión desde el KDS (Star mC-Label3 / TSP143IV SK / Epson / PAYS). Una por ítem o por pedido según canal.
- **6e. Foto-en-pase + check de completo:** auditoría visual IA ya diseñada (foto del plato vs referencia → semáforo + incidencias) antes del bump final. Fase 1 SMB; vídeo continuo estilo Agot = fase lejana/partner.
- **6f. APPCC en el pase:** cruce con el control del día (futuro).
- **6g. Auto-86 por stock teórico** — **sub-decisión abierta:** descontamos al cierre (hoy). Para apagar un artículo en vivo hace falta o (i) una **reserva/forecast** al recibir el pedido (no compromete stock), o (ii) recalcular disponibilidad teórica periódicamente. NO sobre-diseñar ahora: se ataca cuando el inventario perpetuo esté vivo. Declarado, no colado.

---

## 7. Orden de construcción (capas, cada una entrega valor sola)

1. **Capa 0a — `sale.status` + cancelaciones.** Migración (status/opened_at/closed_at/cancelled_at/cancel_reason) + el dispatch maneja `tab:cancelled`/`bill:deleted`/`payment:deleted` (resta). Mover coste/consumo a `closed`. **Cierra la deuda de exactitud y prepara A.** Eventos a marcar en Last: `tab:cancelled`, `payment:deleted` (ya tienes `bill:deleted`).
2. **Capa 0b — nacer en `tab:created`.** El dispatch crea la `sale` `open` al abrir el pedido + refresco con `tab:updated`/`tab_products:updated`. El pedido figura en el informe desde el inicio (modelo A). Marcar en Last: `tab:created`, `tab:updated`, `tab_products:updated`.
3. **Capa 0c — salida de reparto (§3b).** `delivery_provider` (defecto marca×canal + override) + `delivery_dispatch` idempotente + adaptador Catcher. Disparo automático en `tab:created` (reparto propio) con las 3 reglas firmes + botón cancelar/relanzar. Devuelve coste real a comisiones. Se apoya en 0b.
4. **Capa 1 — pantalla KDS de paridad:** tarjetas (líneas+modificadores+notas+canal+marca), semáforo por tipo desde `opened_at`, sonido, bump por estación + expo, multipantalla, modo oscuro, all-day, métricas de tiempo, offline básico. Estaciones (prep/expo) con onboarding por defecto + ruteo por familia. El estado del reparto (de 0c) se ve en la tarjeta.
5. **Capa 2 — goleada por fases:** 6d etiqueta → 6a Cook Mode → 6b coste/margen vivo → 6c alérgenos → 6e foto-en-pase → 6f APPCC → 6g auto-86 (cuando haya inventario).

---

## 8. Decisiones abiertas (a cerrar antes/durante construcción)

1. **`sale` estado:** ✅ DECIDIDO — columna `status` explícita (`open`/`closed`/`cancelled`) + timestamps. Modelo A.
2. **Reversión de consumo:** ¿`compute_sale_line_consumption` es reversible idempotente, o hay que añadir `revert_sale_consumption`? (RECON de build, al construir 0a).
3. **Estado de cocina en `sale_line` directo o tabla puente `kds_line_state`?** (RECON de build).
4. **Hardware etiqueta:** modelo linerless y cuántas por local (Star mC-Label3 recomendada).
5. **KDS ¿dentro de la PWA** (tablet del local) **o pantalla dedicada** a TV/tablet fija?
6. **Suscripción de eventos en Last:** ✅ confirmado que el panel ofrece todos los necesarios. Marcar por capa: 0a → `tab:cancelled`+`payment:deleted`; 0b → `tab:created`+`tab:updated`+`tab_products:updated`; Capa 2 → `kitchen_order:*`+`kitchen_note:created`+`course:sent`. (Nomenclatura panel `kitchen_order`/`tab:delivery-status-updated` = OpenAPI `kitchen-order`/`delivery-status:updated`; match por el `type` real del payload.)

---

## 9. Lo que NO hace este diseño (límites honestos)
- No toca la lógica de coste/consumo del cierre (solo añade revert).
- No construye el vídeo continuo estilo Agot (fase lejana).
- No resuelve auto-86 en vivo (depende de inventario perpetuo; declarado §6g).
- No añade ruteo por marca (marca = etiqueta; se añadiría si un cliente lo pide).
