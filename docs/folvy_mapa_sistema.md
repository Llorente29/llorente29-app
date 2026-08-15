# Folvy — MAPA DEL SISTEMA (inventario verificado contra BBDD)

> **Qué es esto y por qué existe.** Defensa contra la *omisión*: cosas que una sesión supo y no escribió, y que la siguiente redescubre (o duplica). Aquí van HECHOS estables verificados contra fuente primaria (BBDD/código/panel), con **fecha y fuente**, separados del `estado` volátil. **Regla de oro: todo hallazgo de RECON que contradiga o amplíe un doc se escribe aquí en el momento.**
>
> No sustituye a la BBDD (que sigue siendo la verdad). Es el índice que dice *dónde mirar* y *qué supera a qué*, para no volver a partir de cero.

---

## ⚠️ PATRÓN QUE MÁS DESPISTA: "estructuras sin combustible" (25/07/2026)

**La tabla/columna existe y parece disponible, pero no tiene dato vivo.** **Antes de diseñar sobre cualquier señal, contar filas Y mirar la fecha del último dato.**

| Estructura | Parece | Realidad |
|---|---|---|
| `delivery_assignment` | Línea de tiempo del reparto | **0 filas** para 454 pedidos own_delivery/30d (todo va por Catcher) |
| `channel_review` / `channel_incident` | Reseñas e incidencias | **55/30 filas, TODAS de enero 2026, solo Uber.** Sin feed |
| `sale.handed_to_courier_at` | Hito "recogido" | **Casi nunca se sella**: Catcher manda `in_delivery` 1 de cada 454 |
| `clock_entries.scheduled` / `diff_minutes` | Puntualidad | **NULL y 0 siempre** → **la puntualidad NO es medible** |
| **`recipe_item_production_check`** *(26/07)* | QC de plato por foto con IA (modelada completa) | **0 filas.** Nunca usada. Ver §Visión |
| **`lastapp_catalog_product` / `lastapp_product_map`** *(28/07)* | Modelo de casado LastApp (aparece en código VIEJO del repo) | **NO EXISTEN** (`to_regclass`=NULL). Reemplazadas por el modelo `external_*`. Ver §Casado |
| **`menu_item.is_available`** *(30/07)* | El flag del 86 | **NO es el 86.** El 86 vive en `product_availability`. 141 filas en false (mass-set 4-jul, 29% de la carta) = anomalía aparte. Ver §Disponibilidad |

## ⚡ RENDIMIENTO DE CONSULTAS — el anti-patrón "empezar por la tabla grande" (28/07/2026)

**Descubierto diagnosticando el timeout de la pantalla de fiabilidad (3 funciones afectadas).** Varias RPC construían su consulta **arrancando desde `sale_line`** (filtrando por `account_id`) y luego juntaban con `sale` UNA A UNA para filtrar por fecha. En Foodint eso recorre las ~14.000 líneas de TODA la historia (el 84% de la tabla) y sondea `sale` ~9.265 veces → **~255 MB de buffers para devolver ~100 filas**.
- **Hot (páginas en RAM): ~50-70 ms**, engañosamente rápido. **Cold (caché desalojado / carga concurrente): >15 s → `statement_timeout`.** Por eso el síntoma era intermitente. **`EXPLAIN (ANALYZE, BUFFERS)` sobre datos calientes MIENTE sobre el coste real; mirar BUFFERS (páginas tocadas), no solo el tiempo.**
- **Arreglo canónico:** CTE `... as materialized` que filtra **`sale` por cuenta+fecha PRIMERO** (usa `idx_sale_sold_at`) y engancha `sale_line` por **hash join**. Buffers 255→43 MB. `MATERIALIZED` es obligatorio (sin él el planificador vuelve al seq-scan de `sale_line`, estima mal por `coalesce(line_type,'product')`).
- **Verificar equivalencia antes de aplicar:** md5 del `jsonb_agg` o `row() is not distinct from row()`. **Guardia:** toda RPC pesada `set statement_timeout`.
- **Funciones ya corregidas (28/07):** `warehouse_reliability_queue`, `sales_mapping_reliability`, `create_dish_from_unmapped`.

## 🧨 TRAMPAS DE APLICACIÓN (leer antes de tocar BBDD o desplegar)

- **`supabase db push` NO funciona aquí.** Los ficheros usan `YYYYMMDD'T'HHMM_desc.sql` (con "T"), que la CLI **rechaza**. *(23/07.)* Nunca sugerir `db push` ni `migration repair`.
- **🔴 EL SQL EDITOR SE TRAGA STATEMENTS EN SILENCIO — NO FIARSE DEL "Success".**
  - *(26/07)* Las migraciones con **`begin;`/`commit;`** las **DESCARTA**: "Success. No rows returned"… y no aplica nada. → quitar el begin/commit para aplicar a mano.
  - *(30/07, Fase B — el más caro)* Incluso SIN begin/commit, el editor reportó "Success" pero **NO creó objetos SUELTOS** (`CREATE UNIQUE INDEX`, `CREATE TRIGGER`, un `DELETE` del reset), sin patrón claro. Los INSERT/ALTER/CREATE TABLE sueltos sí se aplican fiables; los objetos del medio de un script se pierden.
  - → **REGLA: verificar CADA objeto con query independiente después** (`pg_indexes`/`pg_trigger`/`pg_get_functiondef`/`information_schema`). Operaciones críticas: **una sentencia por Run**. Cada migración con **guard `DO`** que aborte si el objeto no queda (1ª red; la query independiente es la de verdad). *(`apply_migration` por MCP sí aplica de verdad y lo registra en `schema_migrations`.)*
- **PostgREST cachea el esquema** (25/07): una RPC creada por SQL no está expuesta hasta `notify pgrst, 'reload schema';`.
- **Ejecutar las verificaciones POR SEPARADO**: un bloque multi-statement solo devuelve el resultado del ÚLTIMO SELECT.
- **`supabase.rpc` NO se puede extraer a una variable** (25/07): pierde el `this`, la petición nunca se envía. Usar `.bind(supabase!)`.
- **Parchear una RPC viva sin re-transcribirla** (25/07): `pg_get_functiondef` + `replace()` sobre anclas con guardas + `execute`.
- **Cruces con `clock_entries`: filtrar SIEMPRE por `location_id_at_clock`** (25/07).
- **RECON de menús: cuidado con inflar conteos** (JOIN a `menu_category` multiplica). **Y cuidado con `LIMIT` escondido** *(30/07: un `limit 30` hizo creer "28 colisiones" cuando eran ~100)*.
- **`ON CONFLICT (cols) DO NOTHING` necesita un índice ÚNICO que case EXACTAMENTE esas columnas** *(30/07)* — si no, se duplican filas en silencio. En multi-tenant, el unique de tabla por-cuenta va **compuesto `(account_id, ...)`**, no global.
- **`UPDATE ... FROM ... WHERE target.col = t.col`**: la condición que referencia la tabla objetivo va en el WHERE, no en el ON *(30/07)*.

## 🔴 DRIFT REPO ↔ PRODUCCIÓN — el patrón más caro (verificado 26-28/07)

**Producción va por delante del repo, y un despliegue/migración rutinario desde git puede REVERTIR mejoras o ROMPER en silencio.**

| Caso | Qué pasó |
|---|---|
| **`create_dish_from_unmapped` / `run_mapping`** *(28/07)* | Migración de Code escrita contra modelo MUERTO (`lastapp_*`, `to_regclass`=NULL; el vivo es `external_catalog_product`). Aplicarla habría roto la función. **Solución: fusionar** sobre el cuerpo vivo. |
| **`catcher-dispatch`** *(26/07)* | La función viva (v37) lee el secreto de Vault; el repo seguía con el secreto hardcodeado. Un deploy desde git habría revertido la mejora. **Fusionar, no sobrescribir.** |
| **`bag_on_ready`** *(26/07)* | Columna + trigger existen en BBDD y en NINGUNA migración. Sin versionar. |
| **`20260730T1740` borrada del disco** *(30/07)* | El fichero de la migración de Cap. B (columnas brand.closure_*, funciones de cerrar marca) **desapareció del working dir** (git `D`) por un hipo del entorno; estaba en el commit → restaurado con `git restore`. Vigilar: el entorno puede tocar ficheros. |

