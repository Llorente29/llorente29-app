# Folvy — Módulo de Integraciones (Conectores)
### Documento de diseño para aprobación · v1 · 02/06/2026

> **Estado:** diseño previo a construcción. NADA construido aún. Igual método que
> Economía de Plataformas: se aprueba el modelo sobre papel antes de tocar BBDD.
>
> **Disparador:** Julio observó (sobre el panel de integraciones de Last.app) que Folvy
> necesita un sitio donde gestionar las integraciones que se van haciendo, y que
> **comercialmente es mejor que el propio cliente las solicite/active**. Coincide con que
> Folvy ya es de facto un conector multi-fuente (Last.app ventas, Catcher reparto,
> HubRise en exploración, Glovo/Uber/JustEat) sin una cara visible que lo gestione.
>
> **Relación con Economía de Plataformas:** son el mismo frente por dos lados. Las
> integraciones *traen* los datos (ventas, reparto, comisiones); la economía los
> *calcula*. Se diseñan coherentes para no rehacer.

---

## 1. Por qué este módulo (y por qué ahora)

1. **Ya existe por dentro, sin cara.** El conector de Last (webhook + backfill), la
   futura integración de Catcher, etc., viven hoy como Edge Functions sueltas sin un
   lugar donde el operador las vea, active o configure. El módulo les da cara.
2. **Multi-tenant lo exige.** Con Llorente29 + cliente esperando + cartera, cada cuenta
   tendrá sus integraciones distintas (sus marcas en Glovo, su Catcher, su POS). Sin un
   panel por cuenta, esto es inmanejable a mano.
3. **Es retención e ingreso, medido (no opinión).** El benchmark (§2) confirma: SaaS con
   5+ integraciones self-service ven **60–80 % menos churn y +20 % de disposición a
   pagar**. Que el cliente conecte sus propias herramientas es palanca comercial directa.
4. **Es la casa natural de Catcher.** La integración de Catcher (credenciales en camino,
   API confirmada) necesita un sitio donde configurarse. Ese sitio es este módulo.

---

## 2. Benchmark (auditado el 02/06)

| Actor | Patrón de integraciones |
|---|---|
| **Last.app** (el que usa Llorente29) | Dos zonas: **"Tus integraciones"** (activas, con toggle on/off y estado "Solicitada") + **"Marketplace"** (catálogo para instalar). Categorías: Pedidos, KDS, Reparto, Existencias, Pagos, Reservas, Fidelidad, Reportes. Botón "Instalar". |
| **Toast** (referente del patrón) | **"My Integrations"** + **"Integration Marketplace"**. Filtro por categoría, "Add with one click", añadir la misma integración a varias localizaciones, ver/editar/quitar. Algunas integraciones directas (Glovo/Uber/DoorDash) sin pasar por marketplace; otras requieren contratar un "suite". |
| **Patrón SaaS general** (Datadog, Truto, Albato) | Catálogo de *tiles*; cada tile con estados **disponible → conectando → conectada → error**. Conexión por **OAuth** (el cliente pulsa Conectar → consentimiento del proveedor → vuelve conectado) cuando el proveedor lo soporta. Credenciales cifradas. |

**Conclusiones de diseño (lo que copiamos de los mejores):**
- **Dos zonas** (Tus integraciones + Marketplace) con **categorías**. Universal, lo usan todos.
- **Estados por tile**: disponible / solicitada / conectando / conectada (activa·pausada) / error.
- **Dos vías de conexión** según el proveedor: **OAuth self-service** (ideal) y
  **credenciales/solicitud** (cuando hace falta gestión, como Catcher).
- **Multi-localización**: una integración conectada se puede aplicar a varios locales.

---

## 3. Decisión de Julio: quién conecta (modelo MIXTO configurable — opción "c")

Julio: *"comercialmente mejor que lo haga/solicite el cliente"*, y ante la pregunta
admin-vs-cliente: **"ambos según la integración"**. El benchmark lo respalda: lo mejor es
**self-service por defecto, gestión donde el proveedor lo exige**. Por eso cada conector
declara su modo:

- **`oauth`** → el cliente lo conecta **solo** (botón "Conectar" → consentimiento → vuelve
  conectado). Cero fricción. Ej.: integraciones que expongan OAuth.
- **`credentials`** → requiere claves del proveedor (appId/appSecret, token…). Según la
  config de la integración, las introduce **el cliente** (formulario guiado) **o el
  superadmin** (si Folvy gestiona la relación con el proveedor). Ej.: **Catcher**.
- **`request`** → el cliente **solicita** la integración (no la puede activar solo); genera
  una tarea para el superadmin / un flujo de alta. Estado "Solicitada" (como el JustEat
  ámbar de Last). Ej.: integraciones que requieren contrato/onboarding del proveedor.

