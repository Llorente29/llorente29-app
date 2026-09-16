# RECON — El parte del día (§2 del encargo del 16/09)

**16/09/2026.** Los dos lados: el repositorio (`origin/main`, commit `6e7773b`) y la
base de producción (`xzmpnchlguibclvxyynt`, Postgres 17.6). Todo lo que lleva
cifra está medido hoy contra la base; lo que no se ha podido medir se dice.

Cuenta de trabajo: **Foodint** `51ad1792-6629-4ef7-833a-b57b09a86710`
(`status='active'`, `is_internal=false`). Las otras dos: `Kitchen Grill LstQ`
(suspended) y `Folvy Interno` (interna). Regla 9 aplicada en todas las cifras.

---

## 0 · Ficheros que cita el encargo y que NO están en el repositorio

| Fichero | Estado |
|---|---|
| `claude/ENCARGO_CODE_parte_diario_de_almacen_20260916.md` | no está (trabajo con el texto pegado) |
| `claude/folvy_parte_diario_descuento_METODO.md` | **no está** — y es el que lleva las consultas probadas |
| `claude/folvy_informe_ventas_15_09_y_lo_que_no_desconto_20260916.md` | no está |
| `claude/ENCARGO_CODE_alertas_estandar_20260908.md` | no está |
| `claude/folvy_kitchen_css_maqueta_20260907.md` | no está |

Buscado en `main`, en la rama de la sesión y en el historial entero
(`git log --all --diff-filter=A`): ninguno ha existido nunca en el repositorio.

---

## 1 · La cola de fiabilidad y su pantalla

**`warehouse_reliability_queue(p_account_id uuid, p_location_id uuid, p_days integer) → jsonb`**,
STABLE, 4.415 caracteres, `md5 87956f9c1ac459be0393cd02b651428`.

- La consume `src/modules/kitchen/services/warehouseReliabilityService.ts`
  (`useReliabilityQueue(accountId, locationId, DAYS)`), con `DAYS = 7`.
- La pantalla es **`src/modules/kitchen/pages/WarehouseReliabilityPage.tsx`**
  (551 líneas), props `{ accountId, locationId?, actorName?, onBack }`.

**Y aquí está el primer desajuste con el §4: la cola no vive en Almacén.**
Vive en **Cartas**: se abre desde `KitchenMenuPage.tsx:1177`, y se abre
**sin local** — `locationId` no se pasa, así que hoy la cola es de toda la
cuenta. El módulo Almacén es `src/modules/supply/` (entrada de menú
`supply_inventory`, label «Almacén»); no enlaza la cola por ningún sitio.

**Rama `feat/fiabilidad-almacen-cola`: fusionada.** PR #5, commit `43671f39`;
el fichero de la página está en `origin/main`. El ref remoto sigue existiendo y
diverge por un force-push antiguo (`origin/main..origin/feat/fiabilidad-almacen-cola`
= 5 commits, todos viejos). No hay nada pendiente de fusionar ahí.

---

## 2 · Lo demás de la tabla del §2, una a una

| Pieza | En la base | Nota |
|---|---|---|
| `sales_unmapped_products(uuid, int)` | STABLE ✔ | **ninguna pantalla la llama**: `grep sales_unmapped src/` = 0 |
| `_sales_unmapped_products_raw(uuid, int)` | STABLE ✔ | solo la usa el vigía |
| `sales_unmapped_watchdog(int, int)` | VOLATILE ✔ | cron `sales-unmapped-watchdog`, `20 * * * *`, `(30, 10)` — coincide con el encargo |
| `avt_consumption_coverage(uuid)` | STABLE ✔ | devuelve lineas_tocan/descuentan/vendidas/con_consumo/sin_mapear + modif_* |
| `_sale_line_raw_consumption(uuid)` | STABLE ✔ | **toma la LÍNEA, no la venta** |
| `generate_sale_consumption(uuid)` | VOLATILE ✔ | 16.401 caracteres, escritor único |
| `reprocess_sale(uuid)` | VOLATILE ✔ | re-casa marca + líneas + coste y llama al escritor |
| `cancel_sale(uuid, text)` | VOLATILE ✔ | `update sale` + `revert_sale_consumption` |
| `cortes_aprobados(uuid, uuid[])` | STABLE ✔ | corte **por artículo**, `counted_at` del recuento aprobado |
| `sale_consumption_skip` | tabla ✔ | account_id, sale_id, recipe_item_id, location_id, fecha_venta, corte, motivo, created_at |
| `external_webhook_log` | tabla ✔ | source, headers, payload, note, processed, created_at |
| `lastapp_webhook_log` | tabla ✔ | received_at, headers, payload, processed, note |
| `parte_del_dia`, `parte_*` | **no existen** ✔ | nada que empiece por `parte` en `public` |

**Regla 9, aviso:** ni `external_webhook_log` ni `lastapp_webhook_log` tienen
`account_id`. Toda cifra sacada de ahí es de todas las cuentas mientras no se
ancle por el payload, y hay que etiquetarla como tal.