→ **Regla dura: antes de aplicar CUALQUIER migración del repo, comparar la función viva (`pg_get_functiondef`) con el fichero.** Ver `folvy_reglas.md` §2. **`internal_secret()` existe y está probado** → receta para sacar el `x-order-advance-secret` hardcodeado de `trg_sale_push_status`.

## 🚦 Módulo de DISPONIBILIDAD (86 producto/marca/local + horarios) — arquitectura verificada (30/07/2026)

**Desplegado Fase 0/A/B + pulido. Diseño y estado: `claude/folvy_hubrise_cierre_pausa_horarios_diseno.md`. Modelo 0-bis: el 86 tiene DUEÑO por integración — HubRise lo controla Folvy; Last lo controla Last (Folvy NO escribe en Last).**

- **El 86 vive en `product_availability`** (fila = artículo agotado), NO en `menu_item.is_available`. `set_product_availability`(v6)/`_by_token` insertan/borran filas y despachan a HubRise. Panel `availability_panel`(`_by_token`) une dos dominios: Folvy (`product_availability`) + Last (`external_catalog_product.is_enabled`, en LECTURA — "gestionar en Last").
- **`menu_item.external_id` es INTOCABLE.** En filas `external_source='lastapp'` ES el `organizationProductId` de Last = la clave con la que `adapt_lastapp_order` casa las ventas entrantes. Se comparte **entre marcas Y entre cuentas** (por eso las colisiones). Cambiarlo rompe el casado de ventas del cliente vivo.
- **Namespacing SOLO en la capa HubRise** (`_shared/hubriseSku.ts`, única fuente para publish + dispatch): con grupo → `stock_group.hubrise_ref` (compartido, "una nevera"); sin grupo → `{brand.slug}:{external_id}` (per-marca). Cada catálogo HubRise solo conoce sus refs → **auto-filtro por marca** (empujar un ref a otro catálogo es inofensivo).
- **`stock_group`** (`account_id`, `name`, `hubrise_ref='shr_'||external_id`, **UNIQUE compuesto `(account_id, hubrise_ref)`**) + **`menu_item.stock_group_id`** + trigger `trg_menu_item_inherit_stock_group` (auto-herencia por external_id en INSERT/UPDATE). Seed: 19 grupos compartidos (bebidas+postres+Tequeños/Alitas/Feta); el resto per-marca (default seguro: lo nuevo nace aislado, nunca 86 cruzado).
- **Cerrar local + horarios:** `PATCH /locations/:id` (`order_acceptance` paused/busy/normal + `resume_at`; `opening_hours` = objeto de 7 días, claves inglesas, `[]`=cerrado, cruce medianoche `to:"01:00"`). **Token = el de BRIDGE** (`resolveHubriseToken`, `location[orders.write]` — verificado HTTP 200; el escritor NO cubre location). Edge `hubrise-location-dispatch` (`--no-verify-jwt`). Registro `location_status_log` (`set_by`, `created_at`, `resume_at`, `reason`, `surface`, `kind`, `brand_id`, `resolved_at`). Festivos por fecha NO tienen API (semanal) → la UI avisa.
- **Cerrar marca:** `set_brand_status`/`_by_token` + `brands_for_closure` (solo marcas con presencia en HubRise vía `brand_hubrise_catalog`; **cedidas fuera**). 86 masivo de los ref per-marca (nunca compartidos). `availability-dispatch` v7 empuja cada ref solo a los catálogos de sus marcas (`brand_hubrise_catalog`, fallback `external_integration`).
- **`brand_hubrise_catalog`** (Fase 2 self-service, mergeada): `brand_id → external_catalog_id + external_location_id`. **9/9/9 en Alcalá** (1 catálogo por marca).
- **`availability_push_log`**: cada empuje a HubRise. `external_catalog_id` (text) + `organization_product_id` (text[]) — **retipados de uuid a text** (el ref namespaced y el catalog_id NO son UUIDs → antes salían null).
- **Semáforo/alarma:** `LocationStatusCard` (local) + `ClosedBrandsCard` (marcas) en Disponibilidad; `ClosuresChip` (discreto) + `ClosureAnomalyAlarm` (indefinido/vencido) en Pedidos (componente compartido `OrdersFeed`, web+tablet). `availability-watchdog` (cron 15 min) + `anomalous_brand_closures` RPC. **Cierre con duración → HubRise reabre solo (`expires_at`); indefinido → depende de reabrir a mano.**
- **Interruptor + aviso multi-integrador (Fase 0):** `locations.availability_auto_mode` (default 'manual') + `availability_other_integrators`; al 86 → banner ámbar "desconéctalo en Last/Otter".
- **Secretos del módulo:** `availability_dispatch_secret` (`fv_avl_...`, **estuvo en git history → ROTAR**) y `location_status_dispatch_secret` (`fv_locst_...`, en Vault+env, NO en git → no rota).

## Casado de ventas ↔ platos — modelo VIVO (verificado 28/07/2026)

- **El modelo canónico es `external_*`**: `sale_line.external_product_id` + **`external_catalog_product`** (`organization_product_id`, `external_brand_name`, `external_channel`, `product_type`, `price_cents`) + `menu_item.external_source='lastapp'`/`external_id=matrícula`. Foodint: **2.877 filas**.
- **`lastapp_catalog_product`/`lastapp_product_map` NO EXISTEN** (modelo viejo). Si un PR los referencia = drift viejo.
- **`run_mapping`** tenía DOS overloads (drift) → ERROR 42725, tragado por `catch(()=>setSug([]))` → "no se parece a ningún plato" para TODOS. Arreglo (28/07): DROP del de 5 args + cliente pasa `p_target_types:['dish']`.
- **`create_dish_from_unmapped`**: firma `(uuid, text, boolean p_confirm_create)`, 7 columnas, anti-duplicado por `similarity() >= 0.6`, recast SOLO del producto (no `recast_lastapp_sales(cuenta)` = timeout).
- **Duplicado real:** un plato físico puede tener DOS matrículas LastApp (una casada, otra no). similarity 0.90.

## Secretos
- Conviven (a) **Vault** vía `account_connector` + `connector_secret_read` (Catcher, Last, Glovo) + **`internal_secret()`** (catcher-dispatch v37) + `location_status_dispatch_secret`, y (b) **`external_integration.access_token` en texto plano** (HubRise).
- ⚠️ **Secreto HARDCODEADO** en `trg_sale_push_status` (`x-order-advance-secret`). ⚠️ **Bucket `delivery-proof` PÚBLICO**. ⚠️ **`AVAILABILITY_DISPATCH_SECRET` estuvo en git history → rotar.**

## Pedidos / cocina — internals de `sale` verificados (25-26/07/2026)

- **`order_status` es `text` con LISTA BLANCA en las RPC**: `new, received, accepted, in_preparation, awaiting_collection, awaiting_shipment, in_delivery, completed, rejected, cancelled, delivery_failed`.
- **Dos RPC mueven el estado** (`SECURITY DEFINER`): `set_order_status` (sesión) y `set_order_status_by_token` (Estación).
- **El pedido entra YA IMPRESO** (`trg_auto_print_on_insert`/`on_accept`) → 0 estados intermedios → el KPI ancla el INICIO en el INSERT.
- **617 de 621 llegan a `completed`** en 7 días. 3 atascados en `accepted`.
- **`trg_sale_push_status`** empuja al canal; `order-advance` mapea `awaiting_collection → READY_TO_PICKUP`. Foodint `push_status_enabled=true`.
- **`kds_device`** *(28/07)*: contención de locks (tablets sobre la misma fila). Pendiente investigar.
- **`OrdersFeed`** es el componente COMPARTIDO web (`OrdersFeedPage`) + tablet (`TabletStationRoute`) → una edición cubre ambas. La tablet NO tiene `AppContext` garantizado → pasar `accountId`/`token` como prop, no `useApp()` dentro.

### KPI de cocina — EN PRODUCCIÓN (25/07)
- Columnas `sale.accepted_at`/`ready_at`/`delivered_at`/`handed_to_courier_at`. Triggers `trg_sale_seal_kpi_hitos` (`ready_at` en 1ª transición a awaiting/in_delivery, **`completed` EXCLUIDO**), `trg_sale_seal_delivered`, `trg_auto_print_bag_on_ready`.
- **`kitchen_time_config`** (PK `location_id`): green 15 · amber 25 · ceiling 30 · floor 3 · `bag_on_ready` (solo Alcalá) · `bag_qr`.
- RPC `kitchen_day_banner`(+`_by_token`) + `kitchen_time_stats`. Objetivo del banner = green (15). ⚠️ locales duplicados por nombre (sandbox vs prod, `location_id` distinto).

