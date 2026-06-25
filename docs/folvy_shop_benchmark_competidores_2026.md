# Folvy Shop — Benchmark de competidores (jun 2026)

> Fase **BENCHMARK** del ritual (RECON→BENCHMARK→DISEÑO→MEDIR). Datos verificados con
> fuentes públicas de 2026, NO de memoria. Companion de `docs/folvy_tienda_propia_estudio.md`
> (que conserva las decisiones de diseño ya cerradas). Aquí solo: el mercado real y
> dónde Folvy puede golear sin venderse un empate.
>
> Regla aplicada: no afirmo "nadie lo tiene" sin auditarlo. Cuando algo es paridad
> (no diferenciador) lo declaro como tal.

---

## 0. Resumen ejecutivo (lo que importa)

El mercado de "tienda online sin comisiones" está **maduro y saturado**, tanto en EE.UU.
(Olo, ChowNow, Owner.com) como en España (Lymon, Umappi, pidopago, Glop, DISH/Makro,
Square, y GloriaFood —que **cierra en octubre de 2026**). Todos resuelven lo mismo:
escaparate de marca + carrito + pago + reparto + algo de marketing, a cambio de cuota
fija en vez de 20-30 % de comisión.

**Folvy NO debe competir en "tener un escaparate barato": ahí pierde** (DISH de Makro
y Square lo regalan; Umappi cobra una cuota que cubres con 3 pedidos al mes). El único
sitio donde Folvy golea de verdad es el que **ningún competidor toca**:

1. **La verdad del margen real por plato × canal** (escandallo al céntimo + economía de
   plataforma reconciliada desde la factura, ponderada por el mix realmente vendido).
2. **El bucle cerrado**: el pedido de la Shop descuenta inventario teórico → alimenta el
   AvT → dispara compras (MRP II). Nadie más cierra venta↔stock↔coste↔compras.
3. **Agnóstico de TPV** (la Shop es un adaptador más sobre la ingesta canónica; no obliga
   a cambiar de sistema).

Lo demás (escaparate, app, reparto, loyalty) es **paridad obligatoria**: hay que tenerlo
a la altura del mercado, pero no se vende como victoria.

---

## 1. El mapa del mercado 2026

### A) Pesos pesados EE.UU. (referencia de producto, no compiten en ES hoy)

| Plataforma | Modelo de cobro | Qué ofrece | Fuerte | Débil |
|---|---|---|---|---|
| **Olo** | ~1.000 $/mes + ~3.000 $/mes de despliegue (enterprise) | Online ordering + pagos + delivery + catering + loyalty + marketing, 400+ integraciones, multi-local/ghost kitchen | Infraestructura enterprise, 700 marcas, ecosistema | Caro; solo cadenas grandes; no es para un SMB |
| **ChowNow** | 199-328 $/mes (3 planes) + 2,95 % + 0,29 $/transacción; 6-7 % en pickup de marketplace; 15 % self-delivery | Web + **app de marca** con SEO, marketplace propio, discovery network, email/SMS, loyalty, agregación 1ª+3ª parte, 20+ TPV, protección de fraude | 22.000 restaurantes; "**Profit Protector**" sube precios en canales de descubrimiento para compensar fees | US-only; sube de precio en renovaciones; UI a veces confusa |
| **Owner.com** | 249 $ (+5 % al cliente) / 499 $ plano; +299 $/local; ~7 $ reparto agregado | "Sistema de crecimiento por IA": web+SEO+marketing automáticos, app de marca, loyalty, Stripe | IA de marketing/SEO real; onboarding en días | **Sin API**; poca personalización (renuncias a control); 5 % al cliente también en pickup |

### B) Europa / global (sí operan en España)

