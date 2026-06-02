# Folvy — Conector Glovo Directo (Integración nativa de plataforma)
### Documento de diseño para aprobación · v1 · 02/06/2026

> **Estado:** diseño previo a construcción. NADA construido aún. Mismo método que EP1,
> módulo de Integraciones y Catcher: se aprueba el diseño antes de tocar BBDD o código.
>
> **Prioridad: nº1.** Es la materialización de la decisión estratégica del 02/06: Folvy
> deja de depender de intermediarios y se conecta DIRECTAMENTE a las plataformas de
> delivery. Glovo primero (48% de las ventas de Llorente29, y el agujero que ningún
> intermediario cubría en España).
>
> **Resuelve los 4 problemas de Julio:** coste (sin peaje de Last/HubRise), concepto 360
> (Folvy es el centro), control del dato (entra directo, sin tercero que controle el
> grifo) y fidelización estructural (si Folvy ES la integración, el cliente no se va sin
> romper su operación).
>
> **Encaje:** este conector VIVE dentro del módulo de Integraciones (I1 ya construido).
> Glovo es un `connector` (`code='glovo'`, `category='delivery_platform'`,
> `connection_type='credentials'`, `direction='bidirectional'`).

---

## 1. Fuentes y estado del acceso

- **API oficial:** `glovoapp.com` (OpenAPI 3.0, fichero `definition.yaml`, 6336 líneas).
  Staging `https://stageapi.glovoapp.com`, producción `https://api.glovoapp.com`. **Esta
  es la fuente buena.**
- **Doc complementaria:** Appsmart / `onlineservice.io` (middleware oficial subcontratado
  por Glovo para parte de la operativa de menú). Útil para detalles del modelo de menú.
- **Acceso solicitado (02/06):** email a `partner.integrationseu@glovoapp.com` con
  `partner_name=Folvy`, país España, y los endpoints de webhook. **A la espera de**
  credenciales de stage + tienda de staging + acceso a soporte (Jira).

---

## 2. Auditoría de mercado — hallazgos que condicionan el diseño (02/06)

De experiencias reales de integradores (GetOrder, Bitebell, Ordatic, Poster, Deliverect)
y de la doc de integradores de Glovo. **Estos hallazgos son restricciones de diseño, no
notas:**

| # | Hallazgo | Implicación de diseño |
|---|---|---|
| **H1** | **Al subir un menú completo, Glovo marca TODOS los productos como disponibles.** | Tras cada push de menú, **re-enviar inmediatamente el estado real de disponibilidad/stock**, o se venden platos agotados. G2 = push menú **seguido siempre** de push de disponibilidad. |
| **H2** | **Los Product IDs deben ser EXACTOS** (sin ceros de más, idénticos al catálogo). | El ID de Glovo por producto se guarda en `recipe_item.external_codes`/`folvy_code` y debe ser **estable y controlado por Folvy**. Un descuadre rompe el cruce pedido↔producto. |
| **H3** | **Flujo de activación:** tienda de test → subir menú en stage → al validar, crean tiendas en prod con tu `store_id` (external_id) → token productivo → conectan UNA tienda para probar → activan el resto. **El primer push de precio+stock debe hacerse ANTES de ir en vivo.** | El conector necesita un estado de "store" por local: `available→connecting→connected`. Encaja con `account_connector.status`. |
| **H4** | **UN solo token para todas las tiendas** (no uno por tienda). | El `credentials_ref` del conector Glovo es a nivel de cuenta/integración, no por local. |
| **H5** | **Un endpoint, distribución interna:** Folvy expone UN webhook a Glovo y enruta por `store_id` al cliente correcto. | **Valida la arquitectura multi-tenant de I1:** `account_connector.external_account_id` = store_id de Glovo → resuelve a qué `account_id`/`location` pertenece cada pedido. |
| **H6** | **Aceptación de pedidos:** automática o manual (configurable). | Decisión de producto (ver D3). Por defecto auto-aceptar; configurable por cuenta. |
| **H7** | **Fiscalidad:** quién fiscaliza las ventas de Glovo depende del contrato del cliente. | No técnico, pero a registrar para Llorente29 y para la reconciliación de facturas (§6). |
| **H8** | **Plazo de activación de referencia:** 3–5 días laborables (dato Deliverect). | Expectativa realista una vez Glovo da acceso. |