## Impresión — el camino completo (verificado 26/07/2026)

| Local | Impresoras | doc_types |
|---|---|---|
| **Alcalá** | "Cocina"·"Pase" | `[kitchen]`·`[bag]` |
| **Plaza Castilla** | NT311 | `[bag,kitchen,labels]` |
| **Carabanchel** | **NINGUNA** | — |

⚠️ Alcalá NO imprime pegatinas. Carabanchel no imprime por Folvy. **QUIEN IMPRIME ES LA TABLET (APK)**, no el agente Node (copia gemela fuera del repo). Cambiar el papel exige APK nueva (`webDir:'dist'`, sin `server.url`). **17% de fallo histórico** (socket inalcanzable, cesaron 22/07). ⚠️ `tg_auto_print_bag_on_ready` traga TODOS los errores. Los "2 duplicados" = `reprint_order` con `doc_type=NULL` (cocina+bolsa). `report_device_app_version`/`station_update_window` desde 26/07.

## Códigos de pedido — cuál identifica (verificado 26/07)

| Canal | `platform_order_code` | `pos_short_code` | Repartidor canta |
|---|---|---|---|
| **Glovo** | 12 dígitos | `G357` | los 3 dígitos |
| **Uber** | 5 alfanum | `U538` | últimos 3-4 |
| **Shop** | `FS`+5hex | casi NULL | lo que Folvy mande |

⚠️ El código cantado NO es único (Glovo 17 pares/30d). Helper único `src/modules/orders/lib/passCode.ts` (test de arquitectura). `catcher-dispatch`: solo `own_delivery`+`lastapp` (Glovo/JustEat marketplace).

## Visión en cocina — qué existe ya (26/07/2026)
- `sale` NO captura imagen. `recipe_item_production_check` existe (QC por foto IA), **0 filas**, grano receta+local. `kitchen_settings.photo_retention_days` existe. Buckets privados salvo ⚠️ `delivery-proof` PÚBLICO. **VLM en nube gana 286x → Jetson descartado.**

## Reparto propio — DÓNDE vive el dato del rider (25/07/2026)
- `delivery_assignment` SOLO flota propia → 0 filas. El dato real (Catcher) vive en el ESPEJO de `sale` (`rider_name/phone`, `delivery_state`, `transport_price` ~10% vs `delivery_cost` siempre, `carrier_*`). UI doble-fuente y degrada. El coste NO va en la tarjeta: va el tiempo de reparto = `delivered_at − coalesce(handed_to_courier_at, ready_at)`.

## Tablets / APK (25-26/07/2026)
- La app empaqueta la web (`webDir:'dist'`, sin `server.url`) → deploy de Vercel NO llega; hace falta APK + `UpdateGate`. `build-apk.yml` lee `git log -1` del HEAD → `[force-update]` en el mensaje del MERGE. No se audita qué versión corre cada tablet (en vías, `kds_device.app_version`). OTA con `@capgo/capacitor-updater` decidido; Appflow cierra 31/12/2027.

## HubRise — arquitectura verificada (23-30/07/2026)

- **Token por conexión = `external_integration`** (source='hubrise'): `access_token` + `external_catalog_id` + `connection_name` + `external_location_id`. **NO existe `hubrise_integration`.**
- **Conexión "Folvy escritor"** (29/07): OAuth propia scope `account[all_catalogs.write,inventory.write]`, token en Vault (`hubrise_writer_connection`) → **publish + 86 escriben por aquí** (no por bridges, que son de lectura y daban 403). **`hubrise-catalog-publish`** (verify_jwt ON) + **`availability-dispatch`** (`--no-verify-jwt`).
- **Token de BRIDGE** (`external_integration.access_token`, `location[orders.write]`): **sirve para `PATCH /locations` (order_acceptance + opening_hours)** — verificado HTTP 200 (30/07). Corrige la nota vieja "scope = location[orders.write] → falta catalog.write": el catálogo va por el escritor; el location, por el bridge.
- **Publicador:** `{brand_id}` → `external_brand_map` × `external_integration` (o `brand_hubrise_catalog`, Fase 2); `PUT /catalogs/:id` REEMPLAZA el catálogo entero → **1 catálogo POR MARCA**.
- **Money**: el webhook es ciego a la moneda → la cuenta en EUR.
- **Edge Functions HubRise** (ACTIVE): `hubrise-webhook`, `hubrise-order-status`, `hubrise-catalog-publish`, `hubrise-callback-ensure`, `hubrise-oauth-start/-callback`, `hubrise-location-dispatch`, `availability-dispatch`, `availability-watchdog`.

## HubRise — F0.2: NO RESUELTA (test 15/08 mal diseñado — re-test en curso)

**Método**: sin OrderLine (es app receptora, no genera pedidos — corregido en el encargo el 15/08).
Llamadas HTTP directas a HubRise desde SQL vía `pg_net` (`net.http_post`/`net.http_get` +
`net._http_response`, el mismo mecanismo que ya usan los `cron.schedule`), contra el laboratorio
`zy9j2` ↔ cuenta Folvy **Folvy Interno** (`00000000-0000-0000-0000-000000000001`). Nada de esto tocó
la cuenta `1b6p8` (Foodint) ni la conexión `Folvy Test` de producción.

**Paso previo — el token de cuenta original NO tenía scope de pedidos.**
`hubrise_writer_connection` de Folvy Interno se había autorizado (06/08→15/08) con
`account[all_catalogs.write,inventory.write]` — el mínimo recomendado por la guía de integración.
Con ese scope: `POST /v1/locations/zy9j2-1/orders` → **403** `"A 'orders' write scope is required"`;
`POST /v1/callback` con eventos `order.*` → **422** `"orders scope required"`. Bloqueaba la pregunta
antes de poder hacerla — no demuestra nada sobre "por location vs por cuenta" todavía.

**Julio reautorizó** (15/08, 12:42) la MISMA conexión (`hubrise_writer_connection`, PK `account_id`)
con `account[all_catalogs.write,inventory.write,orders.write]`, vía
`hubrise-oauth-start?account_id=<Folvy Interno>&scope=writer_orders` (parámetro `scope` con lista
blanca cerrada, añadido a `hubrise-oauth-start` solo para este test — retirado tras escribir esto).
**Verificado**: la fila de Folvy Interno cambió `hubrise_account_id=zy9j2`, `updated_at` 07:26→12:42;
la fila de Foodint (`hubrise_account_id=1b6p8`) siguió con `updated_at` del 06/08 — **intacta**, tal
como exige la Trampa 1 (PK sobre `account_id`, no hay forma de que se crucen).

**Con el token nuevo, los 3 pasos del test:**

1. `POST /v1/locations/zy9j2-1/orders` (cuerpo mínimo `{"status":"new"}`) → **200**. Pedido real creado:
   `id="m6pbvnq"`, `location_id="zy9j2-1"`, `created_by="Folvy Escritor"`.
2. `PATCH` (vía `X-HTTP-Method-Override`, pg_net no tiene verbo PATCH nativo) sobre ESE pedido real →
   **200**, `status` pasó a `"accepted"` de verdad. (El 404 de un id inventado en el intento anterior
   NO contaba como señal — aquí sí, es un resultado válido.)
3. `POST /v1/callback` en la conexión de cuenta, apuntando a un receptor de prueba propio
   (`hubrise-callback-test-receiver`, temporal) con eventos `order.create`+`order.update` → **200**,
   registrado. La conexión `Folvy Test` (`zy9j2-0`, ya apuntaba a `hubrise-webhook` de producción) **no
   se tocó**.

**La medición del 15/08 — pedido nuevo en `zy9j2-1` y otro en `zy9j2-0`, tras el callback ya activo:**

- `zy9j2-1` (pedido `6bgypv4`, creado y sin más actividad): **0 eventos** en el receptor de prueba,
  ni siquiera esperando 30+ segundos.
- `zy9j2-0` (pedido `vxy89p8`): **2 eventos** `order.update` sí llegaron — no son de la creación del
  pedido: son las transiciones `new→received→accepted` que generó **el propio `hubrise-webhook` de
  producción** al procesar el pedido por la vía YA existente de `Folvy Test` (auto-ack +
  auto-aceptación, `maybeAckReceived`/`maybeAutoAccept`).

