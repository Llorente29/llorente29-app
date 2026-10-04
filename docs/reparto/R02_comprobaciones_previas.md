# R02 · Tarea 1 — Comprobaciones previas

04/10/2026, a las 07:30 de Madrid aprox. **Producción en solo lectura** (`xzmpnchlguibclvxyynt`, cuenta Foodint
`51ad1792-…`, regla 9: todas las cifras de producción llevan `account_id`). Staging = `staging-conta`
(`oseymswjlzplqoxrfjzi`). No se ha escrito nada en ningún sitio.

## 0 · Resumen

1. **Hoy no hay «una» regla de quién reparte: hay cuatro sitios y dos fuentes.** El `service_type` lo pone la
   entrada (hubrise-webhook con `channel_delivery_policy`, o Last con su `pickupType`), después un disparador lo
   corrige con el interruptor, y `resolve_dispatch` vuelve a mirar el interruptor y **no lee
   `channel_delivery_policy` en absoluto**.
2. **Hay una cuarta entrada que el encargo no lista: Last (`lastapp-webhook`).** En 30 días trajo 2.662 pedidos
   (más que HubRise, que trajo 814). Ahí el `service_type` lo decide Last, no Folvy.
3. **Los datos no confirman que «Glovo y Just Eat mandan siempre la dirección».** Las tres plataformas hacen lo
   mismo: mandan la dirección **solo cuando la tienda está como reparto propio**. Esto cambia la ayuda bajo cada
   columna de la maqueta y el alcance de la sugerencia de la IA.
4. **El interruptor apagado (Smash y Lovers) no puede migrarse a «nada, hereda»** sin cambiar lo que pasa hoy:
   heredarían «Nosotros» en las tres plataformas.
5. **Hay otro lector de `channel_delivery_policy`: `brand_price_grid`** (la rejilla de precios). No está en el
   encargo.
6. **Staging está vacío**: ninguna marca, ninguna política y ninguna venta. Las funciones son idénticas a las de
   producción (misma huella).
7. **R01 confirmado en el código**: `upsert(..., { onConflict: 'account_id,channel_slug,ownership_type' })` contra
   dos índices **parciales**, así que Postgres no encuentra la restricción que casa con el `ON CONFLICT`.

Las preguntas están al final (§8). No he tomado ninguna decisión nueva.

## 1 · `channel_delivery_policy`

Columnas: `id`, `account_id`, `channel_slug`, `ownership_type` (`own`|`licensed`), `service_type`
(`own_delivery`|`platform_delivery`), `notes`, `location_id` (nullable), `created_*`, `updated_at`.

Índices únicos **parciales**:
- `channel_delivery_policy_account_wide_uk (account_id, channel_slug, ownership_type) WHERE location_id IS NULL`
- `channel_delivery_policy_per_location_uk (account_id, channel_slug, ownership_type, location_id) WHERE location_id IS NOT NULL`

**Producción: 6 filas, todas de Foodint y todas de cuenta (`location_id` NULL)**:

| id | canal | tipo de marca | service_type | creada |
|---|---|---|---|---|
| `10315659…` | glovo | own | own_delivery | 13/08 |
| `ef79ba49…` | glovo | licensed | platform_delivery | 26/08 |
| `5c2da520…` | justeat | own | own_delivery | 13/08 |
| `7cfb4695…` | justeat | licensed | platform_delivery | 13/08 |
| **`061bffc9…`** | **uber** | **own** | **own_delivery** | **02/10 16:57 UTC (la escrita a mano)** |
| `3654e759…` | uber | licensed | platform_delivery | 13/08 |

Ninguna otra cuenta tiene filas. **Staging: 0 filas.**

## 2 · `brand.own_delivery_enabled` en Foodint (producción)

El efectivo es `marca_reparte_propio(b) = coalesce(own_delivery_enabled, ownership_type = 'own')`.

