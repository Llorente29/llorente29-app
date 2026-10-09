# Cierre del día · Tarea 1 · Comprobaciones previas

Medido el 09/10/2026 en producción, **solo lectura**, cuenta Foodint (todas las
consultas con `account_id`). Repositorio en `89cc7176` (main).

## Resumen y decisiones que pido

| # | Pregunta | Respuesta corta |
|---|---|---|
| 1 | ¿`cancelled` con motivo o estado nuevo? | **`cancelled` con su marca** (columna nueva, que admite nulos). Un cuarto estado lo leerían como venta viva el KDS, el vigía de disponibilidad y 6 agentes, y una cancelación tardía de HubRise devolvería el stock. |
| 2 | ¿Qué hace un cancelado con el género? | **Devuelve el stock.** No hay ningún camino «anulado con la comida hecha → merma» en la base. Para no devolver nada hay que tocar **una condición** de `generate_sale_consumption` (camino del pedido → `autorizo`). |
| 3 | ¿Qué más se dispara? | Si el cierre cambia **solo** `status`, `cancelled_at` y su marca, sin tocar `order_status` ni `delivery_state`: **no imprime, no avisa, no despacha ni empuja nada a HubRise**. Solo corren `updated_at` y el consumo (punto 2). |
| 4 | ¿Cómo se casa con la liquidación? | Por `platform_order_code` normalizado, con candidato único y a ±2 días (`channel_settlement_match_recompute`). **En octubre no se puede medir: no hay ninguna liquidación cargada después del 30/06.** |
| 5 | ¿Dónde vive la hora y en qué zona? | `company_tax_profile`, junto a `journal_autovalidate_sales_day`. Se evalúa en `accounts.timezone` (las 4 cuentas: `Europe/Madrid`). La base corre en UTC. |

Antes de seguir necesito tres respuestas de Julio (al final, «Lo que pregunto»).

---

## 1 · Cómo se guarda «no confirmado»

`sale.status` admite `open | closed | cancelled` (`sale_status_valid`). Ya
existen `cancelled_at` y `cancel_reason` (texto libre), y también
`manual_close_reason` / `manual_closed_at`. Estos últimos son del «cerrar a
mano» del pase, que cierra como **venta** (`closed`), no como anulada.

### Quién lee `sale.status`, y qué haría con cada opción

Barrido de `pg_proc` (cuerpo que nombra `sale` y compara `status` con un
literal) y del front y las funciones edge (`from('sale')`: 24 ficheros). Sin
vistas: 0 vistas de `public` filtran `sale.status`.

| Quién | Qué condición | Con `cancelled` + marca | Con un 4.º estado |
|---|---|---|---|
| `kds_board` | `s.status <> 'cancelled'` y `s.status <> 'closed' or …` | fuera del tablero ✔ | **sale en el tablero de cocina** ✘ |
| `availability_sales_profile` | `s.status <> 'cancelled'` | no cuenta como venta ✔ | **cuenta como venta** ✘ |
| 6 agentes (`agent_*_signal`, `agent_campaign_uplift`) y `offers_goal_report` | `status not in ('cancelled','rejected')` | fuera ✔ | **dentro** ✘ |
| `tg_mirror_delivery_assignment` | `status not in ('cancelled','rejected','delivery_failed')` | fuera ✔ | dentro ✘ |
| `conta_dias_por_asentar`, `brand_partner_settlement_compute`, `pos_pending_delivery_sales` | `status = 'closed'` | fuera ✔ | fuera ✔ |
| `conta_pedidos_del_dia` | `status in ('closed','cancelled','open')` | **sale en la lista** (es lo que queremos enseñar) ✔ | desaparece ✘ |
| `pos_open_sales`, `hubrise_order_stuck_watchdog`, front `pedidosAtascados.ts` | `status = 'open'` | fuera ✔ | fuera ✔ |
| front `posTableService.ts:306` | `.neq('status','cancelled')` | no bloquea la mesa ✔ | **la bloquea** ✘ |
| `hubrise-webhook` (upsert) | `status !== 'open'` → no se re-adapta | un `completed` tardío no reabre ✔ | igual ✔ |
| `hubrise-webhook` (`cancelByOrderId`) | `status === 'cancelled'` → no hace nada | una cancelación tardía **no toca nada** ✔ | **llama a `cancel_sale` y devuelve el stock** ✘ |
| `lastapp-webhook` | «una venta ya `closed`/`cancelled` no se re-adapta» | ✔ | ✘ (no la reconoce como cerrada) |

**Decisión que propongo:** `status = 'cancelled'`, con una columna nueva que
diga de qué clase es el cancelado. Por ejemplo, `sale.unconfirmed_at
timestamptz` (que admite nulos; «añade», no pide `autorizo`) o `cancel_kind
text check in ('no_confirmado')`. `cancel_reason` lleva la frase («No
confirmado por la plataforma al cierre del día (6:00)»), pero **no se usa
para decidir**: es texto libre y ya trae 11 redacciones distintas en
septiembre.