> ⚠️ **CORREGIDO 15/08: conclusión retirada.** El párrafo original decía aquí "RESULTADO: llega solo
> uno → es POR LOCATION" y daba F0.2 por cerrada. **Era un test mal diseñado, no un resultado.** La
> doc de HubRise (`/developers/api/callbacks`) es explícita:
>
> > "A client does not receive notifications for the events it generated. If you are testing
> > callbacks, you need to use a separate client to trigger events."
>
> Ambos pedidos de prueba los creó **la misma conexión** que tenía el callback registrado (la de
> cuenta). HubRise nunca iba a notificarle sus propios eventos, en NINGUNA location. El silencio de
> `zy9j2-1` no medía "por location" — medía "no había un segundo cliente ahí". Y la observación de
> `zy9j2-0` apunta al REVÉS de lo que se concluyó: esos 2 eventos los generó `Folvy Test` (un cliente
> distinto), y el callback de la conexión de CUENTA sí los recibió — es evidencia POSITIVA de que un
> callback de cuenta puede recibir eventos de una location ajena a quien los originó.
>
> | Observación | Lectura errónea (retirada) | Lectura correcta (regla del auto-evento) |
> |---|---|---|
> | `zy9j2-1`: 0 eventos | "el callback de cuenta no cubre esa location" | el único actor en `zy9j2-1` era la propia conexión de cuenta → autoevento, silencio esperado, no dice nada de cobertura |
> | `zy9j2-0`: 2 eventos (`update`) | "casualidad, por el auto-accept" | `Folvy Test` es un cliente DISTINTO de la conexión de cuenta → sí hay notificación → primera evidencia (parcial, un solo caso) de que el callback de cuenta SÍ ve eventos ajenos en una location |
>
> **F0.2 sigue abierta.** Re-test en curso con un segundo cliente real (OrderLine) en `zy9j2-1` — ver
> más abajo. El método (pg_net, HTTP 200/403/422 de arriba, la reautorización con scope de pedidos)
> sigue siendo válido y se reutiliza; solo se retira la conclusión de "por location".

**Trampa añadida al encargo (15/08)**: un callback nunca recibe los eventos que genera su propia
conexión. Cualquier prueba de callbacks necesita un segundo cliente distinto — si no, mide silencio
y lo confunde con ausencia.

**Efecto colateral (ya limpiado)**: el pedido de prueba `vxy89p8` (zy9j2-0) entró en producción real
por la vía de `Folvy Test` → `hubrise-webhook` (`order_status='accepted'`, `brand_id=null`, `total=0`,
`external_webhook_log.note='frontera-order-create'`, `processed=true`). La fila de `sale`
(`c0c6848a-d69b-4262-9dc7-9d146ba11b64`) se BORRÓ el 15/08 tras verificar 0 dependientes en
`sale_line`/`kds_ticket_station_state`/`channel_settlement_order`/`print_job`/`coupon_redemption`/
`delivery_assignment`/`delivery_quote`/`customer_notification`.

## HubRise — F0.2 RESUELTA: el callback de CUENTA cubre todas las locations (15/08/2026)

**Por qué OrderLine esta vez SÍ sirve**: no genera pedidos (sigue siendo cierto), pero SÍ cambia el
estado de un pedido ya existente — y ese cambio de estado, hecho por una app externa distinta de
nuestra conexión de cuenta, es exactamente el "segundo cliente" que exige la doc de callbacks.

**Por qué NO se reautoriza `hubrise-oauth-start` para esto**: el token de cuenta ya conserva el scope
`orders.write` de la reautorización anterior (solo se retiró la CLAVE `writer_orders` de la lista
blanca del parámetro, no el permiso ya concedido). Autorizar una conexión de LOCATION por esa misma
vía sobrescribiría la fila de `hubrise_writer_connection` de Folvy Interno (PK `account_id`) con un
token de alcance de location y dejaría el laboratorio sin capacidad de catálogo — por eso el segundo
cliente es OrderLine (ajeno a nuestra infraestructura), no una segunda conexión nuestra.

**Secuencia**: 1) receptor de prueba + tabla montados de nuevo (mismo disparador de borrado: se
retiran en cuanto este resultado quede escrito). 2) Callback re-registrado en la conexión de cuenta.
3) Julio conecta OrderLine a `Lab 2 (zy9j2-1)` desde la consola de HubRise. 4) Con el token de cuenta,
se crea un pedido en `zy9j2-1` — se espera 0 eventos (autoevento, ahora es predicción, no hallazgo).
5) Julio cambia el estado de ese pedido desde OrderLine. 6) La medición real: ¿llega ese
`order.update` (generado por OrderLine, un cliente ajeno) al callback de la conexión de cuenta?
  - Sí → el callback de cuenta cubre todas las locations; combinado con `zy9j2-0`, F0.2 cierra a favor
    de la capa de cuenta; 2.1/2.2 siguen como estaban.
  - No → es por location; parar y decidir el cambio de modelo de datos.
  - Nada → verificar el receptor con una llamada directa antes de concluir; silencio no es resultado.

**Resultado — los dos experimentos, con OrderLine ya conectado a `Lab 2 (zy9j2-1)`:**

1. **Segundo cliente (la medición real)**: Julio aceptó el pedido `6bgypv4` desde OrderLine —
   `order.update`, cliente ajeno a nuestra conexión de cuenta. **Llegó al receptor**: `event_type=update`,
   `order_id=6bgypv4`, `location_id=zy9j2-1`, `status=accepted`. Un solo evento, sin duplicados ni ruido.
2. **Auto-evento (verificación de la predicción, no asumida)**: con el token de cuenta se creó un
   pedido nuevo (`5gy7v6d`) en `zy9j2-1`. Esperados 12+ segundos: **0 eventos**. El receptor ya estaba
   verificado como funcional por el punto 1 (recibió un evento real minutos antes con la misma
   infraestructura), así que este silencio SÍ es resultado — no hace falta una llamada directa aparte
   para descartar que el receptor esté roto.

**F0.2 CERRADA: el callback registrado en la conexión de CUENTA recibe eventos de locations ajenas a
quien los origina, incluida una location (`zy9j2-1`) donde la propia conexión de cuenta NUNCA tuvo
actividad previa.** Combinado con `zy9j2-0` (donde también llegaron eventos de un cliente distinto,
`Folvy Test`): **dos locations de dos, dos clientes distintos de dos — el callback de cuenta cubre
todas las locations de la cuenta**, no hace falta una conexión por local para recibir notificaciones.

**Consecuencia para la arquitectura**: la capa escritora de cuenta (`hubrise_writer_connection`) SÍ
basta para pedidos y callbacks, además de catálogo+inventario — con el scope ampliado
(`account[all_catalogs.write,inventory.write,orders.write]`). ~~2.1/2.2 siguen como estaban~~
**⚠️ ACTUALIZADO 15/08: superado por decisión explícita de Julio.** Pese a que técnicamente
una sola conexión de cuenta cubriría todo, Julio decidió MANTENER la arquitectura por-location para
2.1/2.2 (razones: aislamiento de fallos por local, revocación granular, y que el scope
`location[orders.write]` no necesita ampliar el grant de escritor de cuenta). 2.1/2.2 SÍ bifurcan
`hubrise-oauth-start`/`-callback` por `kind` (`writer` vs `location`), con `external_integration` como
destino de la rama `location` — ver más abajo, sección "HubRise — 2.1/2.2: conexión por location
(implementación)". Lo que sí falta, cuando se retomen, es decidir si el scope de producción
(`Foodint`/`1b6p8`) se amplía también a `orders.write` o si el patrón `external_integration` por-local
(bridges) se mantiene para pedidos reales mientras la cuenta solo gobierna catálogo — eso es decisión
de Julio, no una consecuencia automática de este test.

**Limpieza tras escribir esto**: `hubrise_callback_test_log` (tabla) y `hubrise-callback-test-receiver`
(Edge Function) se borran — eran solo para este test. El callback de la conexión de cuenta también se
desregistra (apuntaba SOLO al receptor de prueba; dejarlo registrado tras borrar la función lo deja
roto, apuntando a un endpoint muerto — no es "conservar el hallazgo", es dejar basura). La llamada
exacta para volver a registrarlo (con el endpoint real que decida 2.1/2.2) queda documentada arriba en
este mismo apartado.

## HubRise — 3.ter: mojibake en las páginas HTML de OAuth (causa raíz, 15/08/2026)

