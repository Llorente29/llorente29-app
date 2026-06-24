# Folvy × HubRise — Mapa de capacidades (qué aprovechar y qué no)

> **Propósito:** inventario honesto de TODO lo que la API/ecosistema de HubRise ofrece y cómo lo aprovecha Folvy, para guiar los frentes de loyalty, reparto propio, horarios, impresión y catálogos.
> **Última revisión:** 2026-06-24 (RECON contra la documentación pública de HubRise).
> **Lente:** frontera única + modelo canónico. **Folvy es la verdad** (catálogo, coste, margen, stock, ticket); **HubRise es el tubo** hacia Uber/JustEat/Glovo. Solo se adopta de HubRise lo que Folvy no hace mejor.

---

## 0. Prioridades fijadas por Julio (24/06)

1. **Catálogos**: subida + control desde Folvy — **dado por hecho** (el Publicador).
2. **Horarios de tienda**: **básico y fundamental**, hay que tenerlo.
3. **Reparto propio**: **muy muy importante**.
4. **Loyalty**: aprovechar.
5. **86 / disponibilidad**: frente activo (en construcción).
6. **Impresión**: Folvy **aún no la tiene resuelta** → aprovechar HubRise como **transporte cloud**, no como recibo.

---

## 1. Tabla maestra

| Recurso HubRise | Qué da | Cómo lo aprovecha Folvy | Prioridad |
|---|---|---|---|
| **Catálogo + variants** | 1 catálogo con *variants*: precio y disponibilidad por canal sin catálogos separados | **Publicador**: 1 catálogo + 1 variant por canal = calca `menu_item_override`. Subida y control desde Folvy | 🟢 Dado por hecho |
| **Inventario (86)** | stock por `sku_ref`/`option_ref` **por location** + `expires_at` | leg de 86 vía `availability-dispatch`. `expires_at` = "agotado hasta las X" nativo | 🟢 Activo |
| **Locations: `order_acceptance` + `opening_hours`** | abrir/cerrar, pausar (normal/busy/paused), horarios por día, `cutoff_time`, `preparation_time` | **Horarios de tienda** (lo que Last NO daba): empujar horarios de Folvy a canales + pausa por local + fuente directa de abierto/cerrado para la alarma de disponibilidad | 🟢 Básico/fundamental |
| **Deliveries** | tracking del rider: estado, lat/long, ETAs, `tracking_url`, webhook `delivery.update` | **Reparto propio**: estado "En ruta" + métricas + tracking; Catcher/Stuart adjuntan la delivery | 🟢 Muy importante |
| **Customers + loyalty** | DB de clientes agregada por canal + tarjetas de fidelidad con operaciones de puntos | **Módulo Loyalty/CRM** (hoy `coming_soon`): leer histórico, escribir puntos. Ojo: marketplaces anonimizan PII | 🟠 Aprovechar |
| **Impresión** (apps cloud: OrderLine, Expedy) | impresoras cloud autónomas + adaptador ESC/POS | **Transporte cloud** bajo el modelo agnóstico (`printer.transport`): trasegar **nuestros** bytes ESC/POS sin agente en local. NO su recibo estándar | 🟡 Transporte |
| **Callbacks** | eventos catalog/inventory/location/customer/delivery/order | sync de vuelta: `inventory.patch` avisa al expirar un 86 (reactivar solo); cambios de horario/catálogo | 🟠 Aprovechar |
| **Pedidos** | create/update/status, `connection_name` (marca), `private_ref`, loyalty fields | ingesta + empuje (hecho). `private_ref` = colgar `sale_id` en el pedido = idempotencia/cross-ref limpia | 🟡 Mejora menor |
| **Logs por conexión** | logs de API en el back office | observabilidad/debug del empuje async (deuda) | ⚪ Operativo |
| **Informes / dashboard** | ventas agregadas por canal/local | — Folvy ya tiene la **verdad de margen** (escandallo). No adoptar | 🔴 Folvy gana |
| **Apps white-label de gestión** (Order/Catalog Manager, KDS de terceros) | apps skinneables | — Folvy **ES** el order manager / catálogo / KDS. No adoptar (salvo como envoltorio comercial reseller) | 🔴 Es Folvy |

---

## 2. Detalle por área (accionable)

### 2.1 Catálogos + variants — el Publicador
- Folvy publica **1 catálogo por marca** y usa **variants** (una por canal: Glovo/Uber/JustEat) con `price_overrides` y `restrictions` a nivel SKU/opción.
- Una variant con `restrictions.enabled=false` excluye el item de ese canal → es el **86 por canal a nivel catálogo** (distinto del 86 por inventario, que es por stock).
- Esto **sustituye** la idea de N catálogos por canal y casa 1:1 con `menu_item_override`.
- Subida **manual** recomendada por HubRise (un push automático con un catálogo erróneo se propaga a los canales sin que el usuario lo note) → botón explícito en Folvy, nunca push silencioso.