---

## 3. Arquitectura general

Folvy se registra ante Glovo como **POS Client / Plugin**. El "plugin" es la capa que
traduce el lenguaje de Glovo al de Folvy y viceversa.

```
                 (1) Pedido nuevo / cancelado  ─────────────►  ┌────────────────────┐
   GLOVO  ──────────────────────────────────────────────────► │  api.folvy.app     │
   (stage/prod)                                                │  /glovo/orders/*   │ (webhook único)
          ◄──── (2) accept / ready / out_for_delivery ──────── │                    │
          ◄──── (3) push menú / precios / disponibilidad ───── │  Edge Functions    │
                                                               └─────────┬──────────┘
                                                                         │ enruta por store_id (H5)
                                                                         ▼
                                                              account_connector → account/location
                                                                         │
                                                          ┌──────────────┴───────────────┐
                                                          ▼                               ▼
                                                    sale (pedidos)              menu_item/recipe_item (catálogo)
```

**Decisión de solidez (endpoint):** Glovo recibe **`api.folvy.app/glovo/orders/dispatched`
y `/cancelled`** (dominio propio, NO la URL de Supabase). Razón: desacopla el proveedor
—si cambia el backend, no hay que pedirle a Glovo que cambie la URL—, permite firma/
rate-limit/logging propios, y da imagen de integrador serio. Detrás, `api.folvy.app`
reenvía a la Edge Function de Supabase. (Montaje del dominio: tarea de G1.)

**Autenticación (de la API oficial):**
- Entrante (Glovo→Folvy): header `Authorization: <token>` (shared token único, H4) +
  verificación opcional de firma `Glovo-Signature` (SHA256 con RSA, base64) para confirmar
  que es Glovo. **Para ser sólidos: implementar la verificación de firma, no solo el token.**
- Saliente (Folvy→Glovo): mismo token en el header.
- **Reintentos con backoff (máx 3):** procesar SIEMPRE de forma **idempotente**,
  deduplicar por `order_id` (índice único). Igual patrón que el webhook de Last.

---

## 4. MITAD A — Recepción de pedidos (G1) · valor inmediato, riesgo bajo

Glovo→Folvy. Replica lo que ya funciona con Last (webhook→`sale`), pero con **dato
superior**. Mapeo a la tabla `sale` real (verificada hoy):

| Campo Glovo (payload) | → Campo `sale` | Nota |
|---|---|---|
| `order_id` | `external_ref` | Clave de cruce + dedup (índice único). |
| `store_id` | `external_location_text` + resuelve `location_id`/`account_id` | Vía `account_connector.external_account_id` (H5). |
| `order_type` (`pickup`/`delivery`) | **`service_type`** | ⭐ NATIVO: pickup=Glovo reparte (`platform_delivery`), delivery=restaurante reparte (`own_delivery`). Mejor que deducirlo (Last). |
| `order_time` | `sold_at` | |
| `payment_total` (céntimos) | `total` | Dividir /100. |
| `products_total` | (base de productos) | Para EP1. |
| `detailed_fees` → DeliveryFee | `delivery_cost` | Desglosado (mejor que Last). |
| `discounts` / `glovo_discounts` / `restaurant_discounts` | `discount_amount` (+ detalle en `raw_products`) | ⭐ SEPARA quién paga (ver §6). |
| `payment_method` | `payment_method` | DELAYED (tarjeta) / CASH. |
| payload completo | `raw_products` | JSON íntegro, para EP1/reconciliación. |
| (fijo) | `source = 'glovo'` | Distingue de `'lastapp'`. |
| (fijo) | `channel_id` | Canal Glovo de la marca. |

**Estados del pedido a devolver a Glovo (ciclo de vida, API oficial):** `accept`,
`ready_for_pickup`, `out_for_delivery`, `customer_picked_up`, `Update order status`.
Esto es lo que NO daba Last: Folvy puede **gestionar** el pedido, no solo leerlo.

**Por qué G1 primero:** valor inmediato (enciende el motor económico con dato directo de
Glovo), riesgo bajo (mapea limpio a `sale` actual), sin dependencias (no necesita el
modelo de modificadores). Es el corazón.