**Síntoma**: `hubrise-oauth-start`/`-callback` sirven HTML con `Content-Type: text/html; charset=utf-8`
explícito en el código, pero el navegador las pintaba como texto plano con tildes/eñes/emoji rotos
(mojibake).

**Causa raíz verificada (no asumida)**: el GATEWAY de Supabase Edge Functions reescribe el
`Content-Type` de la respuesta a `text/plain` + añade `X-Content-Type-Options: nosniff`, **sin importar
lo que devuelva el código de la función**. Probado con una función de control aislada que SOLO hacía
`return new Response(html, {headers:{"Content-Type":"text/html"}})` — llegó igual como `text/plain`.
**No hay arreglo de código posible**: no es un bug de charset ni de escritura, es el gateway.

**Interino de coste real cero (aplicado 15/08, `hubrise-oauth-callback` v6)**: las tres páginas
(`ok()`, `fail()`, `inspect()`) se reescribieron en ASCII puro — sin tildes, eñes, emoji ni comillas
tipográficas — legibles aunque se sirvan como texto plano. Verificado en vivo: `curl` a la función sin
`code`/`state` devuelve `Content-Type: text/plain` (confirma que el gateway sigue reescribiendo) con
cuerpo 100% ASCII, sin mojibake.

**Arreglo real, NO hecho todavía**: redirigir desde el Edge a una página real del frontend (servida por
Vercel, no por el gateway de Edge Functions) en vez de devolver HTML desde `hubrise-oauth-callback`
directamente. Queda para cuando se retome ese frente — no bloquea 2.1/2.2.

## HubRise — 2.5: desconectar, revoke_pending y la trampa del token huérfano (15/08/2026)

**Orden obligatorio (Julio)**: 1) `DELETE /v1/callback` con el token TODAVÍA vivo (verificado en vivo:
recurso singleton, sin id, `X-Access-Token`, sin cuerpo → 200, GET posterior confirma
`{url:null,events:{}}`) — un token ya revocado no puede borrar su propio callback; 2)
`POST manager.hubrise.com/oauth2/v1/revoke` (Basic client_id:client_secret, token en el cuerpo); 3)
apagar flags LOCALES (`is_active`/`push_status_enabled`=false, `access_token`=NULL,
`token_status`='invalid' en `external_integration`; `is_active`=false en `external_location_map` —
**nunca borrar**, el trigger de `location_id` necesita la fila para resolver al reconectar).
`brand_hubrise_catalog` no se toca nunca — sobrevive intacto para que reconectar no reconfigure catálogos.

**Trampa 13 (Julio, encontrada en su propia especificación de `revoke_pending`)**: si la revocación
falla, el token se conserva "para poder reintentar" — pero **un token conservado es un token que
alguien va a sobrescribir** al reconectar. Sin más, la reconexión pisaría `access_token` con el
nuevo valor y el token viejo sin revocar quedaría huérfano (válido en HubRise) y sin forma de volver a
intentarlo. Neutralizada: `hubrise-oauth-callback`, al reconectar una fila con `revoke_pending=true`,
intenta revocar el token viejo (best-effort, no bloquea) antes de sobrescribirlo, y resetea
`revoke_pending=false` en cualquier reconexión con éxito.

**Verificado en vivo contra el laboratorio (Carabanchel-lab, `zy9j2-1` — nunca `zy9j2-0`, cableada a
producción)**, con una función de prueba temporal (secretos reales, sin JWT de usuario, borrada/neutralizada
tras usarla) que reprodujo el mecanismo exacto:
1. `GET /v1/location` con el token → 200 (confirma que el token vivía ANTES de tocar nada — sin esto,
   el silencio posterior no demuestra nada, misma lección que el receptor de callbacks de F0.2).
2. `DELETE /v1/callback` → 200, `{url:null,events:{}}`.
3. `POST oauth2/v1/revoke` → 200, cuerpo vacío.
4. `GET /v1/location` inmediatamente después → **401**. Propagación **instantánea** (72 ms después del
   revoke, sin ventana de "sigue conectado" — no hizo falta el reintento a los 4s previsto para medir
   propagación asíncrona).
5. Estado local aplicado (idéntico al que aplicaría la función real) → aceptado por el CHECK relajado
   sin problema. Verificado en BBDD de forma independiente: `is_active=false`,
   `push_status_enabled=false`, `token_status=invalid`, `revoke_pending=false`, `access_token` NULL;
   mapa `is_active=false`.

**Lo que esto NO prueba** (Julio pidió precisión aquí): el mecanismo y las transiciones de estado, sí.
El camino de autorización (JWT + `current_user_is_admin_of`) y la orquestación de
`hubrise-location-disconnect` tal como está escrita, NO — la prueba reprodujo la misma lógica en un
script aparte, no invocó la función real (no hay forma de conseguir un JWT de usuario sin navegador).
Tampoco se probó el camino de fallo (revoke_pending=true, token conservado, alarma por system-alert):
en esta ejecución el revoke tuvo éxito a la primera. Eso queda para 4.1 con la UI real.

## HubRise — 2.6/2.7: CERRADAS (15/08/2026)

El detalle completo del hallazgo — las tres apps OAuth de Folvy en HubRise ("Folvy"=pedidos,
"Folvy Escritor"=catálogo, "Folvy Injector"=muerta), el HMAC que lo demostró, por qué
`HUBRISE_WEBHOOK_SECRET` sirve para dos cosas a la vez (rotarlo rompe las dos), y por qué la
certificación con Antoine va sobre "Folvy" y no sobre "Folvy Escritor" — vive en
**`folvy_hubrise_tres_apps_oauth.md`** (documento propio de Julio, no duplicar aquí).

**Código desplegado (15/08)** — `hubrise-oauth-start` v11, `hubrise-oauth-callback` v12,
`hubrise-location-disconnect` v3 (verificados byte a byte contra `list_edge_functions` tras cada
deploy; `hubrise-webhook` NO se tocó, sigue v49 sin cambios). `writer` byte a byte idéntico
(mismo `HUBRISE_OAUTH_CLIENT_ID`/`SECRET`, mismo código, solo se movió el orden de comprobación de
Secrets a después de leer el nonce). `location` usa `HUBRISE_OAUTH_LOCATION_CLIENT_ID` +
`HUBRISE_WEBHOOK_SECRET` (client_secret de "Folvy", no duplicado en una Secret nueva).
**Hallazgo propio, no pedido explícitamente, incluido en el mismo commit**: `hubrise-location-disconnect`
revocaba con las credenciales de "Folvy Escritor" para tokens que, tras este cambio, emite "Folvy"
— HubRise rechaza un revoke firmado por una app distinta de la que emitió el token. Corregido para
usar siempre las credenciales de "Folvy" (esta función solo maneja conexiones location).

**Prueba de aceptación real — PASADA (15/08, verificado por Julio en BBDD)**: reconectado
Carabanchel-lab (Folvy Interno) por el flujo real. Sin error de redirect_uri (HubRise no lo
pre-registra, confirmado). `ensureHubriseCallback` (2.6) devolvió el callback de `zy9j2-1` a
`hubrise-webhook` solo, dentro del propio flujo de reconexión, sin paso manual. Cambio de estado
desde OrderLine → `external_webhook_log` 19:38:58, `frontera-order-update`, `processed=true`,
cuenta `zy9j2`/location `zy9j2-1`, pedido `6bgypv4` → `sale` creada y cerrada (`close_sale`).
Camino completo, extremo a extremo. Alcalá siguió recibiendo pedidos reales en la misma ventana
(`j4xvvyp` 19:22, `yn633nk` 19:20) — producción intacta.

**Limpieza del andamiaje de diagnóstico (15/08, disparador cumplido)**: `hubrise-callback-diag-receiver`
(Edge) y `_tmp_hubrise_callback_diag` (tabla) borrados; venta de prueba `6bgypv4` de Folvy Interno
borrada (0 dependientes en las 8 tablas con FK a `sale`, incluida `sale_line` — el pedido de prueba
no generó líneas ni consumo de stock); `hubrise-lab-disconnect-test` ya no existía (se había
borrado antes, en la limpieza de 2.5 — la CLI lo confirmó con "does not exist").