### 2.2 Inventario (86)
- Endpoint de inventario **por location** (cada location tiene su inventario aunque compartan catálogo).
- Cuerpo: entradas `{ sku_ref | option_ref, stock, expires_at? }`.
  - `stock:"0"` = agotado. `expires_at` (solo si stock 0) = vuelve a estar disponible en esa fecha → **timer "agotado hasta las X" nativo** (en Last era Fase 2).
  - `stock:null` = elimina la entrada = stock ilimitado → **reactivar**.
- `PATCH` actualiza solo las entradas enviadas (atómico por producto); `PUT` reemplaza.
- Callback `inventory.patch` notifica cuando una entrada **expira** → Folvy debe escucharlo para **reactivar solo** localmente.
- **Dependencia dura para el leg de Folvy:** hace falta el mapeo `matrícula Folvy → sku_ref de HubRise` (hoy inexistente; ver §3).

### 2.3 Horarios + pausa (lo que Last no daba)
- `opening_hours` por día (varios tramos `from`/`to`), `cutoff_time`, `preparation_time`. Editables por API; cambios disparan callback `location.update`.
- `order_acceptance`:
  - `{ mode:"normal" }` — aceptando con normalidad.
  - `{ mode:"busy", resume_at?, extra_preparation_time }` — aceptando con retraso.
  - `{ mode:"paused", resume_at?, reason? }` — no acepta pedidos (pausa de tienda).
- **Aprovechamiento:** (a) **empujar** los horarios declarados en Folvy a los canales; (b) **pausa por local** desde Folvy; (c) **fuente directa de abierto/cerrado** para la alarma de silencio de ventas (en Last la atábamos a horarios declarados por no exponerlo Last; con HubRise hay verdad directa).
- **Pausa por canal** (no por local) = bloquear la **conexión** de ese canal (cada canal/marca es una conexión independiente). Acción hermana de la pausa de local.

### 2.4 Reparto propio (Deliveries)
- Una `delivery` se adjunta a un pedido con `service_type=delivery`. Campos: `carrier`, `status` (pending → pickup_waiting → in_delivery → delivered/cancelled), `estimated_pickup_at`/`estimated_dropoff_at`, `tracking_url`, `driver_name`/`phone`/`latitude`/`longitude`, `assigned_at`/`pickup_at`/`delivered_at`.
- `driver_latitude`/`longitude` se actualizan a alta frecuencia y **no** disparan `order.update` (para no inundar de eventos) → suscribirse a **`delivery.update`** para la posición del rider.
- **Aprovechamiento (frente 7b reparto propio):** estado "En ruta" + métricas de tiempos + tracking al cliente. Folvy **adjunta** la delivery (cuando despacha por Catcher/Stuart/Uber Direct) y va actualizando estado/posición. Para reparto de **plataforma** (rider de Glovo/Uber) el dato lo trae la propia plataforma; Folvy solo lo refleja.
- Nota: HubRise **no despacha** al courier (eso es Catcher/Stuart/Uber Direct); HubRise es la **capa de tracking/estado** del pedido.

### 2.5 Loyalty + CRM (customers)
- `customer_list` agrega clientes de **todos los canales** con perfil (nombre, email, teléfono, dirección), flags de marketing (`sms_marketing`/`email_marketing`), `nb_orders`, `order_total`, primera/última compra, `custom_fields`.
- `loyalty_cards` por cliente (balance) + `operations` (POST con `delta` de puntos → recalcula `new_balance`; las operaciones no se borran ni editan).
- `anonymise` por cliente (GDPR; irreversible; anonimiza también sus pedidos).
- **Aprovechamiento (módulo Loyalty/CRM, hoy `coming_soon`):** Folvy puede leer el histórico y **escribir puntos** sobre el pedido. **Realidad importante:** Uber/Glovo suelen **no compartir PII** del cliente (anonimizado) → el CRM es rico en **canal directo (Folvy Shop)** y pobre en marketplace. Diseñar el módulo asumiendo esa asimetría.