---

## 5. MITAD B — Push de catálogo, precios y disponibilidad (G2) · más complejo

Folvy→Glovo. Publicar la carta. El diferenciador "edita una vez, publica a Glovo". Mapeo
del modelo Folvy al árbol de Glovo:

```
Glovo:  super_categories → categories → sections → products → attribute_groups → attributes
Folvy:  (agrupación)       menu_item.category      menu_item   [MODIFICADORES]    [opciones]
```

| Elemento Glovo | ← Origen Folvy | Nota |
|---|---|---|
| `product.id` | `recipe_item.external_codes`/`folvy_code` | **EXACTO y estable (H2).** |
| `product.name` | `menu_item.name` | |
| `product.price` | `menu_item.price` | |
| `product.description` | `menu_item.description` | |
| `product.image_url` | `menu_item.photo_url` | Requisitos Glovo: 1000×1000 JPG <1MB HTTPS. |
| `product.available` | `menu_item.is_available` | **Re-enviar tras cada upload (H1).** |
| categories/sections | `menu_item.category` + `position` | |
| `attribute_groups`/`attributes` | **MODIFICADORES (pendiente)** | ⚠️ DEPENDENCIA (ver D1). |

**Flujo obligatorio (H1):** todo push de menú completo (`Upload menu` → `Verify menu
upload`) debe ir **seguido inmediatamente** de un push de disponibilidad real, o se venden
platos agotados. Para cambios puntuales, usar `Modify products` / `Modify attributes` /
`Bulk update` (límite 5 uploads completos/día/tienda).

**⚠️ DEUDA DECLARADA — Modificadores:** el push COMPLETO necesita el modelo de
modificadores (los `attribute_groups`/`attributes` de Glovo), que **aún no existe en la
BBDD de Folvy** (era el frente "Modifiers UX" pendiente). G2 se puede construir para
productos sin modificadores primero, y completarse cuando exista el modelo. NO es deuda
silenciosa: es dependencia explícita.

---

## 6. Ofertas, adds y facturas (deuda solicitada por Julio — análisis de viabilidad)

Julio pidió tener en cuenta la gestión de ofertas, adds (modificadores) y facturas. La
API de Glovo lo permite en distinto grado. Honestidad por pieza:

### 6.1 — Ofertas / promociones / descuentos
- **Medición (inmediata, viene gratis con G1):** el payload separa **`glovo_discounts`**
  (los paga Glovo) de **`restaurant_discounts`** (los paga el restaurante) y el descuento
  a nivel de producto. Esto es **oro para EP1/Capa B/C**: por fin se sabe el coste real de
  cada promoción y quién la financia. Entra en `sale`/`raw_products` desde G1.
- **Gestión activa (futuro):** crear/gestionar promociones desde Folvy hacia Glovo es un
  frente mayor aparte (depende de qué exponga la API de promociones de Glovo, a confirmar
  con acceso). **Se diseña cuando tengamos acceso al stage y veamos esos endpoints.**
  Declarado como frente futuro, no se promete hoy.

### 6.2 — Adds (modificadores / extras)
- Son los `attribute_groups`/`attributes` de Glovo. **Misma dependencia que G2** (modelo
  de modificadores pendiente en Folvy). Cuando exista, los adds se publican y se reciben
  (vienen en `products[].attributes` del pedido) de forma nativa.

### 6.3 — Facturas / reconciliación
- **Datos disponibles desde G1:** `invoicing_details` del cliente (cuando lo pide),
  `detailed_fees` (DeliveryFee/ServiceFee/MinimumBasketSurcharge), descuentos separados,
  `products_total` vs `payment_total`. **Es la materia prima de la reconciliación tipo
  factura (Capa C):** comparar lo que Folvy calcula contra lo que Glovo liquida.
- **Aviso fiscal (H7):** quién fiscaliza depende del contrato del cliente con Glovo. Dato
  de negocio a registrar por cliente.
- **Conclusión:** la reconciliación de facturas es **viable y alimentada por G1**, pero su
  construcción (motor de conciliación Folvy vs liquidación Glovo) es Capa C — frente
  posterior, diseñado cuando G1 fluya con datos reales. Declarado, no prometido para ya.

---

