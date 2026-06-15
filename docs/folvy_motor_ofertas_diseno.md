# Folvy — Motor de ofertas por plataforma (clima + deporte + rentabilidad)
### Documento de diseño + benchmark · v1 · 16/06/2026

> **Estado:** diseño + auditoría de mercado. **DECISIÓN tomada: NO construir el clon.** Se conserva solo el guardarraíl de margen como extensión de la economía de plataformas. Documento para no redescubrir esto ni rediseñar un clon en una sesión futura.
>
> **Origen:** petición de Julio (16/06): configurar ofertas/anuncios por plataforma (cada una las suyas), teniendo en cuenta el clima, los eventos deportivos de mayor entidad y, sobre todo, una **rentabilidad-objetivo basada en precios** como restricción dura. Es la **§10 ("gestión de ofertas hacia plataformas")** que `folvy_economia_plataformas_diseno.md` dejó como visión.

---

## 1. Lo que se pidió

Un motor que:
1. Configure **ofertas por plataforma** (Glovo / Uber Eats / JustEat tienen cada una SUS ofertas).
2. Tenga en cuenta el **clima** (lluvia/frío → sube la demanda de delivery) y los **eventos deportivos de gran entidad** (partidos top → picos de demanda).
3. Respete una **rentabilidad-objetivo basada en precios** como restricción dura: nunca proponer una oferta que rompa el margen mínimo; el motor calcula el **descuento máximo permitido** por coste + comisión + reparto.
4. "IA propone oferta, humano decide". Cumplir **Ley Ómnibus** (precio sobre el mínimo de 30 días; técnica de artículo-espejo ya prevista).

---

## 2. Benchmark honesto (regla deuda-0: no afirmar "nadie lo tiene" sin auditar)

**NO es territorio virgen.** El motor que se pidió ya existe en piezas, y uno de los actores es un vecino de Madrid con financiación.

| Actor | Qué hace en este terreno | Fecha del dato |
|---|---|---|
| **Pleez** (trypleez.com, Madrid, fundada 2020, Buenavista Equity) | **Casi exactamente lo pedido.** Plataforma de IA que prueba, lanza y optimiza promociones en delivery: **push de 1 clic a Uber Eats / Glovo / Deliveroo**, **guardarraíles para proteger márgenes** y evitar el sobre-descuento, disparadores por reglas (caída de demanda, franjas valle, restricciones de stock/preparación), ROI de promo por **canal / SKU / hora**, **competitor & price tracker**, y combina datos privados del restaurante con fuentes públicas **incluidos eventos deportivos y meteorología**. | 16/06/2026 |
| **Sapaad** | Promotion Engine **protegido por margen y multicanal** (sala/QR/online/agregador): impacto en margen en tiempo real, recomendaciones para maximizar ROI sin sangrar margen. | 11/2025 |
| **Nory** | OS agéntico que usa **clima + eventos locales** para predecir demanda y proteger márgenes (foco: forecasting → labour/inventario, no generación de ofertas). | 04/2026 |
| **AlixPartners** (consultora) | Best-practice declarada: las promociones necesitan **guardarraíles de margen**, objetivos claros y elasticidad local; el descuento continuo comprime margen. | 03/2026 |

**Conclusión:** ni el guardarraíl de margen (Sapaad), ni el clima/eventos (Nory), ni el conjunto completo (Pleez) son novedad. **No se vende como goleada.**

### Cómo opera Pleez (inferencia razonada, no su código)
- **"Push de 1 clic" + auto-ejecución:** sus condiciones exigen al usuario **entregar usuario y contraseña de sus cuentas de delivery**. Una API oficial de partner NO necesita la contraseña (usa tokens/OAuth). Que la pidan en crudo indica que, en buena parte, **operan el back-office del comerciante en su nombre** (automatización del panel Uber Eats Manager / Glovo Manager; donde haya API de promos la usarán, donde no, automatizan el panel). Implica carga de seguridad/RGPD, fricción con los términos de la plataforma, y mantenimiento perpetuo (2FA, CAPTCHA, anti-bot, baneos).
- **"Saber lo que vende la competencia":** no saben lo que venden de verdad; saben **lo que publican**. Glovo/Uber/Deliveroo son escaparates públicos por zona (carta, precios, promos activas) → **scraping a escala por radio de reparto**, más benchmark agregado de su propia base de clientes, más proxies de visibilidad (ranking, badge "más pedido", nº de reseñas). No es un foso; es esfuerzo + zona gris de términos.