| Plataforma | Modelo | Qué ofrece | Notas |
|---|---|---|---|
| **Flipdish** (unicornio IE) | €49-79/mes por tramo + hardware/setup; histórico **7 % + 0,50 £/pedido** | Web+app de marca white-label, KDS, TPV, kioscos, **red de reparto (Uber Direct, Stuart)**, marketing/loyalty con IA | En 15 países incl. España; el más completo de los DTC europeos; <2 % de cuota en UK (hay hueco) |
| **SIDES** (DE) | Cuota; 0 % comisión | Tienda online + app, cupones/puntos, **Google Food Ordering**, zonas de reparto | Presencia ES |
| **GloriaFood** | Gratis (botón embebido) | Pedidos online gratis, app de marca, web builder | **CIERRA en octubre 2026** (cierre de Oracle) → oleada de restaurantes huérfanos buscando alternativa |

### C) España — campo local de "tienda sin comisiones" (competencia directa por precio)

| Plataforma | Modelo | Gancho |
|---|---|---|
| **Lymon** | Cuota, 0 % comisión | Reparto propio o Stuart/Cabify, **tracking por WhatsApp**, BD propia, integra TPV |
| **Umappi** (ES+LatAm) | Cuota fija ("la cubres con 3 pedidos/mes") | Web+app, **multi-restaurante desde un panel**, reparto última milla en 50 ciudades |
| **pidopago** | 0 %, sin coste por pedido | Bizum/Stripe/local, **VeriFactu nativo** (factura con QR a la AEAT) |
| **Glop** | Módulo del TPV Glop | Tienda online 0 %, agrega Glovo/JustEat/Uber, **VeriFactu** |
| **DISH by Makro/METRO** | Web **gratis**, 0 % | Web en segundos, Google ordering, DISH POS |
| **Square** | Plan gratis / 59 €/mes Plus | Ventas en línea sin cuota ni comisión, integra agregadores, kiosko |
| **CoverManager** | Reservas sin comisión | Motor de reservas 24/7; **reserva cruzada entre locales del grupo** (interesante para multi-local) |

### D) Especialistas en ghost kitchen / marcas virtuales (los que más se parecen a Folvy)

| Plataforma | Multimarca | Carrito cruzado | Margen real | Bucle a stock/coste |
|---|---|---|---|---|
| **Zuppler** (US) | Sí (hasta 4 marcas) | **SÍ — "multi-brand supercart"** (varios menús en 1 pedido) | No | No |
| **Tabski** (US) | Sí (aislamiento por marca) | Página por marca (no un carrito único) | No | No (reporting por marca, no escandallo) |
| **Lunchbox / Sauce** (US) | Sí | App única con descubrimiento cruzado | No | No |

> **Consecuencia honesta:** el **carrito cruzado multimarca con una entrega** que teníamos
> como diferenciador estrella **NO es único** — Zuppler lo hace en EE.UU. Sigue siendo
> ventaja real **frente a Glovo/Uber** (que obligan a 1 pedido = 1 marca) y frente a TODO
> el campo español (ninguno lo tiene). Pero NO se vende como goleada mundial. El moat de
> Folvy no es el carrito: es el **margen real + el bucle cerrado** que ninguno de estos
> tiene.

---

## 2. Movimientos recientes que cambian el tablero (2026)

- **Olo lanza "Olo Network" / Olo App** (anunciado mar-2026, sale este año): una **app
  agregadora propia, comisión-cero**, con cientos de marcas y datos de cliente a nivel de
  red. Es exactamente el "marketplace de partners" que Folvy **aparcó**. Olo lo hace
  porque ya tiene 40 M de consumidores en su login único. *Lectura:* el marketplace
  comisión-cero puede volverse estándar; vigilar como posible integración, no como clon.
- **ChowNow Marketplace + Discovery Network**: ChowNow también empuja su propio marketplace
  comisión-cero. Mismo movimiento que Olo. El DTC puro está virando a "DTC + red".
- **Uber Eats subió comisiones en marzo 2026** (hasta 30 % efectivo con Uber One): refuerza
  el argumento de venta del canal directo justo ahora.