**Backend del módulo HubRise (F1+F2), TERMINADO.** Sigue Fase 3 (UI: A.1 tablero de vigilancia,
A.2 asistente interno, A.2-bis escritor de `external_brand_map`, A.3 desconectar, B.1 pantalla de
cliente, B.2 selector de local en `EditPricesModal`, B.3/3.ter página de éxito del OAuth) — diseño
cerrado por Julio en `folvy_hubrise_fase3_diseno.md` (v2), rama `feat/hubrise-fase3-ui`.

**A.1 (tablero de vigilancia superadmin) CERTIFICADO por Julio con captura (15/08)**, tras una
corrección real encontrada en la propia certificación: `hubrise_ops_dashboard()` filtraba
`connection_name='Folvy'` y escondía cualquier OTRA conexión hubrise activa de la location (ej.
"Folvy Test" en `zy9j2-0`, token vivo, callback apuntando a producción — invisible en el tablero
hasta la corrección). Ese filtro es correcto en `hubrise_location_status` (pantalla del cliente,
solo le interesa SU conexión estándar) pero era lo contrario del propósito del tablero de
vigilancia. Corregido: ahora muestra la conexión estándar "Folvy" (incluida inactiva, para
`revoke_pending`) MÁS cualquier otra conexión que esté activa ahora mismo, etiquetada "conexión no
estándar: <nombre>". Verificado en vivo por impersonación tras el fix: "Folvy Test" aparece
correctamente, las dos filas reales no cambiaron. `/_admin/hubrise`, `tsc -b`/`vite build` limpios.

**B.2 backend de lectura (15/08, no es HubRise pero mismo encargo Fase 3)**: `menu_item_channel_economics`
gana `p_location_id uuid DEFAULT NULL`, aditivo, reutilizando `effective_price()` para el número
(una cascada, una implementación) — solo añade un `EXISTS` para etiquetar `price_source`/
`is_location_override`, no recalcula el precio dos veces. Trampa de sobrecarga de
`CREATE OR REPLACE FUNCTION` (ver `feedback_create_or_replace_function_overload`) apareció otra
vez y se corrigió con `DROP FUNCTION` explícito de la firma vieja antes de crear la nueva —
verificado conteo=1. Regresión probada con datos reales: instantánea de 7 `menu_item` con
overrides ANTES del cambio, diff byte a byte DESPUÉS con `p_location_id` omitido → las 7
idénticas. Cascada nueva probada con una fila de override real creada y borrada de inmediato
(price/price_source/is_location_override correctos). Hallazgo no mío: `channel_rate` tiene 3 filas
activas duplicadas para al menos un canal — preexistente, no introducido por este cambio, no
tocado (fuera de alcance). `listMenuItemOverrides` gana `locationId` opcional (sin llamadores hoy,
cero riesgo). Selector en el modal (B.2 paso 4) sigue sin empezar.

**⚠️ Incidente cerrado (15/08): la primera URL de prueba entregada a Julio apuntaba a PRODUCCIÓN,
no al laboratorio.** Ver Trampa 14 más abajo. Julio NO pulsó la URL incorrecta.

### Trampa 15: NINGÚN cron sondea GET /callback — es condición del pre-audit de Antoine

**El vigía de salud de token (`hubrise-connection-health`, F1.3) violó esto desde su propia
creación, sin que nadie lo notara hasta el diseño de A.1 (15/08/2026).** Pingueaba `GET /callback`
cada 30 min por conexión — distinta cadencia que el polling original (cada 5 min, cron 21,
`cron.unschedule` el 29/07), pero el MISMO endpoint sondeado en bucle, la misma objeción que
Antoine puso como punto 2 del pre-audit. Julio lo aprobó sin verlo (al aprobar 2.6, que sí respeta
la regla) y yo lo escribí sin comprobarlo contra el propio F1.3 — se coló a los dos.

**Corregido**: la salud del token se comprueba con endpoints "quien soy" escalados por el propio
token — `GET /v1/location` (conexiones de location) y `GET /v1/account` (escritora) — verificados
en vivo el 15/08/2026 (200 con token vivo, 401 con token muerto, misma señal que `/callback` sin
ser ese endpoint). El estado del callback se vigila por EVENTOS, nunca por cron: al conectar/
reconectar (`hubrise-oauth-callback`, 2.6), al desconectar (`hubrise-location-disconnect`, siempre
`missing`), cuando un token pasa de `invalid` a `ok` (`hubrise-connection-health`, transición real,
no bucle), y bajo demanda desde el botón "Verificar callback ahora" del tablero (A.1) —
`hubrise-callback-ensure` acepta `{integration_id}` para acotar a una sola conexión. Su comentario
original decía *"Este cron..."* pero NUNCA se programó (confirmado en 2.6 contra los 48 `cron.job`)
— corregido para que no quede como una invitación a programarlo.

**Regla permanente — no re-litigar**: **ningún cron sondea `GET /callback`.** Es la condición del
pre-audit de Antoine (punto 2, 29/07). Los callbacks no se borran solos: se verifican al conectar,
al desconectar y bajo demanda. Cualquier diseño futuro que quiera "vigilar callbacks en bucle" está
repitiendo el cron 21.

### Trampa 14 (misma familia que 1b6p8-1 vs 1b6p8-2): Folvy Interno replica los NOMBRES de los locales de Foodint

Folvy Interno (cuenta de laboratorio) es un espejo de Foodint (cuenta de producción): sus locales
llevan los MISMOS NOMBRES visibles ("Foodint Carabanchel" existe en las dos cuentas, con
`account_id`/`location_id` completamente distintos). El 15/08 esta sesión le entregó a Julio una
URL de prueba de aceptación llamándola "Carabanchel-lab" pero usando en realidad
`account_id=51ad1792-6629-4ef7-833a-b57b09a86710` (Foodint, producción) +
`location_id=92d7656e-082e-452a-8ebc-236b2d6ebf5f` (Foodint Carabanchel, producción) — los
identificadores REALES de producción, recordados de memoria por asociación con el nombre del sitio,
sin verificar contra `locations` antes de dárselos a Julio. Julio lo detectó él mismo antes de
pulsar el enlace.

**Regla**: un `location_id` NUNCA se identifica por el nombre del local — se identifica por su
`account_id`. Cualquier URL, script o instrucción que mencione un local por su nombre debe llevar
la cuenta al lado explícitamente, y verificarse contra `locations` (`select id, account_id, name
from locations where id = '<location_id>'`) antes de dársela a un humano para actuar — sobre todo
si esa acción abre un flujo de autorización real contra un sistema externo.

## Cuenta HubRise 1b6p8 — inventario del panel (24/07/2026)

- **`Foodint 1b6p8` (EUR)**. Client ID `598759333895.clients.hubrise.com`. Integración = POS.
- **3 locations**: **Alcalá `1b6p8-0`** (`38158159-cd71-4056-950b-53425afac1ce`) · **Carabanchel `1b6p8-2`** (`92d7656e-…`) · **Plaza Castilla `1b6p8-1`** (`629f9154-…`). **Solo Alcalá tiene conexiones** (los otros dos degradan en la UI de cerrar local).
- ⚠️ **Plan/pago NO activado**: tramo gratuito **máx. 5 pedidos**. Setup 300€ pagados.
- ⚠️ **Tope de Antoine: máx. 5 live locations con el cliente "Folvy" (598759333895)** — condición
  escrita del pre-audit cerrado el 05/08/2026 (ver más abajo). Contador actual: **3**
  (`1b6p8-0` Alcalá producción, `zy9j2-0` Folvy Test lab, `zy9j2-1` lab). "Live" no está definido
  por Antoine (¿cuenta el lab, que no factura?) — no asumir margen exacto. Revisar este contador
  cada vez que se conecte una location nueva.
- Técnico: **Antoine Monnier** (`amonnier@hubrise.com`). Hilo en **`partners@folvy.app`**. Glovo: **Linda Liang** (`linda.liang@glovoapp.com`), Janaina contacta.

### Pre-audit CERRADO por Antoine (05/08/2026) — no se le debe respuesta

Última respuesta de Antoine (05/08/2026 16:09, `partners@folvy.app`, recuperada por Julio el
15/08), cita literal: **"Pre-audit is complete. You can connect the approved
598759333895.clients.hubrise.com / Folvy API client with up to 5 live locations. A more
comprehensive audit will be required when you need to connect more locations."**

