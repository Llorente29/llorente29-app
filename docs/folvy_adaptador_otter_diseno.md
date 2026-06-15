# Folvy — Adaptador Otter (ingesta canónica + publicación de catálogo)

**Fecha:** 16 jun 2026
**Estado:** DISEÑO + esqueleto. Construido hasta el límite del alta. **Bloqueado en vivo**
por el onboarding de Otter (Application ID + Client Secret + webhook secret).
**Conecta con:** `folvy_estrategia_delivery.md` (Otter = candidato líder, correo 2º enviado),
`folvy_ingesta_canonica_diseno.md` (todo proveedor entra como adaptador sobre el canónico),
`folvy_integraciones_modulo_diseno.md` (Otter como `connector` slug `otter`).

> **Regla rectora aplicada (principio 5):** autorización en la FRONTERA, motor puro.
> `otter-webhook` es frontera (valida `X-HMAC-SHA256` y despacha). El adaptador
> (`adapt_otter_order`, motor) traduce el formato de Otter → canónico y NO lleva guard de
> usuario. Idéntico reparto que `lastapp-webhook` + `adapt_lastapp_order`.

---

## 0. Qué se deja HECHO hoy vs qué espera al alta

| Pieza | Hoy (sin Otter) | Espera al alta |
|---|---|---|
| Frontera `otter-webhook` (validación HMAC + despacho de eventos) | ✅ escrita, compila | secret real (`OTTER_WEBHOOK_SECRET`) + **deploy** |
| Adaptador canónico `adapt_otter_order` (Otter order → `sale`/`sale_line`) | ✅ esqueleto + tabla de mapeo (§7) | **confirmar campos** contra payload real / OpenAPI |
| `connector` slug `otter` + `account_connector` (alta como dato) | ✅ semilla SQL | rellenar `credentials_ref` al onboardear |
| `external_store_map` (store de Otter → location/brand de Folvy) | ✅ modelo (§5) | poblar al parear cada tienda real |
| Pairing de tiendas (`stores.upsert` / `v1/stores`) | ✅ flujo descrito + handler stub | Application ID/Secret para llamar `v1/stores` |
| Catálogo bidireccional (Menus + Menus Manager) | ✅ diseñado (§6) | token de API para publicar/leer |

**El día del alta = pegar 2 credenciales + 1 secret, desplegar con `--no-verify-jwt`,
parear la tienda y verificar con un pedido real.** No es "construir Otter".

---

## 1. Arquitectura (frontera única, motor puro)

```
Otter Public API ──(webhook order.create, firmado X-HMAC-SHA256)──▶ otter-webhook  (FRONTERA)
                                                                        │ valida HMAC
                                                                        │ despacha por tipo
                                                                        ▼
                                                              adapt_otter_order  (MOTOR PURO)
                                                                        │ Otter order → canónico
                                                                        ▼
                                                  sale / sale_line (mismo canónico que Last)
                                                                        │
                                                          reprocess_sale (coste + consumo)
```

Añadir Otter NO toca el modelo canónico ni el motor de coste/consumo: es **1 frontera
nueva (su webhook + su secret) + 1 adaptador nuevo (su formato → MISMO canónico)**. Es la
tercera vez que se monta esta forma (Last, HubRise, Otter); cada vez más afinada.

---

## 2. Onboarding (lo que concede Otter, una sola vez)

Doc: *Onboard your application*. El acceso a la Public API NO es por credenciales del
cliente (a diferencia de Last): hay que **registrar una Application** (alta manual única
con el Account Representative). Se reciben, por entorno (staging + producción):

- **Application ID** (antes "Partner ID").
- **Client Secret**.

Y por cada endpoint de webhook que configures en su Developer Portal:

- **Webhook secret** (para validar `X-HMAC-SHA256`).
- **Authentication Type** del header `Authorization` (`HMAC SHA1` legacy / `Basic` /
  `Bearer` / `None`) — además del `X-HMAC-SHA256` que viene SIEMPRE.

**Sin esto no hay token, ni registro de webhook, ni store pairing.** Es el único cable
que falta.

---

## 3. Ingesta de pedidos (`order.create`)

Doc: *Order Create Event Flows*.

1. Otter envía el webhook `order.create` a la URL preconfigurada; el payload **contiene el
   pedido** (líneas, modificadores, combos, marca, canal, notas, totales).
2. La frontera responde:
   - `HTTP 200` → procesado síncronamente.
   - `HTTP 202` → aceptado para proceso asíncrono; al terminar, Folvy avisa con el webhook
     "Notify the result of a Create Order event".
3. Errores → se reportan vía `PublishError`.

