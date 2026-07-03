# Folvy — Motor de Crecimiento (CRM + Ofertas a plataforma + Agente)

> Documento de diseño NORTE. Pinta el destino completo para que nada de lo que se
> construya choque con él. La construcción es por fases pequeñas y usables (principio
> MRP II: cada capa completa y usable sola, diseñada para enlazar sin reescribir).
> Fecha de diseño: 02/07/2026. Rival directo a batir: **Cheerfy**. Sala/reservas
> (tipo CoverManager) queda como frente siguiente, enchufable al mismo `customer`.

---

## 0. Posicionamiento

El "CRM" de Folvy no es un CRM más: es el **Motor de Crecimiento**, la cara que el
cliente ve para **ganar dinero**, alimentada por todo lo que el resto de Folvy ya sabe
(escandallo al céntimo, consumo/stock real, economía reconciliada). Es el resultado
comercial de todo el sistema.

Objetivo declarado por Julio (02/07): **el motor de crecimiento más potente del
mercado, completo, lo más automatizado posible.** No se escatima esfuerzo.

Principio rector: **legal-por-diseño (RGPD + Ómnibus), consciente del margen real al
céntimo, y con la IA haciendo el trabajo de marketing.** El agente no es un extra: es
la forma principal de usar el motor para quien no tiene equipo de marketing (la mayoría
de la hostelería).

Folvy es para **toda la hostelería** (sala Y delivery, no uno u otro).

---

## 1. Benchmark (hecho a fondo, 02/07)

### CRM/loyalty España y Europa
- **Cheerfy** (rival directo): plataforma de 5 productos (Loyalty/Shop/Pay/Kiosk/Places),
  casi el mismo mapa que Folvy. Loyalty = perfil 360º, captación multicanal (Wi-Fi/QR/
  Web/Instagram, **incl. packaging del delivery** — confirma el puente de consentimiento),
  tarjeta Wallet sin app, **cashback** como producto estrella (los clientes dicen que
  funciona mejor que las recompensas porque es más fácil de entender), Wi-Fi como sensor
  de presencia, email/SMS marketing. Precios: 99€/marca setup + fijo + variable, 8,90€/100
  SMS, 2,90€/1000 emails.
  **Debilidades**: (a) cliente ideal = "5+ locales con responsable de marketing" (deja
  fuera al hostelero pequeño); (b) solo 15-30% de visitantes se registran; (c) es una
  **capa que se INTEGRA** con TPV/pagos/Wi-Fi ajenos (cada integración = punto de fallo);
  (d) **CIEGO AL COSTE**: hace cashback pero no sabe el coste real por plato (no tiene
  escandallo).
- **CoverManager** (líder ES, 16k+ restaurantes): CRM centrado en **RESERVAS/sala**.
  Ficha de comensal, etiquetado manual, encuestas post-reserva. Reseñas reales:
  "anticuado y caro, interfaz poco intuitiva". Terreno = sala/ocio nocturno, ciego en
  delivery y margen. → No es el rival del motor; es referencia para el frente sala/reservas.
- **Numiqa**: CRM conectado al TPV (Revo/Ágora); reconoce al cliente recurrente en mesa.

### Loyalty enterprise US
- **Punchh (PAR)**: rey de la **segmentación a escala** (CDP con loyalty encima; targetea
  por frecuencia, gasto, ítem preferido, ubicación, docenas de atributos). Debilidad:
  enterprise, caro, rígido fuera de plantillas, requiere equipo de marketing.
- **Paytronix**: "single pane of glass" (loyalty+pedidos+CRM+gift cards+pagos). Fuerte en
  convertir transacción en campaña. Debilidad: caro, implementación larga, dashboard torpe.
- **Thanx**: card-linked sin fricción (sin escaneo), **"recompensas conscientes del
  margen"** — PERO estimado, sin escandallo. Editor self-service de recompensas.
  Enrolamiento automático en el checkout digital.

### Agentes de IA en marketing/CRM (estado del arte 2026)
- **Toast IQ Grow** (mayo 2026): "Marketing Agent" que construye audiencias y automatiza
  campañas (email/SMS/redes/publicidad), 499$/mes **+ un Marketing Success Manager
  humano**. Ni Toast confía el marketing 100% a la máquina: le pone un humano al lado
  **porque su agente no conoce el margen real**.