**Tres vigías de la misma familia que el encargo no nombra** y que hay que
decidir qué pasa con ellos cuando entre el aviso de las 08:30, porque avisan de
lo mismo por otro lado:

- `ventas-cerradas-sin-consumo` — `20 * * * *` → `ventas_cerradas_sin_consumo_watchdog()` (12.196 car.)
- `consumo-fallos-y-atajo-motor-viejo` — `35 * * * *` → `consumo_sin_descontar_watchdog()` (3.038 car.)
- `codigo-plataforma-watchdog` — `25 * * * *`

---

## 3 · El reproceso de las 01:30 — la mitad del §3.2 ya está hecha, y la otra mitad no es la que parece

Cron `sales-consumption-reprocess`, `30 1 * * *`,
`select public.cron_recompute_missing_sale_consumption(2)` ✔.

Leído el cuerpo en producción (2.279 caracteres), **ya tiene dos ramas de
candidatas**: (a) la venta sin NINGÚN movimiento en los últimos `p_days`, y
(b) toda venta con fila abierta en `sale_consumption_failure`. El comentario de
la (b) dice literalmente que es para el consumo a medias.

**Pero la (b) no cubre lo que pide el §3.2.** `sale_consumption_failure`
(sale_id, account_id, location_id, **sqlstate**, message, first_failed_at,
last_failed_at, attempts, resolved_at, resolved_movements) solo recoge ventas
cuyo consumo **reventó con un error**. Un consumo que sale a medias **sin
excepción** no deja fila ahí. Medido: **la tabla tiene 0 filas**. Esa rama no
está recogiendo nada hoy.

Queda por construir, entonces:
1. la candidata por **«faltan > 0»**, comparando lo que debía restar contra lo restado;
2. la de **líneas sin plato cuyo código ya casa con ficha viva**, que va por
   `reprocess_sale` (re-casa) y no por `generate_sale_consumption`.

**Y un aviso sobre el corte de la regla 6, porque hay dos definiciones vivas:**
el cron corta con `max(ic.closed_at)` del último recuento aprobado **de la
cuenta + el local**; `cortes_aprobados` corta **por artículo**, con
`counted_at`. No son lo mismo. El §3.1.2 pide una cifra de «retenidos por
recuento» (5 el 15/09): hace falta saber con cuál de los dos cortes se sacó ese
5 antes de escribir la función — y el `METODO` es donde está escrito.

---

## 4 · Con qué se casa un pedido con su plataforma (medido, y el encargo acierta)

Foodint, 15/09, 96 filas (94 vivas + 2 anuladas):

| columna | valores distintos | ¿sirve para casar? |
|---|---|---|
| `pos_short_code` | 88 | **NO** — repite 8 veces en un solo día |
| `platform_order_code` | 96 | sí |
| `external_ref` | 96 | sí |
| `platform_order_ref` | 24 | solo lo traen las de hubrise |

Los ocho repetidos: G192, G221, G361, G422, G504, G549, G645, G834.
Comprobado que **no son el mismo pedido duplicado**: los tres pares
lastapp/hubrise (G221, G504, G549) tienen id de plataforma distinto, marca
distinta e importe distinto. El código corto choca de verdad; casar por él
mezclaría pedidos ajenos. **Se casa por `platform_order_code`**, como dice el
encargo.

**El detalle que hay que dejar escrito en el código para no equivocarse: la
misma columna guarda cosas distintas según el origen.**

- `source='lastapp'`: `platform_order_code` = **id largo de la plataforma**
  (Glovo `101773934344`, Uber `FD259`) · `platform_order_ref` = NULL ·
  `external_ref` = id del bill en Last · `pos_short_code` = `G711`, `U493`…
- `source='hubrise'`: `platform_order_code` = **el número corto** (`592`) ·
  `platform_order_ref` = id largo de la plataforma (`101773955710`) ·
  `external_ref` = id del pedido en HubRise (`xnnvve3`).

→ el puente entre las dos mitades, si algún día hiciera falta, es
`lastapp.platform_order_code = hubrise.platform_order_ref`. (El §3.3 pide que no
se relacionen; queda apuntado solo para que nadie lo descubra por accidente.)

---

## 5 · Las cifras de referencia del §3.1: las dos primeras, ya comprobadas

Foodint, 15/09, `sold_at` convertido a `Europe/Madrid` (regla 4):

**94 pedidos vivos · 2.093,07 € · 2 anulados** ✔ exacto.

Y una cosa medida de paso: **da igual el corte de día**. Con el día de negocio
de las 04:00 (commit `3645c0e`) y con la medianoche salen las mismas cifras — el
15/09 no hubo ventas entre las 00:00 y las 04:00. Aun así el parte tiene que
elegir uno y decirlo.

Los dos anulados son **G379** (`101774443525`, 21,54 €) y **G895**
(`101774559105`, 24,82 €), los dos puestos en `cancelled` **el 16/09 a las
09:53:52** a mano, y hoy con **0 movimientos de stock** colgando.