Esto CORRIGE cualquier mención anterior en este documento o en memoria de "pendiente responder a
Antoine" o "punto 4 del pre-audit abierto" — ambas quedaron superadas ese día, antes de que esta
sesión (15/08) las diera por vigentes. La app **"Folvy" (598759333895) como cliente de pedidos ya
no es una inferencia de 2.7/Trampa 15 — es la condición ESCRITA de Antoine.** Carabanchel está
autorizado desde el 05/08 sin pedir permiso adicional (dentro del tope de 5). El disparador del
"comprehensive audit" es el cliente 2 (o cualquier expansión >5 locations) — **la Fase 3 (UI) se
construye para aprobar ESE audit futuro, no para cerrar el pre-audit, que ya está cerrado.**
Próximo contacto con Antoine, con causa: antes de necesitar la location nº 6.

## Identidades clave (Foodint / Llorente29)

- **Cuenta interna Foodint** `51ad1792-6629-4ef7-833a-b57b09a86710` (slug `foodint`). ~4.923 ventas, **4.901 lastapp con `raw_products`**, ~14.049 `sale_line`. **`menu_item`: 493 filas `lastapp` (external_id compartidos entre marcas/cuentas) + 27 `folvy` (Bendito Burrito, únicos).**
- ⚠️ **Locales DUPLICADOS por nombre** (sandbox `00000000-…-0001` vs prod `51ad1792…`, ids distintos). Filtrar por `account_id`.
- ⚠️ **"Milanesa House" y "Milanesa Haus" son DOS marcas reales distintas.**
- **9 marcas folvy publicables en Alcalá** (`catalog_source='folvy'`): Bendito Burrito `95635ce3-…` · Dirty Burger `ca05894b-…` · Lovers Burgers `99dff23e-…` · Meraki Pita `cc89c6eb-…` · Mila's Sandwiches `0229a52b-…` · Milanesa House `501ffd59-…` · Scandal Burgers `2b160122-…` · Smash Brothers `43d305cd-…` · The Urban Kebab `5a230c99-…`

## Señales para INCENTIVOS — qué está vivo (25/07/2026)

| Señal | Estado |
|---|---|
| Tiempos de cocina | ✅ vivo (`sale.accepted_at`/`ready_at`) |
| Quién estaba en cocina | ✅ cruzable (`clock_entries` × ventana, **filtrar por local**) |
| Nº pedidos / facturación · Fichajes | ✅ |
| Puntualidad | ❌ no medible (`scheduled` NULL) |
| Valoraciones / incidencias | ❌ sin feed (enero 2026) |
| Motor de incentivos | ⚠️ construido, 0 filas |
| Salida a nómina | ✅ existe |

**Enganche de reseñas probado:** `channel_review.order_code` = mismo formato 5-hex que Uber. Densidad ~18/local/mes → solo mensual y por local.

## Motor de ofertas de plataforma (24/07)
- **Las ofertas NO van por HubRise.** Uber: API oficial (`uber-promo-push`, sin token activo). **Glovo: SIN API pública** → robot de navegador.

## ÁREAS HUÉRFANAS — RECON (07/08/2026)

> Cierra el hueco: hasta hoy el mapa no cubría Team, app del trabajador, notificaciones, autoinventario,
> APPCC ni recepciones. Conteos con `count(*)` real y `max(fecha)`.

## Ancla de tenencia (leer antes de las 6 áreas)

- **La cuenta se ancla en `locations.account_id`** (verificado). Las tablas de empleado sin
  `account_id` alcanzan la cuenta por saltos: **`clock_entries` → `employees.location_id` →
  `locations.account_id`** (3 saltos). Las de empleado directas, 2 saltos.
- **⚠️ `employees.location_id` es UN local** (existiendo `assigned_locations` array). La tenencia
  hoy usa el escalar, no el array.
- **Núcleo de Team SIN `account_id`** (tenencia por saltos, bloquea RLS limpia para cliente 2):
  `clock_entries`, `employees`, `schedules`, `shift_templates`, `open_shifts`,
  `open_shift_requests`, `shift_swap_requests`, `vacations`, `monthly_balance_closures`,
  `manager_permissions`, `employee_availability`, `employee_formations`,
  `employee_notifications`, `course_attempt`, `training_path_progress`.
  - `shift_swap_requests` no tiene ni account ni location: cuelga de `requester_id`/`target_id`
    (empleado) + `requester_schedule_id`/`template_id`.
  - `manager_permissions` cuelga de `user_profile_id` (por usuario, no por local); 32 flags.
- **Team CON `account_id`** (ya bien): `course`, `course_assignment`, `training_path`,
  `training_notice`, `staff_role`, `vacation_settings`, `account_gestoria_config`,
  `payroll_cost`, `payroll_inbox`, `clock_correction_request`, `clock_entry_audit`,
  `clockout_reminder_log`.

---

## 1. TEAM (fichaje · cuadrante · nóminas · vacaciones · formación · bolsa de horas)

| Tabla | Filas | Último dato | Notas |
|---|---|---|---|
| `employees` | 11 | — | ⚠️ 3 duplicados activos (0 fichajes, 40h) → saldrían a −177 h |
| `clock_entries` | 582 | 06/08 | `datetime` (redondeado, hoy es el de cómputo) **y** `real_datetime` (verdad legal). Invertir. Cruces: filtrar por `location_id_at_clock` |
| `schedules` | 33 (9 publ.) | — | turnos en `cells` jsonb (ver estructura abajo) |
| `shift_templates` | 22 | — | plantillas ambiguas/duplicadas en Alcalá = intento de granularidad horaria (Opción 2), NO borrar |
| `vacations` | 10 aprob. | 03/08 | 7 tipos válidos |
| `payroll_cost` / `payroll_inbox` | 13 / 13 | 04/08 | extractor IA por DNI, ingesta Gmail→Resend |
| `monthly_balance_closures` | 3 | — | estructura OK, **cálculo a cero** (deuda) |
| `course` / `course_assignment` / `training_path_progress` | 40 / 30 / 81 | 04/08 | formación viva |

- **`schedules.cells` = `{ shift_template_id: { dia: [employee_id, …] } }`, índice de día 0–6, 0=lunes
  (`shift_date = week_start + dia`).** CORRECCIÓN 07/08 noche: una entrada anterior de esta sesión decía
  "1=lunes, con celda '0' anómala = domingo anterior, `shift_date = week_start + (dia-1)`" — **era un
  error de lectura de los datos, no una convención real.** Verificado dos veces:
  (a) `SELECT DISTINCT day_key FROM schedules, jsonb_each(cells)...` sobre TODA la tabla en vivo →
  únicamente aparecen las claves `'0'`..`'6'`, **nunca `'7'`** (si fuera 1–7 con un "0" colado, existiría
  la clave "7"; no existe). La clave "0" es simplemente la menos frecuente (20 filas vs 68-81 del resto)
  porque Carabanchel cierra los lunes — no porque sea un índice distinto.
  (b) Los TRES sitios que escriben/leen `cells` en el cliente (`scheduleGenerator.ts:isoForDay`,
  `CalendarioPage.tsx`, `MiHorario.tsx`) usan `week_start + día` sin desfase, y `DayOfWeek` está
  tipado `0|1|...|6 // 0=lun`. El trigger `trg_schedule_no_vacation_conflict` (F7.1) SÍ se aplicó
  primero con la fórmula `-1` (bug real, no invención) y se demostró en vivo con rollback que NO
  detectaba el conflicto real de Marlón (lunes 21/09, vacación 21-27/09); con `week_start + día` sí lo
  detecta. Migración de fix: `20260807T2200_f7_1_fix_vacation_trigger_offbyone.sql`.
  **Usar `week_start + día` (sin `-1`) en cualquier cruce por fecha futuro (F4-F11).**
- **El guardado MANUAL del cuadrante ya valida vacaciones (F7.1, cerrado 07/08 noche)**: backstop en BBDD
  (trigger, corregido arriba) + aviso pre-guardado en `CalendarioPage.tsx` (`findVacationConflicts` en
  `scheduleGenerator.ts`, misma fuente que el generador) + mensaje legible si el trigger rechaza algo.
  Caso Marlón corregido a mano (07/08). Cierre también aplicado a aprobar cambios de turno
  (`shiftSwapService.ts`), que escribe en `cells` por la misma vía.

## 2. APP DEL TRABAJADOR (PWA)

- **No tiene tablas propias: es la superficie ÚNICA y transversal del trabajador para TODO Folvy**
  — fichaje, horario, nóminas, formación, y además APPCC, recepciones y autoinventario.
  Se apoya en las tablas de las otras 5 áreas.