- **Salesforce Agentforce** / **HubSpot Breeze** / **Creatio**: CRMs agénticos. Clave
  arquitectónica de Agentforce que validamos: la IA está **embebida a nivel de
  arquitectura; cada objeto/relación/workflow es nativamente accesible al agente**, en vez
  de una capa encima de un CRM tradicional. = nuestro Golpe 2.
- **Lección crítica del mercado** (CMO de Salesforce, y múltiples fuentes): *"un agente es
  solo tan inteligente como la información a la que accede; arregla los cimientos antes de
  añadir la inteligencia"*. La IA agéntica es solo tan buena como la infraestructura de
  datos debajo. → **por eso el agente se construye AL FINAL, sobre las patas 1-3.**

### Ofertas a plataforma
- **Pleez** (trypleez.com, Madrid/Lisboa/UK): push a 1 clic a Uber Eats/Glovo/Deliveroo,
  guardarraíles de margen, triggers por reglas (demanda baja, franja valle, stock/prep),
  control ciudad/tienda, **competitor tracking** (precios/promos de competidores en la
  zona, vía scraping), reporting unificado. Ambición: "líder global en gestión de datos de
  restaurantes aplicada al delivery". Dato de mercado: hacia 2027, 1 de cada 3€ de
  restauración será por plataformas.
  **Debilidad**: sus guardarraíles se basan en lo que Pleez **estima** (precio, comisión),
  **no en el escandallo real ni en el stock/consumo real**. Opera por credenciales+scraping
  (frágil).

---

## 2. Los diferenciadores (dónde Folvy golea, no empata)

**Golpe 1 — Margen real al céntimo (corazón).** Toda oferta/recompensa se diseña con el
escandallo delante: coste real + margen tras la recompensa, ponderado por el mix realmente
vendido. Guardarraíl que avisa si una oferta mete en pérdidas. Cheerfy/Thanx/Pleez lo
estiman; Folvy lo sabe (motor de coste server-side ya existe: `recipe_item.computed_cost`).

**Golpe 2 — Sistema unificado (arquitectura).** El motor **nace dentro**: consume `sale`,
`sale_line`, `recipe_item` (escandallo), Shop, stock/consumo y economía reconciliada
directamente. Sin integraciones externas ni puntos de fallo. Cheerfy/Pleez son capas que
se integran con sistemas ajenos.

**Golpe 3 — Agente-marketer (cerebro, columna vertebral).** El agente de Folvy (marco
multi-agente ya construido, "actúa no informa") gana una entrada de crecimiento. Propone
segmentos, campañas, ofertas conscientes del margen Y legales (Ómnibus), momentos de envío,
y las ejecuta con confirmación (contrato B3: propose → tarjeta → commit). Abre el motor al
hostelero **sin equipo de marketing** — justo el que Cheerfy deja fuera y al que Toast
tiene que ponerle un humano a 499$/mes.

**Golpe 4 — Ciclo cerrado oferta→resultado→margen real.** Nadie (Pleez/Cheerfy/Toast) te
dice si una promo **de verdad ganó dinero**: te dicen "vendió más". Folvy, con la economía
reconciliada (coste real de platos vendidos + comisión + transporte), cierra el bucle y
dice el **margen real** de cada campaña. Folvy ya tiene las dos mitades; solo hay que
unirlas.

---

## 3. La visión: un solo Motor de Crecimiento, no módulos sueltos

CRM (fidelizar clientes propios) y Pleez (ofertas a plataforma) **no son dos módulos**:
son el mismo objetivo — *vender más defendiendo el margen* — y usan las mismas piezas
(escandallo, motor de ofertas Ómnibus-aware, competitor tracking, agente). La única
diferencia es **hacia dónde apunta la oferta**: cliente propio o plataforma.

→ Se construye como **un motor con varias salidas**, no dos motores. (Doctrina MRP II:
capa única, varios consumidores.) Evita duplicar motor de ofertas + guardarraíl + agente.