### 2.6 Impresión (transporte cloud, NO recibo)
- HubRise **no imprime**; enruta a apps de impresora cloud: su **OrderLine** y terceros como **Expedy**.
- Expedy = impresora cloud **autónoma** (WiFi/Ethernet/4G, sin PC ni tablet), layout personalizable, **adaptador ESC/POS** para impresoras existentes, Cloud Print API. ~7-19 €/mes.
- **Decisión deuda-0:** imprimir "a través de HubRise" saca el **recibo estándar** de HubRise → se pierden nuestros 3 documentos (bolsa/cocina/pegatinas) con escandallo, fiscal, alérgenos y QR.
  - ✅ **Sí:** usar una impresora cloud (Expedy o Sunmi) como **`printer.transport`** que trague **nuestros bytes ESC/POS** → impresión sin agente en local **conservando** el rendering rico de Folvy. Resuelve el hueco actual (hoy hace falta el agente; Sunmi cloud está pendiente de partner).
  - ❌ **No:** adoptar el recibo estándar de HubRise/Expedy.
  - ⚠️ **A verificar:** que el adaptador/API de Expedy acepte bytes ESC/POS crudos (no solo su propio ticket-builder). Si solo acepta su builder, no sirve para nuestro multi-documento.

### 2.7 Callbacks (sync bidireccional)
- Eventos: `catalog`, `customer`, `customer_list`, `delivery`, `inventory`, `location`, `order` × create/delete/patch/update. Firmados con `X-HubRise-Hmac-SHA256` (hex). Activo (webhook) o pasivo (poll).
- **Aprovechar:** `inventory.patch` (reactivar 86 al expirar), `location.update` (cambios de horario/pausa hechos fuera de Folvy), `delivery.update` (posición del rider), `catalog` (cambios de catálogo desde otra app).

### 2.8 Pedidos — mejora menor
- `private_ref` (≤255 chars) = colgar el `sale_id`/`menu_item_id` de Folvy en el pedido/línea de HubRise → cross-ref limpio sin depender solo del `order.id`.
- Campos de loyalty en línea (`points_earned`/`points_used`) → entrada para el módulo Loyalty.

---

## 3. Dependencias y deudas (para que el aprovechamiento sea real)

1. **Token por conexión en BBDD, no en Secret.** Hoy el token de HubRise vive en un Secret único (`HUBRISE_ACCESS_TOKEN`, location de test). Last usa `external_integration.token_secret_name` → Secret por org (2 orgs, viable). HubRise tiene **muchas conexiones por marca** → un Secret por conexión no escala. El token debe vivir en **columna de BBDD por conexión** (con su `external_location`/`catalog_id`). Es el pilar 1 del cierre.
2. **Mapeo `matrícula Folvy → sku_ref de HubRise`.** El despachador del 86 apunta al SKU vía `external_catalog_product` (hoy con datos de Last). Para HubRise no existe aún porque el **catálogo del Cliente 2 no está importado** (bloqueado por el bug org-vs-`locationId`). El leg de 86 se construye y valida contra la cuenta de test (`zy9j2`/catalog `mm92j`) sembrando el mapeo; el 86 real del Cliente 2 espera al arreglo del import.
3. **`set_product_availability` v2 es Last-only.** Resuelve locations externas filtrando `source='lastapp'` y solo pasa esas. Para HubRise hay que resolver también `source='hubrise'`.
4. **Rate limits.** 10 req/min en GET pesados (`catalogs/:id`, `orders`, `customers`) → throttle en la importación/sync de catálogo. Imágenes con cupo aparte (alto).
5. **Secret de despacho en claro.** El `availability-dispatch` secret quedó pegado literal en `20260621T2330_set_product_availability_v2.sql` → rotar (lista de seguridad).

---

## 4. Coste (para onboarding)
- Suscripción por location con descuento por volumen (~35 €→30 €/location según número).
- Setup 25 €/marca/plataforma; descuento por altas agrupadas; 1ª marca/local gratis; reseller −28,6% desde la 6ª cuenta.
- **Glovo Bridge:** cargo de **hasta 5 €**, no antes de **enero 2027** y puede que nunca (aviso de Janaina, 24/06).
- Conexiones (Just Eat / Glovo) **no son 100% autoservicio**: HubRise queda en el bucle de alta con la plataforma. La marca blanca total sí es posible (el cliente solo ve Folvy).

---

## 5. Veredicto

HubRise es **infraestructura aprovechable a fondo**, no solo un canal de pedidos: catálogo (variants), 86 (inventario con timer nativo), **horarios + pausa** (lo que Last no daba), **reparto propio** (tracking del rider), **loyalty/CRM** (con la salvedad del PII de marketplace) y un **transporte de impresión cloud** que tapa el hueco de Folvy sin renunciar al ticket propio. Lo único que **no** se adopta es lo que Folvy ya hace mejor: el margen real (informes) y la gestión (order manager/catálogo/KDS), donde HubRise sería un downgrade.