| Marca | Tipo | Interruptor | Efectivo | Ventas 30 d |
|---|---|---|---|---|
| Smash Brothers Burgers | own | **false** | no | 89 |
| Lovers Burgers | own | **false** | no | 85 |
| Meraki Pita, Milanesa House, Mila's Sandwiches, Bendito Burrito, Scandal Burgers, The Urban Kebab, Dirty Burger | own | NULL | sí | 277 / 208 / 71 / 51 / 22 / 11 / 0 |
| Koreans…, Dos Coyotes, Milanesa Haus, Big Mike´s, Birria Burrito, Ay Mamita, Chivuos, Deep Pizza, Lobbers | licensed | NULL | no | 642 / 631 / 520 / 250 / 237 / 177 / 161 / 44 / 0 |

**Ninguna marca tiene el interruptor a `true`.** Staging: 0 marcas.

## 3 · Quién lee qué, y en qué orden (producción = staging; huella de las 5 funciones `8eebbf05…` en los dos)

Un pedido de HubRise, en orden:

1. **`hubrise-webhook` → `resolveDeliveryServiceType`** (solo si HubRise dice `delivery`): lee
   `brand.ownership_type` y después `channel_delivery_policy` (cuenta, canal, tipo de marca) **sin `location_id`**.
   Si no hay fila → `platform_delivery`. Con eso pone `sale.service_type`. **No lee el interruptor.**
   - Desplegado = `origin/main`: v60, `index.ts` md5 `5988db5d…` en los dos lados, y los tres `_shared` también
     idénticos. **Sin deriva.**
2. **`trg_sale_service_type_por_interruptor`** (BEFORE INSERT OR UPDATE): **solo** `source='hubrise'`,
   `own_delivery` y **sin dirección**. Si el interruptor está a `false` (no NULL) → `platform_delivery`. Con
   dirección no toca nada.
3. **`trg_auto_dispatch`** (AFTER INSERT OR UPDATE): si es `own_delivery`, `accepted`, sin `carrier_order_id`, sin
   asignación viva y el local está en `dispatch_mode='auto'` → `resolve_dispatch`.
4. **`resolve_dispatch(sale_id)`**:
   - (a) guard del interruptor: si `marca_reparte_propio` no es true → `carrier NULL` («el reparto propio de esta
     marca está apagado» / «es cedida…»);
   - (b) guard de dirección vacía → `carrier NULL`;
   - (c) `dispatch_rule` → `own_fleet` / `catcher`.
   - **No lee `channel_delivery_policy`.**
5. **`dispatch_watchdog_scan`** (cron `*/3`): para cada `own_delivery` sin despachar tras el margen, vuelve a
   llamar a `resolve_dispatch`. Si da NULL, escribe `delivery_alarm_kind='no_despachado'` y
   `dispatch_error='No se despachó: <motivo>'`.
6. **Front `OrderCard` → `DeliveryRow`**: `own_delivery` sin despachar + `dispatch_error` → **tarjeta roja**
   (`border-danger`, «No se pudo despachar», botón rojo «Reintentar despacho»). Si además no hay dirección,
   encima sale el aviso ámbar «Falta la dirección».

Un pedido de **Last**: `lastapp-webhook` pone `service_type` con el `pickupType` de Last (`delivery` →
platform, `ownDelivery` → own). No pasa por `channel_delivery_policy` ni por el disparador del interruptor (que
exige `source='hubrise'`). Sí pasa por los pasos 3 a 6.

Otros lectores:
- **`marca_reparte_propio`**: la usan `resolve_dispatch` y `metrica_direcciones_de_reparto`.
- **`brand_price_grid`**: lee `channel_delivery_policy` para marcar qué precio aplica por canal ×
  tipo de marca × `service_type`.
- **Front**: `BrandDeliverySection`, `ChannelDeliveryPolicySection`, `brandDeliveryService`,
  `channelDeliveryPolicyService` y el comentario de `priceGridService`.

## 4 · La dirección por plataforma (producción, Foodint, `sold_at` de los últimos 30 días)

| Fuente | Canal | service_type | Pedidos | Con dirección | Sin dirección |
|---|---|---|---|---|---|
| hubrise | glovo | own_delivery | 377 | 371 | 6 |
| hubrise | glovo | platform_delivery | 101 | **0** | 101 |
| hubrise | justeat | own_delivery | 17 | 17 | 0 |
| hubrise | uber | own_delivery | 24 | 11 | 13 |
| hubrise | uber | platform_delivery | 293 | 1 | 292 |
| lastapp | glovo | platform_delivery | 1.767 | **0** | 1.767 |
| lastapp | justeat | own_delivery | 16 | 16 | 0 |
| lastapp | justeat | platform_delivery | 47 | **0** | 47 |
| lastapp | uber | platform_delivery | 818 | 0 | 818 |