## 2 · Qué hace hoy un cancelado con el género

- `cancel_sale` = `update … status='cancelled'` + `revert_sale_consumption`, que
  **borra el consumo**: devuelve el stock, salvo los ingredientes por debajo de
  un recuento aprobado, que quedan en `sale_consumption_skip`.
- Además, `tg_sale_consumption_on_complete` (AFTER UPDATE, **sin `WHEN`**)
  tiene una rama «ANULACIÓN»: si `status` pasa a `cancelled`, llama a
  `generate_sale_consumption`, y esa función trata la venta como nula
  (`v_void := status = 'cancelled' or order_status in ('cancelled','rejected')
  or not is_active`) y **borra el consumo**. Es decir, aunque el cierre no use
  `cancel_sale`, un `update status='cancelled'` a secas devuelve el stock.
- **La regla del 17/09 (anulado con la comida hecha → merma) no existe en la
  base.** En 60 días no hay ni un movimiento de tipo merma
  (`stock_movement`: `consumo`, `ajuste`, `recepcion`, `apertura`,
  `traspaso_*`). Los 10 anulados de Last que conservan consumo lo conservan
  **solo** porque caen por debajo de un recuento aprobado (motivo «anulacion
  por debajo del corte», 72 filas en 60 días), no por una regla de merma. Ese
  camino **no sirve tal cual**: para un pedido de ayer, sin recuento encima,
  devolvería el stock.

**Lo que hace falta:** que `v_void` no cuente como nula una venta cerrada como
no confirmada. Es una condición en `generate_sale_consumption`, y con ella
quedan bien las dos vías (el disparador y cualquier regeneración futura: los
botones de reprocesar, el recálculo de costes). Poner una bandera solo para el
momento del cierre no basta: la siguiente regeneración del consumo de esa
venta lo borraría igual. `generate_sale_consumption` está en el camino del
pedido: cambio en caliente con `autorizo`, ensayado por sus cuatro caminos
(regla 10).

**Lo que hay en juego hoy** (los 20 pedidos de marca propia abiertos de días
ya pasados):

| Cómo se quedó en la plataforma | Pedidos | Con consumo apuntado | Movimientos |
|---|---|---|---|
| Entrega fallida (HubRise) | 7 | 7 | 78 |
| Esperando recogida (HubRise) | 5 | 5 | 56 |
| Cancelado (HubRise) | 4 | 0 | 0 |
| Cancelado (Last, marca propia) | 3 | 0 | 0 |
| Rechazado (HubRise) | 1 | 0 | 0 |

Los 12 cocinados tienen 134 movimientos de consumo, que el cierre **no** puede
devolver. Los 8 que la plataforma dio por cancelados o rechazados ya no tienen
consumo: cerrarlos no mueve stock en ningún caso.

## 3 · Qué más se dispara al cambiar el estado

Los 16 disparadores de `sale`, con su condición, leída del cuerpo de cada
función:

| Disparador | Cuándo actúa | Con `update status, cancelled_at, marca` |
|---|---|---|
| `set_sale_updated_at` | siempre | sella `updated_at` (inocuo) |
| `trg_auto_dispatch` | `order_status` pasa a `accepted` (+ `own_delivery`) | no corre: no cambia `order_status` |
| `trg_auto_print_on_accept` / `_on_insert` | `order_status` pasa a `accepted` | no imprime |
| `trg_auto_print_bag_on_ready` | `order_status` pasa a `awaiting_collection` | no imprime |
| `trg_notify_on_way_sale` | `delivery_state` pasa a `in_delivery` | no avisa al cliente |
| `trg_sale_push_status` | `WHEN old.order_status ≠ new.order_status` | **no empuja nada a HubRise** |
| `trg_sale_close_on_complete` | `WHEN order_status pasa a completed` | no corre |
| `trg_sale_delivery_alarm` | `delivery_state` pasa a fallido o cancelado | no corre |
| `trg_sale_seal_delivered` / `_handed_to_courier` | cambios de `delivery_state` | no corren |
| `trg_sale_seal_kpi_hitos` | cambios de `order_status` | no corre |
| `trg_ensure_public_token` | `own_delivery` sin token | solo rellena el token si faltara (inocuo, sin salida) |
| `trg_sale_service_type_por_interruptor` | HubRise/Last, recalcula solo si faltaba modalidad, marca o canal | en estos 20 ya está resuelta; no cambia nada |
| **`trg_sale_consumption_on_complete`** / `_on_insert` | **cualquier cambio de `status` a `cancelled`** | **llama a `generate_sale_consumption`** → ver punto 2 |