**Decisión Folvy:** responder `200` síncrono (igual que `lastapp-webhook`: persistir el raw
+ adaptar inline es barato). `202` queda como ruta futura si el adaptado se vuelve caro.

**RAW EVENT STORE (principio de Julio):** guardar el pedido COMPLETO de Otter en
`sale.raw_tab` (como con Last) — no descartar nada de la cabecera, aunque hoy no se use.

---

## 4. Autenticación de webhook (la frontera)

Doc: *Webhook Authentication*. **Cada** request trae el header `X-HMAC-SHA256` =
base64( HMAC-SHA256( body_crudo, webhook_secret ) ), independientemente del
`Authentication Type` elegido.

Validación en la frontera (implementada en el esqueleto con Web Crypto de Deno):
1. Leer el **body crudo** (string, sin re-serializar — el HMAC es sobre los bytes exactos).
2. Calcular `base64(HMAC_SHA256(body, OTTER_WEBHOOK_SECRET))`.
3. Comparar (constante en tiempo) contra `X-HMAC-SHA256`. Si no casa → `401`, no se procesa.

> Es el mismo modelo de seguridad que Last: la frontera valida con el secret dentro del
> código. **Deploy SIEMPRE con `--no-verify-jwt`** (regla de webhooks: sin la flag, el
> gateway corta con 401 antes de ejecutar y se pierde TODA entrega en silencio).

---

## 5. Pairing de tiendas (a qué cuenta/local/marca pertenece el pedido)

Doc: *Store Onboarding*. Flujo:

- Otter dispara `stores.fetch_credentials` (`stores.fetch_credentials`) → Folvy devuelve el
  esquema de credenciales que pide (si aplica).
- Otter dispara `stores.upsert` cuando se añade una tienda → Folvy responde `2XX` si la
  acepta; los valores de credenciales custom llegan aquí.
- Tras aceptar, Folvy **valida la tienda y devuelve su propio external store id** por el
  endpoint `v1/stores`. Después puede `suspend` / `activate` / `invalidate` por ese id.

**Mapeo a Folvy (gemelo de `external_brand_map` de Last):** la tienda de Otter es la llave
estable que viaja en cada pedido. Se guarda en `external_store_map`:

```
external_store_map               (NUEVO — mapeo estable Otter → Folvy)
  id                  uuid pk
  source              text      -- 'otter'
  external_store_id   text      -- el id que Folvy devolvió a Otter (o el de Otter)
  external_brand_id   text NULL -- marca dentro de la tienda, si Otter la distingue
  account_id          uuid  → accounts(id)
  location_id         uuid  → locations(id)
  brand_id            uuid NULL → brands(id)
  created_at / updated_at
  UNIQUE (source, external_store_id, external_brand_id)
```

> Principio de Julio (marca estable por UUID): la marca/local NO se deduce de los productos;
> se resuelve por el id estable de la tienda que trae el pedido. Lo no reconocido →
> cola de excepciones (no se inventa).

---

## 6. Catálogo bidireccional (Menus + Menus Manager)

Dos dominios, las dos direcciones cubiertas:

- **Menus** → *publicar*: `Menu Publish`, `Update Menu Entities Availability`, `Upsert Hours`.
  Folvy es la verdad del catálogo (propias: manda; cedidas: espeja sin tocar la carta del
  cedente pero costea) → publica `menu_item` hacia la plataforma vía Otter.
- **Menus Manager** → *leer + escribir*: `Read and Upsert Menus`, `Publish Menus To Target`,
  `Suspend/Unsuspend Menu Entities`, `Manager Menu Sync`. Folvy puede leer la carta existente
  y reconciliarla (casado por id estable, igual que el catálogo de Last).

**Disponibilidad (atado al frente de alertas):** `Suspend/Unsuspend` + `Storefront`
(`Pause/Unpause`, `Get Store Availability`) SÍ están en Otter — a diferencia de Last, que NO
expone el cierre de marca/canal. Es decir, para los clientes en Otter, la alerta de
"marca/canal cerrado" puede ser determinista (no proxy por silencio de ventas). Anotado como
mejora del frente de monitorización para fuentes que sí lo exponen.

**Lo que Otter NO da (honesto):** no hay dominio de promociones/ofertas/campañas. El efecto
de la promo llega en el total del pedido (Order Total v2) y en Finance/Reports → Folvy
calcula margen neto de promo, pero crear/gestionar la oferta de Uber se hace en Uber Eats
Manager.

---

## 7. Mapeo canónico (Otter order → `sale` / `sale_line`)