- Argumento comercial: Sesame/Bizneo no lo tienen ni lo pueden tener (no están en la cocina).
- ⚠️ "Mi horario" y "Mis fichajes" no se cruzan; "Total horas semana" muestra lo *previsto*, no lo
  trabajado; menú con "Turnos abiertos"/"Cambios de turno" apunta a tablas casi vacías.

## 3. NOTIFICACIONES (4 canales sin gobierno)

| Canal | Tabla | Filas | Último | Tenencia |
|---|---|---|---|---|
| In-app empleado | `employee_notifications` | 52 | 05/08 | `employee_id` (sin account_id) |
| WhatsApp formación | `training_notice` | 14 | — | account_id + employee_id |
| WhatsApp olvido de salida | `clockout_reminder_log` | 9 | — | account_id + employee_id |
| APPCC | `appcc_notifications` | **0** | — | **MUERTO** (49 schedules activas, nadie recibe aviso) |

- **4 canales, un solo interruptor** (Mis ajustes) = sin gobierno. `employee_notifications`:
  36 `schedule_published` (22 leídos → 39% no se entera), 10 `shift_swap_request`, 3 `period_closed`.
- **Lado cliente (NO empleado, no confundir):** `customer_notification` 190, `ctb_notification_queue` 38.

## 4. AUTOINVENTARIO / STOCK

| Tabla | Filas | Último | Tenencia |
|---|---|---|---|
| `inventory_count` | 135 | 05/08 | account_id + location_id |
| `inventory_count_line` | 3.868 | 05/08 | account_id |
| `stock_movement` (libro mayor) | 23.671 | 06/08 | account_id + location_id |
| `stock_level` / `stock_adjustment` / `stock_group` | 36 / 38 / 19 | — | account_id (+ location en level/adj) |
| `stock_transfer` | **0** | — | sin combustible (traspaso entre locales, existe, sin uso) |
| `stock_waste` | **0** | — | sin combustible (merma, existe, sin uso) |

- Estados de conteo: `contando` / `en_revision` / `aprobado` / `anulado`. Diseño AvT y motor:
  `folvy_avt_diseno.md`. Autoinventario IA (score valor+rotación+riesgo) ya en producción.

## 5. APPCC

- **⚠️ Corrige el framing viejo "APPCC muerto": el NÚCLEO está VIVO.** Lo muerto son avisos,
  responsables y el submódulo de auditoría.

| Tabla | Filas | Último | Estado |
|---|---|---|---|
| `appcc_executions` | 381 | 03/08 | ✅ vivo · account_id + location_id |
| `appcc_execution_responses` | 1.100 | — | ✅ (cuelga de execution) |
| `appcc_signatures` | 214 | 27/07 | ✅ firma con documento |
| `appcc_schedules` | 49 activas | — | ✅ account_id + location_id |
| `appcc_templates` / `_template_items` / `appcc_plans` | 52 / 286 / 7 | — | ✅ sembrado |
| `appcc_incidents` / `_incident_events` | 4 / 15 | 27/07 | ✅ vivo, poco volumen |
| `appcc_notifications` | **0** | — | 💀 nadie recibe aviso de 49 controles activos |
| `appcc_schedule_responsibles` | **0** | — | 💀 ningún control tiene dueño |
| `appcc_audits` / `_audit_schedules` / `_audit_responses` / `_audit_log` | **0 / 0 / 0 / 0** | — | 💀 submódulo AUDITORÍA sin estrenar… |
| `appcc_audit_templates` / `_audit_sections` / `_audit_items` | 26 / 156 / 962 | — | …aunque sus PLANTILLAS sí están sembradas |

## 6. RECEPCIONES

| Tabla | Filas | Último | Tenencia |
|---|---|---|---|
| `goods_receipt` | 112 | 06/08 | account_id + location_id |
| `goods_receipt_line` | 699 | 06/08 | account_id |
| `goods_receipt_ai_session` | 158 | 06/08 | account_id (OCR/IA de albarán) |
| `supplier_invoice_receipt` | **0** | — | sin combustible (factura / three-way, no alimentado) |

- Deuda conocida (resuelta pero vigilar): `confirm_goods_receipt` podía cerrar **sin meter el
  género al stock en silencio**; mitigado con `post_pending_receipt` + modal "Meter al stock".
  Frente de raíz pendiente: estado "confirmada con pendientes" como ciudadano de primera.

---

## Resumen de "estructuras sin combustible" nuevas (07/08) — 0 filas confirmado
`appcc_notifications`, `appcc_schedule_responsibles`, `appcc_audits`, `appcc_audit_schedules`,
`employee_availability`, `employee_formations`, `open_shifts`, `stock_transfer`, `stock_waste`,
`supplier_invoice_receipt`.

## 🔒 SEGURIDAD — funciones SECURITY DEFINER (07/08/2026)

**Cifras reales (RECON MCP), corrigen los docs:** 429 funciones DEFINER en `public`; 361 ejecutables
por `anon`; 392 por `authenticated`; 24 triggers; 30 `*_by_token`; **14** DEFINER sin `search_path`
(no 77: el 77 del advisor cuenta también INVOKER); **59** DEFINER anon + `p_account_id` + sin guard
(la fuga real); 148 helpers sin cuenta.

**⚠️ LECCIÓN CLAVE (vale para todo F0): el `EXECUTE` se hereda de `PUBLIC`.** `REVOKE ... FROM anon`
NO cierra nada si `PUBLIC` conserva el grant. Hay que **`REVOKE ... FROM PUBLIC`** y re-`GRANT` a
`authenticated`/`service_role` donde haga falta. Se comprueba con
`has_function_privilege('anon', oid, 'EXECUTE')` (sí cuenta PUBLIC). Los triggers no necesitan EXECUTE
de nadie (se disparan por el mecanismo de trigger) -> se revocan de PUBLIC sin re-conceder.

**Aplicado y verificado 07/08:** 24 triggers revocados de PUBLIC (0 anon-exec); `search_path` fijado en
11 DEFINER de Folvy (3 PostGIS quedan como excepcion, no somos owner); 15 funciones internas de c1
(`_shop_*`, `_generate_daily_count_core`, seeds, `onboard_account`, `recast_lastapp_sales`,
`apply_appcc_assignment_moments`) con `anon` revocado y `authenticated`/`service_role` conservados.
**Contador anon-exec: 361 -> 325.** Inventario clasificado en `F0_1_inventario_definer_20260807.md`.

**Pendiente F0:** grupo externo de c1 (~38, mismo tratamiento: bloquear anon, mantener authenticated) +
auditoria de los 30 `*_by_token` (frontera = token, no revocar) + guards `belongs_to_account` sobre
`authenticated` (requiere grep de call-sites en repo) + c2 (148 helpers). Metodo: lotes pequenos,
verificacion en vivo tras cada uno, migracion versionada con guard `DO`.

## Cuadrante — estructura de `schedules.cells` (07/08/2026, CORREGIDO 07/08 noche — ver detalle arriba)
`cells` = `{ shift_template_id: { dia: [employee_id,...] } }`. Indice de dia **0-6, 0=lunes**,
`shift_date = week_start + dia` (SIN -1). La entrada anterior de este mismo dia ("1-7 con un indice '0'
anomalo = domingo anterior") era un error de lectura: en TODA la tabla en vivo solo existen las claves
'0'..'6' (nunca '7'); el '0' es solo menos frecuente porque Carabanchel cierra los lunes. Verificado
contra los 3 sitios del cliente que leen/escriben cells y con el trigger F7.1 en vivo (rollback). F7.1
YA esta cerrado (07/08 noche): guardado manual valida vacaciones (backstop BBDD + aviso pre-guardado en
CalendarioPage + cierre en shiftSwapService). Turnos viven aqui, no en tabla aparte.
Plantillas en `shift_templates` (label/start_time/end_time; ambiguas en Alcala, no borrar: Opcion 2).

---

---
_Docs relacionados: `folvy_kpi_tiempos_cocina_estado.md`, `folvy_actualizacion_tablets_diseno.md`, `folvy_vision_plan_ejecucion.md`, `folvy_incentivos_recon.md`, `folvy_hubrise_golive_checklist.md`, `folvy_hubrise_cierre_pausa_horarios_diseno.md`. Este mapa se ACTUALIZA cada vez que un RECON descubre algo nuevo._