---

## 6 · Las anulaciones de Last SÍ llegaron, y están guardadas

En `lastapp_webhook_log`, anclando por el id de bill de cada uno:

| pedido | bill:created | tab:created | bill:deleted |
|---|---|---|---|
| G379 | 20:44:07 | 20:44:07 (`processed=true`) | **21:14:32 · `processed=false`** |
| G895 | 22:26:06 | 22:26:07 (`processed=true`) | **22:32:07 · `processed=false`** |

Horas de Madrid. Cuadran al minuto con el `cancel_reason` que se escribió a mano
(«anulado en Last 21:14 / 22:32»).

**Consecuencia para el §3.3:** para las cedidas, **el cruce no necesita la API de
Last para ver las anulaciones** — la prueba ya está dentro, en el log de la
frontera, con `processed=false`. La API sigue haciendo falta para lo otro: ver el
pedido **cuyo aviso nunca llegó**, que es justo lo que un log no puede enseñar.

---

## 7 · Con qué se le pide el día a Last

`supabase/functions/lastapp-backfill-sales/index.ts`:

- **Listado:** `GET https://api.last.app/v2/bills?locationId=<loc>&startDate=<YYYY-MM-DD 00:00:00>&endDate=<… 23:59:59>&limit=100`,
  con `Authorization: Bearer <token>` y cabecera `locationID`.
- **Detalle:** `GET /v2/bills/{billId}`.
- **Token:** `external_integration.token_secret_name` → secreto de entorno. En
  Foodint es `LASTAPP_TOKEN_FOODINT_NUEVO`, con dos filas: org
  `b7bc4753-…` activa y org `31f13f35-…` inactiva.
- **Techo de 100 por día y por local.** El propio backfill apunta el día en
  `day_overflows` cuando la lista viene con 100. Hoy no muerde (82 ventas de
  Last en toda la cuenta el 15/09, repartidas en dos locales), pero la pasada
  diaria del §3.3 tiene que paginar o, como mínimo, cantar el desbordamiento:
  un día truncado daría un cuadre falso en verde.
- El backfill **no lee ningún campo de anulación** del bill: solo
  `creationTime`, `total`, `deliveryFee`, `discountTotal`, `payments[0].type`,
  `products` y `locationBrandId`. **Qué devuelve `/bills` para un bill borrado no
  se puede saber desde aquí**: hace falta el token y una llamada de verdad.

---

## 8 · HubRise: hoy Folvy NO puede pedir el listado de pedidos del día

El único sitio donde Folvy pide permiso es `hubrise-oauth-start`, y tiene una
lista blanca **cerrada** de dos scopes:

- `account[all_catalogs.write,inventory.write]` (writer)
- `location[orders.write]` (location)

**Ninguno incluye `orders.read`.** Las conexiones de Foodint en
`external_integration` (source=hubrise): dos vivas — Alcalá `1b6p8-0` y
Carabanchel `1b6p8-2`, `token_status=ok`, `callback_status=ok`, push activo — y
tres archivadas de los puentes de Glovo, Just Eat y Uber.

**Respuesta al RECON del §3.3: no, con lo que hay hoy no se puede listar el día
de HubRise.** O el parte dice en el pie «Solo comparado con los avisos
recibidos» —que el propio §3.3 ya prevé—, o hace falta volver a autorizar
pidiendo `orders.read`, que es un sí de Julio y una vuelta entera al flujo
OAuth. Si el token ya concedido trae el permiso de hecho, solo se sabe haciendo
la llamada con él; no se puede deducir de la base.

---

## 9 · Deuda que me encuentro de paso y no toco (§6)

`SalesExceptionsPage` sigue llamando `list_costless_sold_products`, retirada de
la base el 02/09 — es el caso que ya está escrito en la regla 40 de `CLAUDE.md`.
El commit que lo arregla (`01c1cdf3`, «La pantalla de excepciones deja de caerse
entera por una RPC retirada») **no está en `main`**. Queda apuntado; no abro
frente.

---

## 10 · Lo que necesito para seguir con el paso 2

1. **`claude/folvy_parte_diario_descuento_METODO.md`.** Las cifras de referencia
   del §3.1 (992 bien · 5 retenidos · 258 de 259) dependen de las definiciones
   exactas de ese método —sobre todo de cuál de los dos cortes de la regla 6 se
   usó para los 5 retenidos—. Reconstruirlas a ojo sería escribir la prueba
   contra mi propia suposición, que es exactamente lo que prohíbe la regla 31.
2. **Dónde va el parte.** El §4 dice «Almacén, arriba de la cola de fiabilidad
   que ya existe», y la cola vive en Cartas y sin local. Tres salidas: llevar la
   cola a Almacén, poner el parte donde está la cola, o el parte en Almacén
   enlazando a la cola.
3. **La rama.** El §6 pide `feat/parte-diario-almacen` desde `main`; la sesión
   viene amarrada a `claude/cool-mccarthy-5we9rc`.