- **GloriaFood cierra (oct-2026)**: hay un censo de restaurantes huérfanos migrando. Alternativas
  que se están comiendo ese hueco: Fleksa (0 %, free tier), Flipdish, ChowNow, Restolabs.
- **VeriFactu obligatorio**: pidopago y Glop lo usan como gancho comercial en España. Folvy
  ya tiene la deuda de numeración fiscal propia en curso — convertirla en feature de venta.

---

## 3. La mesa de juego: lo que TODOS dan (paridad obligatoria)

Para no quedar por debajo, la Shop de Folvy necesita, al nivel del mercado:

- Escaparate web responsive con la marca del cliente (logo, colores, fotos, multi-idioma).
- Carrito con modificadores y combos, y checkout sin fricción.
- Pasarela de pago (Stripe/Bizum) + pago en local.
- 0 % de comisión sobre el pedido directo (cuota fija).
- Pedido directo a cocina/TPV con la carta y el stock sincronizados.
- Reparto: propio + integración de última milla (Uber Direct/Stuart/Cabify).
- Notificaciones de estado al cliente (WhatsApp es el estándar de facto en ES).
- BD de clientes 100 % del restaurante + email/SMS + cupones/loyalty.
- VeriFactu (gancho local).

Esto **no diferencia**; es el precio de entrada. Folvy lo cubre casi todo de raíz
(ingesta canónica, KDS, marca por cuenta, descuentos), salvo lo que se declara en §5.

---

## 4. Dónde Folvy GOLEA (los ejes reales, defendibles)

1. **Verdad del margen real por plato × canal — ÚNICO.**
   Ninguno de los benchmarkeados conoce tu coste real. ChowNow "Profit Protector" y los
   gestores de ofertas suben precios para tapar fees, pero **no parten de tu escandallo ni
   reconcilian la factura de plataforma**. Folvy enseña, por cada pedido de la Shop, el
   **margen real** (no el PVP), ponderado por el mix vendido. Esto no lo hace nadie.

2. **Bucle cerrado Shop → KDS + stock + AvT + MRP II — ÚNICO en su profundidad.**
   En todos los DTC el pedido llega a cocina y ahí muere. En Folvy, el pedido de la Shop
   (`external_source='folvy_shop'`) **descuenta inventario teórico, alimenta el AvT
   (teórico vs real) y dispara la previsión de compras**. Es la diferencia entre "tener una
   tienda" y "tener una fábrica (MRP II) con tienda". Olo/ChowNow/Owner/Flipdish no llegan a
   inventario perpetuo + AvT.

3. **Agnóstico de TPV / un adaptador más.**
   ChowNow/Owner/Flipdish empujan SU stack. Folvy mete la Shop como un adaptador sobre la
   ingesta canónica, sin obligar a cambiar de TPV. El cliente no migra; suma.

4. **Guardarraíl de margen en la promoción (Ley Ómnibus + margen real).**
   Simulador "esta oferta te deja en pérdidas en estos platos" usando el coste real. Pleez
   hace promos por canal pero sin tu escandallo; ningún DTC simula margen.

5. **Carrito cruzado multimarca con una entrega — ventaja regional.**
   Paridad con Zuppler (US), pero **goleada frente a Glovo/Uber y frente a todo el campo
   español**. Para un operador dark-kitchen de Madrid, hoy no existe.

6. **Para TODA la hostelería, no solo delivery.**
   Sala/barra/terraza como canales de primera (cuando entre el TPV propio), mismo modelo de
   override de precio por canal. Los DTC son delivery-first; Square/Toast tienen TPV pero su
   online ordering es básico.

---

## 5. Dónde Folvy está EN PARIDAD o por DEBAJO (deuda-0, sin maquillar)