(Además, 16 de recogida, todos sin dirección, como es lógico.)

**Lectura:** en las tres plataformas la dirección llega cuando la plataforma cree que la tienda reparte ella
misma, y no llega cuando reparte la plataforma. Glovo no la manda «siempre»: los 75 pedidos de Glovo de Smash y
los 26 de Lovers (que reparte Glovo) llegaron **sin** dirección. Just Eat, igual (0 de 47 en los que reparte la
plataforma).

**Por marca, HubRise** (las cedidas entran todas por Last):

| Marca | Glovo: propio (sin dir.) / plataforma | Uber: propio (sin dir.) / plataforma | Just Eat: propio |
|---|---|---|---|
| Meraki Pita | 122 (0) / 0 | 12 (3) / 143 | — |
| Milanesa House | 157 (1) / 0 | 3 (2) / 33 | 14 |
| Mila's Sandwiches | 36 (1) / 0 | 5 (**5**) / 27 | 3 |
| Bendito Burrito | 31 (0) / 0 | 2 (2) / 17 | — |
| Scandal Burgers | 21 (**4**) / 0 | 0 / 1 | — |
| The Urban Kebab | 3 (0) / 0 | 1 (1) / 7 | — |
| Smash Brothers Burgers | 7 (0) / 75 | 1 (0) / 6 | — |
| Lovers Burgers | 0 / 26 | 0 / 59 | — |

**Uber desde la fila a mano `061bffc9…` (02/10 16:57 UTC):**
- **Sin dirección, 13 en total**, todos con `dispatch_error`: Meraki 3, Mila's 5, Bendito 2, Milanesa House 2 y
  Urban Kebab 1.
- **Con dirección, a Catcher:** Meraki 9 y Milanesa House 1.
- **Smash:** 1 con dirección, **parado por el interruptor**, aunque según el encargo Smash en Uber es «propio».
- **Lovers:** 10 de plataforma.

Meraki en Uber es propio de verdad (9 con dirección); Mila's y Urban Kebab, no (todos sin dirección), que es
justo lo que dice el encargo.

## 5 · Qué pasa hoy con un «propio» sin dirección

1. Entra `own_delivery` (por `channel_delivery_policy`). Si el interruptor de la marca es `false`, el disparador
   lo pasa a `platform_delivery`. Si es NULL (la mayoría), **se queda en `own_delivery`**.
2. `trg_auto_dispatch` → `resolve_dispatch` → guard de dirección → `carrier NULL`. **No se despacha** y no se
   escribe nada.
3. A los minutos, `dispatch_watchdog_scan` escribe `dispatch_error='No se despachó: sin dirección de entrega: la
   plataforma no la ha enviado'` y `delivery_alarm_kind='no_despachado'`.
4. La cocina ve la tarjeta **en rojo** (borde `danger`, «No se pudo despachar», botón rojo «Reintentar
   despacho»), con el ámbar «Falta la dirección» encima. Reintentar no sirve: el guard vuelve a decir que no.

En 30 días, de los pedidos `own_delivery`, salieron con `dispatch_error`:
- **HubRise:** 6 de Glovo sin dirección, 6 de Glovo con dirección (parados por el interruptor), 13 de Uber sin
  dirección y 1 de Uber con dirección (interruptor).
- **Last:** 16 de Just Eat (marcas cedidas, parados por el guard de cedida).

## 6 · Pedidos abiertos ahora (07:20 de Madrid)

`status='open'` en Foodint: 74 filas, pero **72 son restos que ya terminaron** (64 `cancelled`, 7
`delivery_failed`, 1 `rejected`) desde el 15/08. Es otro asunto: va a pendientes, no a este encargo. Vivos de verdad:

| Código | Marca · canal | service_type | Dirección | dispatch_error | Desde |
|---|---|---|---|---|---|
| 431 | Scandal Burgers · Glovo | own_delivery | no | «No se despachó: sin dirección de entrega…» | 03/10 20:14 |
| 15BC4 | Birria Burrito · Uber (Last) | platform_delivery | no | — | 03/10 21:46 |