```
                 ┌─────────────────────────────────────────────┐
                 │   FUENTES (ya en Folvy)                      │
                 │   escandallo · stock/consumo · ventas ·      │
                 │   economía reconciliada · Shop · clientes    │
                 └───────────────────────┬─────────────────────┘
                                         │
                 ┌───────────────────────▼─────────────────────┐
                 │   MOTOR DE OFERTAS (único)                   │
                 │   Ómnibus-aware · margen real · art. espejo  │
                 └───────┬───────────────────────────┬─────────┘
                         │                            │
          ┌──────────────▼─────────┐      ┌───────────▼──────────────┐
          │  SALIDA 1: CRM         │      │  SALIDA 2: Plataforma     │
          │  ofertas/cashback a    │      │  (estilo Pleez)           │
          │  segmentos de clientes │      │  push a Glovo/Uber/JE +   │
          │  propios (Shop/sala)   │      │  competitor tracking      │
          └────────────────────────┘      └───────────────────────────┘
                         ▲                            ▲
                         └───────────┬────────────────┘
                        ┌────────────▼─────────────┐
                        │  AGENTE (columna vert.)   │
                        │  propone → confirma →     │
                        │  ejecuta (contrato B3)    │
                        └───────────────────────────┘
```

---

## 4. Las tres patas + el motor de ofertas

### Pata 1 — BI agregado (legal ya, sin consentimiento)
Estadística interna, no contacto → legal sin consentimiento. Se puede construir ya.
- Panel del canal propio (Shop) aislado del ruido de plataforma (hoy el dashboard mezcla).
- BI geográfico agregado de TODOS los pedidos (zonas calientes, horas pico por marca).

### Pata 2 — Identidad + consentimiento (el muro legal, la base de TODO)
Aquí nace el cliente real, agnóstico al canal, aislado por cuenta (multi-tenant estricto +
RLS). Es la pieza que habilita todo el agente (sin cliente unificado, el agente decide a
ciegas — lección del benchmark).

Modelo de datos (verificado contra BBDD viva el 02/07; tierra virgen, nada que reutilizar;
`sale` hoy tiene `customer_name/phone/note`, `delivery_address`, **sin email**):

- **`customer`**: `id`, `account_id` (RLS), `phone` (null), `email` (null), `name` (null),
  `first_seen_at`, `last_seen_at`, `first_brand_id`, `first_location_id`.
  Dedup por índice único `(account_id, phone)` y `(account_id, email)` cuando no son null.
  Regla: al menos teléfono O email. **El cliente puede nacer solo con teléfono** (para
  WhatsApp); email requerido solo para email marketing.
- **`customer_consent`**: estado vigente — `marketing_email` (bool), `marketing_sms`,
  `marketing_whatsapp` (**granular por canal**, RGPD), `updated_at`.
- **`customer_consent_log`**: prueba legal **inmutable, append-only** — `action`
  (granted/revoked), `channel`, `source` (shop/qr_bag/web/mesa/wifi), `terms_version`,
  `ts`, `ip`/`user_agent` opcionales.
- **Enlace `sale.customer_id`** (uuid null, FK): pedido de Shop con consentimiento
  vincula/crea `customer`; pedido de plataforma (Glovo/Uber) deja NULL → alimenta solo BI
  (Pata 1). **REGLA DE HIERRO**: dato de plataforma nunca entra como cliente contactable;
  el cliente contactable solo nace del consentimiento (RGPD, multas hasta 20M€).

Arranque de la Pata 2: **capturar email + consentimiento en el checkout del Shop** (hoy el
email ni se captura). `place_shop_order` crea/vincula `customer` + escribe
`customer_consent_log`. Es el punto de entrada legal y natural (canal propio).

### Pata 3 — Motor de ofertas + loyalty + marketing (sobre los consentidos)
- **Motor de ofertas ÚNICO** (compartido por CRM y plataforma):
  - **Ómnibus-aware**: registra histórico de precios; el precio de referencia legal es el
    mínimo de los últimos 30 días; valida que una promo cumple; planifica campañas con la
    antelación legal. Alcance elegido por Julio (05/06): **gestionar y planificar**.
  - **Técnica del artículo espejo**: `menu_item` duplicado que comparte `recipe_item_id`
    (mismo escandallo/coste) con historial de precios independiente, activado/desactivado
    por campaña, para ofertar legal sin arrastrar el histórico de 30 días del original.
  - **Margen real**: cada oferta muestra coste real + margen tras descuento; guardarraíl si
    entra en pérdidas. `computed_cost IS NULL` = "coste no disponible" (anti-invención; hay
    ~107 menu_item con escandallo vacío).
- **Loyalty — cashback como mecánica insignia** (el mercado ES lo confirma), CON el
  guardarraíl de margen real que Cheerfy no tiene. Modular: puntos/estampas/tiers
  enchufables como alternativas.