> **⚠️ PENDIENTE DE VALIDAR:** los nombres EXACTOS de campo se confirman contra el OpenAPI
> Reference y/o un pedido real (no hay sandbox con datos; se valida con JSON de ejemplo y,
> en vivo, con el primer pedido). La estructura de abajo es el contrato a confirmar, NO
> verificado contra tráfico real.

| Canónico (Folvy) | Origen Otter (a confirmar) | Notas |
|---|---|---|
| `sale.external_source` | `'otter'` | fijo |
| `sale.external_tab_ref` | order id | agrupa el pedido |
| `sale.external_channel_text` | order.channel / platform | Glovo/Uber/JustEat |
| `sale.brand_id` / `location_id` / `account_id` | store id → `external_store_map` | NUNCA por productos |
| `sale.raw_tab` | payload completo | raw event store |
| `sale.status` | order lifecycle | open→closed→cancelled |
| `sale_line.external_product_id` | item id (organization/product id) | casado por id estable |
| `sale_line.line_type` | product / modifier / combo_item | jerarquía como `adapt_lastapp_order` |
| `sale_line.parent_sale_line_id` | item parent | combos/modificadores |
| `sale_line.qty` / `unit_price` / `line_amount` | item qty/price | |
| totales + descuento de plataforma | Order Total **v2** | base homogénea, margen neto de promo |
| nota de cliente | item.comments / order notes | banda roja en KDS (alérgenos) |

El adaptado reusa el patrón de `adapt_lastapp_order` (descompone jerarquía
product/modifier/combo_item) y, tras adaptar, dispara `reprocess_sale` (coste + consumo).

---

## 8. Modelo de datos (incremental, no reescribe nada)

- `connector` (catálogo de integraciones): fila `slug='otter'`, `category='delivery_platform'`,
  `connection_type='credentials'`, `managed_by='superadmin'` (Folvy gestiona la Application),
  `direction='bidirectional'`.
- `account_connector`: la conexión de cada cuenta cliente; `external_account_id` = store/org de
  Otter; `credentials_ref` = referencia cifrada a Application ID/Secret (NUNCA en claro).
- `external_store_map` (§5): mapeo estable store → location/brand.
- Cero cambios en `sale`/`sale_line`/`menu_item` salvo asegurar `external_source` admite `'otter'`.

---

## 9. Fases de construcción

- **O1 — Frontera + esqueleto (HOY, sin alta):** Edge Function `otter-webhook` con validación
  HMAC + despacho por tipo de evento (order.create, stores.upsert, stores.fetch_credentials,
  order status) + respuestas 200/202. Semilla `connector` slug `otter`. `external_store_map`.
  **Medible sin Otter:** un POST firmado con un secret de prueba pasa la frontera; uno mal
  firmado da 401.
- **O2 — Adaptador canónico:** `adapt_otter_order` (Otter order → canónico) validado contra
  JSON de ejemplo de la doc. `reprocess_sale` al final. **Medible:** un order de ejemplo entra
  y produce `sale`/`sale_line` correctos.
- **O3 — Pairing real (REQUIERE ALTA):** registrar la Application, configurar el webhook
  (obtener `OTTER_WEBHOOK_SECRET`), parear la tienda del cliente (`stores.upsert` → `v1/stores`),
  poblar `external_store_map`. Deploy `--no-verify-jwt`. **Medible:** un pedido REAL entra y casa.
- **O4 — Catálogo bidireccional (REQUIERE ALTA):** publicar `menu_item` vía Menus; leer/reconciliar
  vía Menus Manager.
- **O5 — Visión:** Finance/Reports (payout, margen neto de promo), Reviews, Storefront (alerta de
  cierre determinista).

---

## 10. Deudas / decisiones abiertas

- **D1 — Order Total v1 vs v2:** usar **v2** desde el día 1 (su doc marca migración a v2;
  trae el descuento de plataforma desglosado, clave para margen neto). Confirmar formato.
- **D2 — Cifrado de credenciales:** `credentials_ref` → Supabase Vault o secret de Edge
  Function (enlaza con la deuda de seguridad service_role / rotaciones pendientes).
- **D3 — Adaptador en SQL vs TS:** por coherencia con `adapt_lastapp_order` (motor puro SQL),
  el adaptado canónico va en SQL; la frontera (TS/Edge) solo valida y delega.
- **D4 — Status notifications:** mapear el ciclo de vida de Otter (order status) a
  `sale.status` (open/closed/cancelled) — confirmar estados exactos contra la doc de
  *Order Status notifications*.

---

*Documento vivo. Al aprobar, versionar en `docs/` y referenciar en CONTEXTO_CLAUDE.md.
La frontera y el adaptador se dejan listos; O3+ arrancan cuando Otter conceda el alta.*