**Quién gestiona se decide POR INTEGRACIÓN, no global** (campo `managed_by`:
`client` | `superadmin` | `either`). Esto es la "c" de Julio, hecha dato.

---

## 4. Modelo de datos propuesto (verificar tipos contra `information_schema` al construir)

Dos niveles: el **catálogo** (qué conectores existen, global) y la **conexión por cuenta**
(qué tiene activado cada cliente, con sus credenciales). Patrón análogo a
`submodules` ↔ `subscription_items` que ya existe en el proyecto.

```
connector                                  (NUEVO — catálogo global, sin account_id)
  id                 uuid pk
  slug               text unique     -- 'catcher' | 'lastapp' | 'glovo' | ...
  name               text
  category           text  CHECK in ('pos','delivery_platform','logistics','payments',
                                     'reservations','loyalty','reports','other')
  connection_type    text  CHECK in ('oauth','credentials','request')
  managed_by         text  CHECK in ('client','superadmin','either')
  direction          text  CHECK in ('inbound','outbound','bidirectional')  -- lee / publica / ambos
  description        text
  logo_url           text NULL
  config_schema      jsonb NULL  -- qué campos pide (p.ej. credenciales) para render dinámico
  is_available       boolean     -- visible en el Marketplace
  created_at / updated_at

account_connector                          (NUEVO — la conexión de UNA cuenta)
  id                 uuid pk
  account_id         uuid  (tenancy + RLS)
  connector_id       uuid  → FK connector(id)
  status             text  CHECK in ('available','requested','connecting','connected',
                                     'paused','error')
  scope              text  CHECK in ('account','brand','location')  -- alcance de la conexión
  brand_id           uuid NULL   -- si scope='brand'
  location_id        uuid NULL   -- si scope='location'
  credentials_ref    text NULL   -- REFERENCIA a credenciales cifradas (NUNCA en claro aquí)
  external_account_id text NULL  -- id de la cuenta en el proveedor (p.ej. locationId Catcher)
  last_sync_at       timestamptz NULL
  last_error         text NULL
  requested_by       uuid NULL   -- quién la solicitó (para flujo 'request')
  requested_at       timestamptz NULL
  connected_by       uuid NULL
  connected_at       timestamptz NULL
  is_active          boolean
  archived_at        timestamptz NULL
  created_at / updated_at / created_by / created_by_name
  UNIQUE (account_id, connector_id, scope, brand_id, location_id)
```

> **Credenciales — regla de seguridad innegociable:** los `appId`/`appSecret`/tokens
> NUNCA se guardan en claro en `account_connector` ni en el repo. Van cifrados (Supabase
> Vault o secret de Edge Function), y la tabla solo guarda una **referencia**
> (`credentials_ref`). Esto enlaza con la deuda de seguridad ya abierta (guard `auth.uid()`
> / escrituras service_role).

---

## 5. Pantallas (fiel al sistema de diseño de Kitchen / Folvy)

1. **Tus integraciones** — las conectadas de la cuenta, en tarjetas con estado (verde
   activa / ámbar solicitada / rojo error), toggle activar·pausar, último sync, y acceso a
   configuración. Igual que el "Tus integraciones" de Last.
2. **Marketplace** — catálogo de conectores `is_available`, filtrable por categoría
   (Ventas/POS, Delivery, Logística, Pagos, Reservas, Fidelidad, Reportes). Cada tile:
   logo, nombre, descripción, nº de instalaciones (opcional, social proof), y botón
   contextual según `connection_type`:
   - `oauth` → **"Conectar"** (lanza el flujo OAuth).
   - `credentials` → **"Configurar"** (formulario dinámico desde `config_schema`).
   - `request` → **"Solicitar"** (pasa a estado `requested`).
3. **Detalle / configuración de un conector** — formulario dinámico (de `config_schema`),
   selección de alcance (cuenta / marca / local) y multi-localización, estado y log de
   errores, botón desconectar.
4. **Bandeja de solicitudes (superadmin)** — para `managed_by='superadmin'` o `'either'`:
   las solicitudes `requested` que el superadmin debe atender.

Lenguaje: hero cálido, tarjetas claras, color de estado único, honestidad (estado real de
la conexión, último sync, errores visibles — no ocultar fallos).

---

## 6. Catcher como PRIMER conector real (API confirmada el 02/06)

La integración de Catcher valida el modelo. Datos reales de su API (sandbox
`staging-api.catcher.es`, doc pública leída):

- **`connection_type = 'credentials'`**, **`managed_by = 'either'`** (Julio o el cliente
  meten `appId`/`appSecret`), **`category = 'logistics'`**, **`direction = 'bidirectional'`**
  (lee coste de reparto + puede publicar pedidos con `Order Create`).