- **Ofertas dirigidas**: cupones, 2x1, happy hour — con margen real visible al crear.
- **Marketing automation**: triggers (cumpleaños, X días sin pedir, 3ª compra…) por
  email/WhatsApp/SMS. ⚠️ DEUDA: la "capa de comunicación multicanal" que se daba por
  diseñada NO existe (solo Resend + 2 Edge Functions de propósito único, sin dispatcher a
  comensal, sin outbox, sin tabla de canales/plantillas). Hay que construir el envío a
  comensal como parte de este motor.
- **Tarjeta Wallet** (Apple/Google) sin app — igualar a Cheerfy (requisito de entrada).

### Salida 2 — Ofertas a plataforma (estilo Pleez, dentro del mismo motor)
- Push de ofertas a Glovo/Uber/JustEat (a través del conector/adaptador existente).
- Triggers por reglas (demanda baja, franja valle) **+ lo que Pleez NO tiene**: stock/
  consumo real (lanzar oferta de lo que sobra y caduca) y margen real por plato×plataforma.
- **Competitor tracking** (scraping) — ver §6 Deuda.

---

## 5. El agente como columna vertebral

- El motor tiene **dos modos**: **manual** (el hostelero crea ofertas/campañas a mano, con
  el guardarraíl de margen visible) y **copiloto** (el agente propone y ejecuta con
  confirmación — modo principal para quien no tiene marketer).
- El agente **se construye AL FINAL** (tras patas 1-3), porque necesita el cuerpo debajo
  para actuar de verdad y no ser decorativo. PERO **las patas 1-3 se diseñan desde ya con
  acciones limpias operables por el agente** (contrato B3: `propose_ai_action` → tarjeta
  `FolvyAIActionModal` → `commit_ai_action`). Todo objeto/acción del motor debe ser
  invocable tanto por humano como por agente (patrón Agentforce).
- El agente hereda automáticamente las protecciones: propone ofertas **legales (Ómnibus) y
  rentables (margen real)**, y sabe cuándo necesita crear un artículo espejo. Eso no lo
  tiene nadie (ni Cheerfy, ni Pleez, ni Toast IQ, ni Punchh).

---

## 6. Decisiones abiertas / Deuda declarada

- **Scraping para competitor tracking** (aceptado por Julio 02/07 como la vía para sacar
  datos): funciona pero es **frágil y legalmente gris** (las plataformas cambian HTML,
  bloquean IPs, sus términos lo prohíben; Pleez vive con ese riesgo). Se construye como
  **fase posterior, AISLADA**, para que si se rompe o hay que migrarlo a una vía más limpia
  (API de plataforma, proveedor de datos) no arrastre al núcleo del motor. Deuda con riesgo
  declarada conscientemente.
- **Capa de comunicación a comensal**: inexistente hoy. Construir outbox + canales
  (email/WhatsApp/SMS) + plantillas como parte del motor (Pata 3).
- **Sala/reservas (tipo CoverManager)**: frente siguiente. Se enchufa al `customer`
  agnóstico sin reescribir.
- **Wallet pass** (Apple/Google): requisito de entrada; fase de Pata 3.

---

## 7. Orden de construcción (por fases pequeñas y usables)

1. **Pata 2 — identidad + consentimiento** (base legal). Arrancar por el checkout del Shop:
   capturar email + consentimiento, crear/vincular `customer`, escribir `consent_log`.
2. **Pata 1 — BI agregado** (rápida, legal, en paralelo).
3. **Motor de ofertas + loyalty cashback** (con Ómnibus + margen real + artículo espejo) —
   salida CRM primero.
4. **Capa de comunicación a comensal** (outbox multicanal) — habilita marketing automation.
5. **Salida 2 — ofertas a plataforma** (estilo Pleez, sin competitor tracking aún).
6. **Competitor tracking** (scraping, aislado) — fase con riesgo declarado.
7. **Agente-marketer** (columna vertebral, sobre todo lo anterior).
8. **Sala/reservas** (frente siguiente, enchufado al `customer`).

Cada fase: RECON contra BBDD+repo → benchmark del mejor → diseño aprobado → construir →
medir. Deuda 0: si una fase genera deuda, se rediseña hasta deuda 0; solo se declara si es
imposible arreglar sin romper el resto (con su disparador).