## 7. Modelo de datos (encaje con I1 — verificar `information_schema` antes de tocar)

**No requiere tablas nuevas para G1.** Reutiliza:
- `connector` (ya sembrado: falta añadir fila `glovo`).
- `account_connector`: una fila por cuenta con Glovo. `external_account_id` ↔ store_id,
  `credentials_ref` ↔ token único (H4), `status` ↔ estado de conexión (H3).
- `sale`: recepción de pedidos (G1), sin columnas nuevas (lo extra va a `raw_products`).
- `recipe_item.external_codes`/`folvy_code`: ID de producto Glovo (H2).
- `menu_item`: origen del push (G2).

**Posibles columnas futuras (NO ahora, solo si el diseño lo pide tras G1):** desglose de
fees/descuentos de Glovo como columnas propias en `sale` (hoy caben en `raw_products`).
Decisión diferida hasta ver el volumen real de uso en EP1.

**Seed del conector Glovo** (cuando se apruebe): `code='glovo'`,
`category='delivery_platform'`, `connection_type='credentials'`, `managed_by='either'`,
`direction='bidirectional'`, `config_schema` con el token y el store_id por local.

---

## 8. Plan de construcción por fases (cerrar bien, una a una)

- **G0 — Acceso + alta** (en curso, fuera de código): correo a Glovo enviado. Al recibir
  stage: token + tienda de staging. Sembrar `connector` glovo. Montar `api.folvy.app/glovo/*`
  apuntando a la Edge Function.
- **G1 — Recepción de pedidos** (PRIMERO, valor inmediato): Edge Function
  `glovo-webhook` (dispatched + cancelled) → mapeo a `sale` (con `service_type` nativo,
  fees, descuentos separados) → dedup idempotente por `order_id` → enrutado multi-tenant
  por `store_id` (H5). + endpoints de ciclo de vida (accept/ready/...). **Medible:** un
  pedido de prueba en stage entra en `sale` con todos los campos correctos.
- **G2 — Push de catálogo + disponibilidad**: mapeo `menu_item`→árbol Glovo, `Upload menu`
  + `Verify` + push de disponibilidad inmediato (H1) + IDs exactos (H2). Productos sin
  modificadores primero; con modificadores cuando exista el modelo.
- **G3 — Reconciliación / facturas (Capa C)**: motor Folvy-calculado vs Glovo-liquidado,
  alimentado por los datos de G1.
- **G4 — Ofertas/promociones activas + LAAS**: gestión de promos hacia Glovo (según API) y
  LAAS (repartidores de Glovo para reparto propio, sandbox `laaspartners.testglovo.com`).

Cada fase: diseño aprobado → BBDD (transaccional, revisable) → service → Edge Function →
build verde → verificación desde la app. Cero deuda colgando entre fases.

---

## 9. Decisiones abiertas (cerrar antes de construir)

- **D1 — Modificadores:** ¿se diseña el modelo de modificadores ANTES de G2 (para que el
  push sea completo desde el inicio) o se hace G2 solo-productos primero y modificadores
  después? Afecta el orden. (Recomendación: G1 no depende de esto; decidir al llegar a G2.)
- **D2 — Cifrado del token (H4):** Supabase Vault o secret de Edge Function. El
  `credentials_ref` apunta a él, NUNCA token en claro. (Enlaza con deuda de seguridad.)
- **D3 — Aceptación de pedidos (H6):** ¿auto-aceptar o manual? ¿configurable por cuenta?
- **D4 — Desglose de fees/descuentos:** ¿columnas propias en `sale` o todo en
  `raw_products`? (Recomendación: `raw_products` primero, columnas si EP1 lo exige.)
- **D5 — Verificación de firma Glovo-Signature:** ¿se implementa desde G1 (más sólido) o
  se difiere? (Recomendación: desde G1, por solidez, como pidió Julio.)

---

*Documento vivo. Al aprobar, versionar en `docs/` y referenciar en `CONTEXTO_CLAUDE.md`.
Construcción: G1 primero (no depende de credenciales para diseñarse; sí para probarse).
El acceso a la API de Glovo (G0) está solicitado y es el desbloqueo de las pruebas.
Antes de tocar esquema, verificar estado real vía `information_schema`.*
