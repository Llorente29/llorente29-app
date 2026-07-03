# Folvy — Motor de Crecimiento (CRM · Cliente · Ofertas · Agente) — NORTE v2

> Reemplaza al NORTE v1. El v1 trató el cliente registrado como "frente aparte";
> el v2 lo pone en el CENTRO, que es lo que hace potente al CRM. No hay nada en
> producción salvo la captura de consentimiento (Paso 1a) — así que se construye
> a lo grande, hacia la forma potente de cada pieza, sin versiones mínimas. Cada
> paso importante se verifica contra los mejores para que no se cuele nada.
> Fecha: 02/07/2026.

---

## 0. Objetivo (palabras de Julio)

El CRM más potente del mercado, el más automatizado que seamos capaces, la joya
comercial de Folvy: la cara que el cliente ve para GANAR DINERO. Golear a Cheerfy
y a todos. No dejar nada atrás, no rehuir problemas, no medias tintas. Verificar
lo que haga falta, pero a lo grande, y siempre contrastando con los mejores.

Es el resultado de todo el resto de Folvy: consume escandallo, stock/consumo,
economía reconciliada, ventas y Shop. Es para TODA la hostelería (sala Y delivery).

---

## 1. Los cuatro golpes (diferenciadores que nadie más tiene)

1. **Margen real al céntimo.** Toda recompensa/oferta se diseña con el escandallo
   delante. Cheerfy/Thanx/Pleez lo estiman; Folvy lo sabe. Evita el error nº1 del
   mercado: repartir descuentos que erosionan margen sin cambiar comportamiento.
2. **Sistema unificado.** Nace dentro (ventas, cocina, escandallo, Shop, stock,
   economía). Cero integraciones frágiles. Cheerfy/Pleez son capas que se integran.
3. **Agente-marketer (columna vertebral).** Propone y ejecuta (con confirmación,
   contrato B3) segmentos, campañas, win-backs y ofertas legales+rentables. Abre el
   CRM al hostelero sin equipo de marketing (el que Cheerfy deja fuera y Toast cubre
   con un humano a 499$/mes).
4. **Ciclo cerrado oferta→resultado→margen real.** Único que dice si una campaña
   ganó dinero de verdad (no "vendió más"), con coste real + comisión + transporte.

---

## 2. Benchmark (hecho a fondo)

- **Cheerfy** (rival directo ES): 5 productos ≈ mapa de Folvy. Cashback estrella,
  captación multicanal (incl. QR en packaging), Wallet sin app. Débil: cliente ideal
  "5+ locales con responsable de marketing", 15-30% de registro, capa que se integra,
  CIEGO AL COSTE.
- **CoverManager** (líder ES): CRM de RESERVAS/sala. "Anticuado y caro". → referencia
  para el frente sala/reservas (siguiente).
- **Punchh/Paytronix/Thanx** (US): segmentación a escala, single-pane, card-linked.
  Thanx: "recompensas conscientes del margen" pero ESTIMADO + Winback con ML. Caros,
  enterprise, rígidos.
- **Toast IQ Grow**: Marketing Agent + humano (499$/mes) porque su agente no ve margen.
- **Pleez**: push de ofertas a Glovo/Uber/Deliveroo, guardarraíles, competitor tracking
  (scraping). Débil: estima, no ve escandallo ni stock.
- **Área de cliente (estado del arte 2026)**: imprescindibles = perfil guardado +
  histórico + **reorder a un toque** + guest checkout siempre disponible + progreso
  visual hacia recompensas (Starbucks/Dunkin) + win-back automático nombrando el plato
  favorito (3-5x más clics; 12-18% de re-pedido en la 1ª campaña).

---

## 3. Arquitectura: un motor, muchas salidas

```
   FUENTES (ya en Folvy): escandallo · stock/consumo · ventas · economía
   reconciliada · Shop · clientes
                         │
   ┌─────────────────────▼─────────────────────────────────────┐
   │  NÚCLEO DEL CLIENTE                                        │
   │  identidad · consentimiento · cuenta/login · perfil 360º  │
   │  histórico · comportamiento                               │
   └───────┬───────────────────────────────────┬──────────────┘
           │                                    │
   ┌────────▼─────────┐              ┌───────────▼──────────────┐
   │ MOTOR DE OFERTAS │              │ CICLO POST-PEDIDO         │
   │ Ómnibus-aware +  │              │ confirmación · encuesta/  │
   │ margen real +    │              │ valoración con recompensa │
   │ artículo espejo  │              │ · win-back automático     │
   └───┬──────────┬───┘              └───────────────────────────┘
       │          │
  SALIDA 1     SALIDA 2
  CRM propio   Plataforma (Pleez): push Glovo/Uber/JE + competitor tracking
  (área de
   cliente,
   cashback,
   cupones)
           ▲                                    ▲
           └──────────────┬─────────────────────┘
              AGENTE (columna vertebral): propone→confirma→ejecuta (B3)
```

---

## 4. El frente del cliente (el corazón, forma completa)

### 4.1 Identidad + consentimiento — HECHO (Paso 1a, en producción)
`customer` + `customer_consent` + `customer_consent_log` + `sale.customer_id`.
Captura email+consentimiento en el checkout del Shop. RLS por cuenta. Nombre
comercial "Foodint" corregido. DEUDA declarada: texto legal a validar por abogado;
datos fiscales completos en el aviso.