Con la regla nueva:
- **431** sería «Nosotros · falta la dirección», en ámbar y no en rojo (Scandal en Glovo es propio).
- **15BC4** no cambia.

Al desplegar, el saneado afectaría a 1 pedido vivo (el 431), si sigue abierto entonces.

## 7 · Staging

- `staging-conta`: **0 marcas, 0 políticas, 0 ventas.**
- Las cinco funciones (`resolve_dispatch`, `tg_auto_dispatch`, `tg_sale_service_type_por_interruptor`,
  `marca_reparte_propio`, `dispatch_watchdog_scan`) tienen la misma huella que en producción.
- Para las pruebas de la migración (0 diferencias) y los e2e hacen falta datos sembrados (§8.6).
- La rama aparece como Unhealthy (ya apuntado como pendiente); las consultas de hoy responden bien.

## 8 · Preguntas antes de la tarea 2

1. **El interruptor apagado.** El encargo dice «apagado → nada, hereda». Hoy `false` corta en todas las
   plataformas. Si Smash y Lovers heredan, pasan a «Nosotros» en Glovo, Uber y Just Eat (las tres filas `own` de
   `channel_delivery_policy` dicen `own_delivery`) y empezarían a despacharse.
   **Propuesta:** `false` → filas `platform` con `source='migrated'` en las plataformas donde la herencia diga
   `own`. Así 0 diferencias. Lo que Julio quiere de verdad (Smash: Uber «Nosotros»; Mila's y Urban Kebab: Uber
   «Plataforma») va como cambio a propósito, listado y aparte. ¿Vale, o prefieres que la migración ya deje los
   valores buenos?
2. **Last.** ¿La resolución nueva también **pone** el `service_type` de los pedidos de Last, o se respeta lo que
   dice Last? Hoy Last manda `ownDelivery` en Just Eat de marcas cedidas, y los 16 acabaron en rojo.
   **Propuesta:** aplicarla a las dos entradas, para que haya un único sitio que decide.
3. **La ayuda de la maqueta.** Con los datos de §4, «manda la dirección» bajo Glovo y Just Eat sería falso.
   **Propuesta:** la misma línea en las tres columnas («manda la dirección solo si la tienda es “reparto
   propio”»), y la sugerencia de la IA (3 seguidos sin dirección) para **todas** las plataformas, no solo Uber.
4. **`brand_price_grid`.** También lee `channel_delivery_policy`, para el precio que aplica.
   **Propuesta:** que pase a la resolución nueva por marca. Si no, la rejilla de precios y el reparto dirían
   cosas distintas. ¿Entra, o lo apunto como pendiente?
5. **Locales.** `channel_delivery_policy` admite filas por local (hoy 0 en producción). `brand_delivery_policy`,
   como está en el encargo, no tiene local.
   **Propuesta:** el local solo en la herencia, como pide la prueba del R01. Orden de resolución: celda marca ×
   plataforma → herencia del local → herencia de la cuenta → `platform`. ¿O quito el nivel de local?
6. **Datos de staging.** Staging está vacío.
   **Propuesta:**
   - sembrar en las cuentas A y B de staging marcas de prueba que reproduzcan los cinco casos (Smash, Lovers,
     Mila's/Urban Kebab, una propia normal y una cedida) con las seis políticas de Foodint;
   - además, la prueba de 0 diferencias contra **producción en solo lectura**: un `SELECT` que calcula la regla
     vieja y la nueva para cada marca × plataforma de Foodint sin escribir nada.
   - **Sin copiar datos de clientes a staging.**
7. **`source`.** El encargo lista `manual | inherited | ai_suggested` en el modelo y luego usa `migrated` en la
   migración. Los pongo los cuatro en el CHECK, salvo que digas otra cosa.
8. **La herencia de las cedidas.** La maqueta tiene una sola fila «Si no dices nada» (marcas propias) y pinta las
   cedidas como «la reparte siempre la plataforma».
   **Propuesta:** dos filas de herencia (propias y cedidas) porque `channel_delivery_policy` ya las tiene, o la
   de cedidas fija en «Plataforma» y sin fila. ¿Cuál?