- **Auth:** `POST /auth/v1/authorize` con `appId`/`appSecret`/`grant_type=client_secret`
  → token de 24 h, cacheable (NO pedir uno nuevo hasta `exp`).
- **El dato que desbloquea el reparto propio:** el **`Webhook - Orders`** que Catcher envía
  en cada cambio de estado trae, en `courier`, **`transportPrice`** (coste real del
  reparto, p.ej. "3.90") + `transportType`. Y `Get Order Detail` → bloque `payment`
  (`presetPrice`, `matchedPrice`, `pitcherDeliveryPrice`). **Ese `transportPrice` es el
  coste real por pedido que faltaba para cerrar el margen de reparto propio.**
- **Llave de cruce con ventas:** `externalId` (nuestro id interno) viaja en el webhook →
  enlaza el reparto con la venta de `sale` (igual que `external_ref`). Cruce resuelto.
- **`locationId`** de Catcher ↔ `external_account_id` del `account_connector`.
- **Estados del pedido** (`stacking→matching→matched→picking→in_picking_location→
  in_delivery→finish→canceled`) → el coste se consolida en `finish`.

**Construcción de Catcher (cuando lleguen credenciales), como frente propio:**
1. Edge Function `catcher-webhook` (recibe `Webhook - Orders`, guarda `transportPrice`).
2. Tabla de costes de reparto (o columna en `sale`: `own_courier_cost_real`) enlazada por
   `externalId`.
3. Cruce con `sale` → alimenta la RPC `menu_item_economics` para cerrar `own_delivery` REAL.
4. (Visión, NO ahora) `Order Create`: Folvy publica pedidos a Catcher → orquestación de
   reparto desde Folvy. Frente futuro, enorme, fuera de alcance actual.

---

## 7. Encaje con lo que YA existe (no reinventar)

- **Last.app** se modela retroactivamente como un `connector` (`slug='lastapp'`,
  `category='pos'`/`delivery_platform`, `direction='inbound'`, ya conectado para Llorente29).
  El webhook actual es su implementación.
- **Catcher** = primer conector nuevo (§6).
- **Glovo/Uber/JustEat** = conectores `delivery_platform` (hoy se deducen del pago en Last;
  a futuro, conexión directa para extraer descuentos/comisiones — enlaza con Economía de
  Plataformas Capa B/C).
- **HubRise** = candidato a conector multi-POS (en exploración por email).
- **submodules / subscription_items**: patrón de catálogo↔suscripción ya existente en el
  proyecto; el par `connector`↔`account_connector` lo imita.

---

## 8. Plan de construcción por fases (cerrar bien, una a una)

- **I1 — Catálogo + modelo.** Tablas `connector` + `account_connector` + RLS + tipos +
  services. Sembrar el catálogo con los conectores conocidos (lastapp, catcher, glovo…).
- **I2 — Pantallas.** "Tus integraciones" + "Marketplace" por categorías + detalle.
  Botón contextual por `connection_type`. Bandeja de solicitudes del superadmin.
- **I3 — Conector Catcher real** (cuando lleguen credenciales): Edge Function
  `catcher-webhook`, captura de `transportPrice`, cruce por `externalId`. **Medible:** un
  reparto de prueba en sandbox entra con su coste real y cruza con su venta.
- **I4 — Flujo OAuth genérico** (para conectores `oauth` self-service). Posterior.
- **I5 — Visión:** `Order Create` (publicar reparto a Catcher), conexión directa a
  plataformas para descuentos (Economía Capa B/C). Lejano.

Cada fase: diseño aprobado → BBDD (transaccional, revisable) → service → UI → build verde
→ verificación. Cero deuda colgando entre fases.

---

## 9. Decisiones abiertas (cerrar antes de I1)

- **D1 — Alcance de la conexión por defecto:** ¿`account`, `brand` o `location`? Catcher
  tiene `locationId` por local → sugiere `location`. Confirmar con el resto.
- **D2 — Cifrado de credenciales:** ¿Supabase Vault o secret de Edge Function? Define
  `credentials_ref`. (Enlaza con la deuda de seguridad service_role / guard `auth.uid()`.)
- **D3 — Rol del cliente final:** ¿qué puede hacer un admin de cuenta vs un manager? ¿Solo
  el admin conecta integraciones? (Probable: solo admin de cuenta + superadmin.)
- **D4 — Catálogo sembrado o dinámico:** ¿`connector` se siembra a mano (como submodules
  hoy) o se gestiona desde un panel de superadmin? (Empezar sembrado; panel después.)

---

*Documento vivo. Al aprobar, versionar en `docs/` y referenciar en `CONTEXTO_CLAUDE.md`.
Construcción: I1 primero. La integración real de Catcher (I3) arranca cuando lleguen las
credenciales `appId`/`appSecret`. Antes de tocar esquema, verificar estado real vía
`information_schema`.*