| Área | Estado del mercado | Folvy hoy | Veredicto |
|---|---|---|---|
| **App móvil nativa** (iOS/Android en stores) | ChowNow/Owner/Flipdish la dan llave en mano | PWA instalable | 🟠 **Por debajo** — declarar deuda; la PWA vale para MVP, la app nativa es fase posterior |
| **SEO / Google Business / discovery** | Owner.com y ChowNow lo hacen con IA + equipo | No existe capa de marketing/SEO | 🔴 **Por debajo** — frente grande; sin tráfico, la Shop no vende |
| **Marketing automation / CRM / loyalty maduro** | Pulido en ChowNow/Owner/Flipdish | Diseñado como fase S4 | 🟠 Por debajo hasta S4 |
| **Red de reparto integrada** | Todos (Uber Direct/Stuart) | Fase S2 | 🟡 Paridad-a-construir |
| **Pasarela + protección de fraude/chargeback** | Estándar | Stripe Connect MVP | 🟡 Paridad-a-construir |
| **Carrito cruzado multimarca** | Zuppler lo tiene (US) | Diseñado | 🟢 Paridad global / goleada regional (no venderlo como único) |
| **Marca, equipo, distribución comercial** | Miles de clientes + equipos de marketing | 1-2 clientes | 🔴 Realidad: Folvy gana por producto, no por distribución todavía |

---

## 6. Verdades incómodas (riesgos)

- **Una Shop sin tráfico no vende.** El valor de Folvy NO es traer clientes nuevos (eso lo
  hacen los agregadores y el SEO de Owner/ChowNow). Es **convertir a directo a los que ya
  tienes + saber el margen**. Vender la Shop como "fuente de demanda" sería deshonesto.
- **El precio del escaparate tiende a cero** (DISH gratis, Square gratis, Umappi 3
  pedidos/mes). Folvy no puede cobrar por "tener tienda"; cobra por el **cerebro** (margen +
  bucle + MRP). El posicionamiento es ese o no hay sitio.
- **Los marketplaces comisión-cero (Olo Network, ChowNow Marketplace)** podrían volverse
  estándar y restar sentido al "directo puro". Mantener la decisión de aparcar el marketplace
  B2C de Folvy, pero **vigilar** para integrarse, no para clonar.
- **Madurez del campo español**: Lymon/Umappi/pidopago ya hacen el "directo sin comisión"
  bien y barato. Folvy entra tarde al escaparate; entra **único** al margen + bucle.

---

## 7. Recomendación: el wedge y las fases

**No construir "otra tienda online sin comisiones"** (océano rojo en ES, misma lógica con
la que decidimos no clonar a Pleez). Construir **la única tienda que conoce tu margen real
y cierra el bucle a stock/AvT/MRP, agnóstica de TPV.**

**MVP (medible, deuda-0):**
- Storefront de marca + carrito con modificadores/combos + Stripe + **pickup**.
- Pedido entra por la ingesta canónica (`external_source='folvy_shop'`) → KDS + stock + AvT.
- **Diferenciador visible desde el día 1:** por cada pedido de la Shop, el dueño ve el
  **margen real** (no el PVP) — lo que ningún competidor enseña.
- **Métrica de cierre:** un pedido real de la Shop descuenta inventario teórico y aparece
  en el AvT del periodo. Si eso ocurre, golea; si solo "entra a cocina", empata con el campo.

**Fases (manteniendo las ya cerradas en el estudio):**
- S1 pickup → S2 reparto (Uber Direct) → S3 margen+promos con guardarraíl (Ley Ómnibus) →
  S4 CRM/loyalty → S5 multimarca/dominio/SEO/app nativa.

**Antes de DISEÑO (próxima fase del ritual):**
- RECON contra BD+repo de lo que ya existe (`menu_item`/`menu_item_override`, ingesta
  canónica, `sales_channel` type para un canal `folvy_shop`, Stripe).
- Decidir 3-4 cosas: dominio (subdominio por marca vs hub), identidad del canal en
  `sales_channel`, alcance del MVP (pickup-only), y si el margen real se enseña al
  operador (panel) o también se insinúa al cliente (no).