### 4.2 Login / cuenta de cliente — SIGUIENTE (base de todo lo potente)
- **Código mágico** (email + código de un solo uso), SIN contraseña.
- **Sesión persistente**: tras el primer acceso, token de larga duración → el cliente
  NO vuelve a pedir código salvo logout / caducidad / dispositivo nuevo. (Modelo Uber/
  Glovo.)
- **Guest checkout SIEMPRE disponible**: registrarse es la vía habitual, no obligatoria.
- Requiere la capa de **envío de email a comensal** (hoy inexistente) → se construye
  aquí (la necesitan también win-back y marketing).

### 4.3 Área "Mi cuenta"
- **Histórico de pedidos** + **"volver a pedir" a un toque** (reorder).
- **Mis bonos/cupones**: visibles en el área y en el checkout con botón "Aplicar"
  (patrón Europastry — sin copiar código).
- **Mi progreso** hacia recompensas (barra visual tipo Starbucks).
- Mis datos, mis direcciones.

### 4.4 Comportamiento + personalización
- Rastro: qué visita, tiempo, **carritos abandonados** (con su consentimiento de
  analítica/cookies). Alimenta segmentación y ofertas personalizadas.

### 4.5 Ciclo post-pedido
- Confirmación (ya existe: página veraz + /seguir).
- **Encuesta/valoración con recompensa** tras entregar (sube respuesta + reseñas + es
  gancho de re-enganche; recompensa margen-consciente).
- **Win-back automático**: al cliente que no vuelve, mensaje con su plato favorito +
  incentivo (con margen). ML/reglas.

---

## 5. Motor de ofertas (único, compartido)
- **Ómnibus-aware** (precio de referencia 30 días, gestionar+planificar campañas).
- **Técnica del artículo espejo** (menu_item duplicado, mismo recipe_item_id, historial
  de precio independiente).
- **Margen real** en cada oferta (guardarraíl; `computed_cost IS NULL` = no disponible).
- Mecánicas: **cashback insignia** + cupones + 2x1 + happy hour + bienvenida. Modular.
- Aplicación 100% SERVER-SIDE en `place_shop_order` (el front nunca fija precio).
- **Salida 2 (plataforma, Pleez)**: push a Glovo/Uber/JE + triggers por reglas +
  ventaja Folvy (stock/consumo real + margen real por plato×plataforma).

---

## 6. Agente (columna vertebral)
- Dos modos: **manual** (guardarraíl de margen visible) y **copiloto** (propone y
  ejecuta con confirmación — modo principal para quien no tiene marketer).
- Se construye AL FINAL (necesita el cuerpo debajo), PERO cada pieza de 4-5 se diseña
  desde ya con **acciones limpias operables por el agente** (contrato B3). Patrón
  Agentforce: cada objeto/acción invocable por humano y por agente.

---

## 7. Deuda declarada / decisiones abiertas
- **Envío de email a comensal**: inexistente. Se construye en 4.2 (login).
- **Consentimiento de cookies/analítica**: necesario para el rastro de comportamiento
  (4.4). Su propia pieza legal.
- **Scraping (competitor tracking)**: aceptado como vía; frágil y legalmente gris. Fase
  aislada, para no arrastrar el núcleo si se rompe/migra.
- **Texto de privacidad**: validar por abogado antes de definitivo.
- **Sala/reservas (tipo CoverManager)**: frente siguiente, enchufa al `customer`.

---

## 8. Plan de construcción (orden técnico; cada bloque en su forma POTENTE)

> Regla: los pasos existen por ingeniería (no puedes tener "mis cupones en el área"
> sin área de cliente), NO para aplazar potencia. Cada paso llega a su forma buena.
> Verificación contra los mejores en cada paso importante.

- **F1 · Identidad + consentimiento** — HECHO (1a en producción).
- **F2 · Login de cliente + envío de email a comensal** — código mágico + sesión
  persistente + guest checkout. Capa de email a comensal (Resend). Base de todo.
- **F3 · Motor de ofertas + cupones (con margen real)** — cashback/cupones/bienvenida,
  Ómnibus-aware, artículo espejo, aplicación server-side. Cupón de bienvenida 5€/mín 20€
  nace aquí en su forma buena (visible en área + checkout con botón, patrón Europastry).
- **F4 · Área "Mi cuenta"** — histórico + reorder + mis bonos + progreso visual.
- **F5 · Ciclo post-pedido** — encuesta/valoración con recompensa + win-back automático.
- **F6 · Comportamiento + personalización** — rastro (carritos abandonados, etc.) +
  consentimiento de analítica + ofertas personalizadas.
- **F7 · BI agregado** — canal propio + geográfico agregado (legal, puede adelantarse).
- **F8 · Salida 2 (plataforma, Pleez)** — push de ofertas + (fase aislada) competitor
  tracking por scraping.
- **F9 · Agente-marketer** — pilota segmentos, campañas, win-backs, ofertas con margen.
- **F10 · Sala/reservas** — frente siguiente, enchufa al `customer`.

Cada fase: RECON (BBDD+repo) → benchmark del mejor → diseño aprobado → construir →
verificar en vivo. Deuda 0 = hacer lo potente, entero, bien (no hacer menos).