---

## 3. Dónde Folvy SÍ podría diferenciarse (a verificar, no se regala)

La diferencia no estaría en "tener" el motor, sino en la **verdad del margen** que lo alimenta:
- Pleez/Sapaad calculan margen sobre **datos de plataforma/POS** (precio − comisión).
- Folvy lo calcularía sobre **escandallo al céntimo + economía REAL del canal reconciliada de la factura** (Capa A comisión por canal×reparto + Capa B transporte/promo reales + Capa C varianza), **ponderado por el mix realmente vendido**, y **agnóstico de TPV** (canónico: Last/Otter/HubRise, no atado a un POS).

Es un margen **más profundo y verdadero**. Es el ÚNICO ángulo donde Folvy podría batir a Pleez — y hay que medirlo contra él antes de cantarlo.

---

## 4. El diseño (si algún día se construye el guardarraíl)

Construye sobre las 3 capas de `folvy_economia_plataformas_diseno.md` (no reinventa):

1. **Guardarraíl de margen (el núcleo, lo único que vale la pena).** Para cada tipo de oferta (% / 2x1 / precio fijo / combo / envío gratis), el motor calcula el **descuento máximo que respeta el margen objetivo** por plato y **por plataforma** (la comisión difiere por canal → el descuento máximo difiere). Ej.: "este 2x1 te deja 18 % en Uber pero entra en pérdidas en Glovo en estos 3 platos". Reutiliza `menu_item_economics` + `brand_channel_rate`.
2. **Por plataforma.** La oferta vive en `brand × canal`; cada plataforma sus ofertas y su **cofinanciación** (quién paga el descuento), ya modelada en la Capa B (`promo_producto` / `oferta_flash`).
3. **Cerebro de contexto (clima + deporte) — fase 2, secundario (existe en Nory/Pleez).** Sugiere *cuándo y qué* ofertar: clima vía **Open-Meteo** (gratis, sin clave); partidos top vía una API de calendario deportivo. Matiz: mal tiempo no siempre = descuento (sube la demanda → a veces conviene NO descontar y empujar margen alto). IA propone, humano decide.

**Restricciones honestas:**
- **Publicar la oferta** en cada plataforma está gated por su API. **Otter no tiene API de promociones** (confirmado 16/06). Glovo/Uber/JustEat van cada una por su lado. Pleez lo resuelve vía credenciales/automatización del panel — vía que Folvy NO quiere asumir (riesgo + términos + mantenimiento). Folvy puede ser el **cerebro** (qué oferta, cuándo, con qué descuento que protege margen); el push no es su pelea.
- **Ley Ómnibus** (precio sobre mínimo 30 días) vía la técnica de artículo-espejo ya prevista.

---

## 5. DECISIÓN (16/06/2026)

1. **NO construir el clon del motor de ofertas.** Es un océano rojo con un incumbente local financiado (Pleez) años por delante en justo esto. Clonarlo = pelear su partido en su campo.
2. **Aparcar** clima + deporte + auto-push como territorio Pleez.
3. **Conservar solo el guardarraíl de margen real por plato×plataforma**, que de todos modos sale de la Capa A/C de economía de plataformas (EP1/EP3). Es lo único que Pleez no calcula bien (no tiene escandallo).
4. **Tratar a Pleez como a Otter/HubRise:** posible integración/coexistencia, no enemigo a clonar. Relato: "Pleez decide qué oferta y la empuja; **Folvy es quien sabe si esa oferta te hace perder dinero de verdad**".

**Disparador del guardarraíl:** cerrar EP1/EP2 de economía de plataformas (su cimiento).

---

## 6. Preguntas abiertas (si se retoma el guardarraíl)
- **Margen objetivo:** ¿por cuenta, por marca, o por plato? (define el guardarraíl).
- **Cofinanciación:** ¿quién paga la promo en cada plataforma? (entra en el cálculo del margen).
- ¿Integración con Pleez (leer sus ofertas activas para validarlas contra el margen real) en vez de construir?

---

*Documento vivo. Referenciado en `CONTEXTO_CLAUDE.md` §1 y en `folvy_guion_vivo.md` (Decisión 16/06).*