**Regla para la función del cierre:** no escribe `order_status` ni
`delivery_state`. Así el único efecto colateral es el del consumo, que se
resuelve en el punto 2. El «cómo se quedó» que verá la pantalla sale del
`order_status` que ya tiene (`awaiting_collection` → «Esperando recogida»),
sin tocarlo. En staging se medirán `print_job`, los avisos al cliente y las
llamadas de `net.http_post` antes y después (tarea 2).

Tampoco interfiere el vigía `hubrise-order-stuck-watchdog` (cada 2 min). Solo
mira pedidos `new`/`received` de las últimas 3 horas.

## 4 · Cómo se casa un pedido con su línea de liquidación

`channel_settlement_match_recompute` (migración del 11/08) casa
`channel_settlement_order` con `sale` por
`_normalize_channel_order_code(platform_order_code)` (quita el `#` de Uber),
exigiendo **candidato único** y `abs(sale.created_at::date - order_date) <= 2`.

- Fiabilidad, medida donde hay datos (junio): 537 casadas (Glovo 304, Uber
  233), 21 sin casar de 6.638 líneas (17 son ajustes `add-XXXXX` de Glovo con
  importe 0). Glovo: el código es idéntico en las 304. De las 537, 489 caen el
  mismo día de Madrid (las demás, a −1 día: un pedido de pasada la medianoche
  en UTC).
- **Octubre: no se puede medir.** No hay ninguna `channel_settlement` con
  `period_to` posterior al **30/06/2026** (Glovo 120, Uber 70, Just Eat 57
  liquidaciones, todas hasta junio), y `channel_settlement_order` no tiene
  filas de julio en adelante.
- Lo que sí está bien: los 306 pedidos HubRise de octubre llevan
  `platform_order_code`. Los 20 abiertos también, y ninguno tiene otra venta
  con el mismo código normalizado a ±2 días: el casado sería único.

**Consecuencia para la tarea 4:** la regla «la liquidación manda» se puede
construir y probar en staging, pero en producción no actuará sobre nada hasta
que se carguen las liquidaciones de julio en adelante.

## 5 · Dónde vive el ajuste de la hora y en qué zona

- **Dónde:** `company_tax_profile` (uno por empresa), que ya guarda otro
  ajuste del diario, `journal_autovalidate_sales_day`. Columna nueva
  `sales_day_close_time time not null default '06:00'` («añade»). En pantalla,
  en Ajustes de la empresa, al lado de «Desde cuándo asienta Folvy» (el corte),
  que es lo que es del ejercicio.
- **Zona:** `accounts.timezone`, que hoy vale `Europe/Madrid` en las 4 cuentas.
  La base corre en `UTC` (`current_setting('TimeZone')`). Por eso el día se
  calcula siempre con `at time zone`, como ya hace `conta_dias_por_asentar`
  (regla 4 de CLAUDE.md). Un día D está cerrado cuando
  `now() >= ((D + 1) + hora_de_cierre) at time zone 'Europe/Madrid'`. Con eso
  el cambio de hora de octubre y de marzo queda resuelto por la propia zona.

## Lo que el encargo da por medido y aquí sale distinto

- **Pedidos abiertos de octubre: 9 (188,83 €)**, no 7 (153,13 €). La
  diferencia está en el criterio. Yo cuento todo lo anterior a hoy en Madrid;
  el encargo contaba «más de un día». Entran el 08/10 y 3 de Last.
- **3 de los 20 son de Last con marca propia.** El encargo dice que Last no se
  toca, pero se refiere a las marcas cedidas. Estos 3 son pedidos de marca
  propia que entraron por Last, ya cancelados en la plataforma y sin consumo.
- El asiento que hay que retirar es `journal_entry b4eb11ca…`, del 09/10,
  local `92d7656e…`, estado `propuesto`, creado a las 17:15:56 de Madrid, con su
  resumen `sales_day_summary 2d36c97e…`. El del 08/10 (`9169bd92…`) se propuso
  a las 17:15:57 del 09/10, ya pasadas las 6:00, así que con la regla nueva
  también se habría propuesto: se queda.

## Lo que pregunto antes de seguir

1. **Estado:** ¿`cancelled` con una marca de «no confirmado» (mi propuesta), o
   un estado nuevo pese a lo de la tabla del punto 1?
2. **Consumo:** ¿se toca `generate_sale_consumption` para que un no confirmado
   conserve su consumo, aunque esté en el camino del pedido y pida `autorizo`?
   Es una condición, ensayada por sus cuatro caminos. La alternativa sería
   dejar que el cierre devuelva el stock, que es lo que el encargo prohíbe.
3. **Los 8 que la plataforma ya canceló o rechazó** (sin consumo): ¿se cierran
   también como «no confirmado», o como un cancelado normal? Mi propuesta es
   usar el mismo cierre y que la lista diga en llano cómo se quedaron
   («Cancelado», «Rechazado»). ¿Y entran los 3 de Last con marca propia?
