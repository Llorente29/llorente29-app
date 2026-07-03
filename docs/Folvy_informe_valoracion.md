# Folvy — Informe de valoración y coste de construcción

**Preparado para:** Julio Gª Colón, CEO de Folvy
**Fecha:** 2 de julio de 2026
**Objeto:** estimar (a) el valor de venta de Folvy y (b) el coste de encargar su construcción a un tercero.

> **Aviso.** Este documento es un marco de análisis, no una tasación formal ni asesoramiento financiero. Las cifras son rangos basados en benchmarks públicos de mercado de 2026 y en el estado actual del producto; el número final de una operación real lo fija un comprador concreto en un proceso concreto, y debe validarlo un asesor de M&A con comparables de tu vertical y geografía. Importes en euros; los benchmarks originales suelen expresarse en dólares (paridad aproximada al cambio actual).

---

## Resumen ejecutivo

- **Valor de venta hoy (pre-ingresos):** modesto e incierto — del orden de una **cifra baja de seis cifras hasta ~1–2 M€** en una venta de activo, con posibilidad de más solo mediante un proceso competitivo con compradores estratégicos que valoren el motor de coste/margen.
- **Valor de venta con tracción (ARR):** aquí está el salto. Con ingresos recurrentes, Folvy entra en el juego del múltiplo (SaaS vertical, 3x–9x ARR según crecimiento y retención). Con ~1 M€ de ARR, del orden de **4–8 M€**.
- **Coste de encargar la construcción:** **500.000 € – 2 M€+**, según dónde se construya, más **15–25%/año** de mantenimiento.
- **La conclusión que importa:** cuesta más construirlo que lo que se vende pre-ingresos. Eso hace del coste de reconstrucción un **foso** y un **suelo**, pero confirma que el valor grande no lo desbloquea más código, sino **clientes pagando**.

---

## 1. Contexto: estado actual de Folvy

Folvy es una plataforma SaaS multi-tenant para toda la hostelería, con un núcleo diferencial de verdad-de-coste (escandallo reconciliado + economía + inventario) sobre el que se construyen múltiples módulos operativos y de cliente. A la fecha de este informe está **en fase de lanzamiento** (objetivo de producción: septiembre de 2026), con **un cliente laboratorio** (Llorente29 / marca pública Foodint) y **sin ingresos recurrentes significativos todavía**.

Esta condición —producto profundo y funcionando, pero pre-ingresos— es la que determina cómo se valora hoy: no por múltiplo de ingresos (no los hay aún), sino por activo, potencial y valor estratégico.

---

## 2. Valor de venta

### 2.1. Hoy, pre-ingresos: tres lentes

**a) Venta de activo / acqui-hire.** Un comprador paga por el producto funcionando, la IP y el conocimiento del fundador, anclando el precio a lo que le costaría *reconstruirlo* (ver sección 3) más una prima por ahorrar tiempo y riesgo. Es el escenario más probable hoy.

*Rango orientativo:* **cifra baja de seis cifras – ~1,5 M€.** Las ventas pre-ingresos suelen quedar por debajo del esfuerzo invertido: "vale mucho construirlo, poco venderlo sin clientes".

**b) Valoración de ronda de financiación (levantar, no vender).** Un producto funcionando + piloto real + foso diferenciado, en una semilla europea, podría fijar un post-money orientativo de **~1–4 M€**. Matiz importante: es valoración "en papel" por una participación minoritaria, no liquidez para el fundador. Europa cotiza con un descuento del ~15–25% frente a las valoraciones de EE. UU. (donde el rango pre-revenue típico es de 3–8 M$).

**c) Valor estratégico (el premio).** El motor de escandallo/margen es genuinamente único: a un POS, a un competidor de fidelización o a un operador internacional entrando en el mercado le puede salir **más barato comprar que construir** esa capa de verdad-de-coste. Aquí el precio no lo fija una fórmula sino la competencia entre compradores; un proceso que enfrente a compradores estratégicos y financieros suele producir un resultado superior al que pagaría cualquiera en aislamiento. Referencia de tamaño de sector: el rival directo en España ronda los ~6 M$ de ingresos con más de 200 marcas.

### 2.2. Con tracción: el juego del múltiplo

En cuanto Folvy factura de forma recurrente, la valoración pasa a regirse por el múltiplo de ARR. Contexto de mercado 2026 (relevante porque está *blando* por el temor a la disrupción de IA):

| Perfil | Múltiplo orientativo (privado, 2026) |
|---|---|
| Mediana privada general | ~3,8x ARR |
| Rango habitual privado | 3x – 7x ARR |
| SaaS vertical premium (buena retención, Rule of 40) | 7x – 9x ARR |
| Early-stage de alto crecimiento (sobre potencial) | 8x – 15x ARR |

El **SaaS vertical** —como Folvy— cotiza con prima porque la especialización crea defensibilidad y costes de cambio altos.

*Ejemplos ilustrativos:*

| ARR | Múltiplo | Valoración orientativa |
|---|---|---|
| 500 K€ (creciendo bien) | 5x | ~2,5 M€ |
| 1 M€ | 4x–8x | ~4–8 M€ |

**Lectura:** hoy vendes la *opción* sobre ese futuro; la tracción es lo que convierte "modesto" en "varios millones".

---

## 3. Coste de encargar la construcción

Folvy **no es un MVP**. Es lo que el mercado llama una "plataforma de operaciones compleja que reemplaza herramientas fragmentadas" — la categoría más cara. Una sola plataforma de ese tipo se presupuesta habitualmente en 100.000–300.000 $ y 6–12 meses. Folvy reúne del orden de **15–20 sistemas** de ese calibre (escandallo, MRP II, inventario/AvT, KDS, impresión física, integraciones POS/HubRise, pagos marketplace con Stripe Connect, la tienda propia, el CRM, el copiloto de IA, APPCC, personal, reparto, capa multi-tenant, web pública…), cada uno un proyecto de €40–200K por sí mismo.

### Rangos de coste de encargo

| Dónde se construye | Coste orientativo | Notas |
|---|---|---|
| España, equipo senior pequeño y eficiente | **500.000 – 900.000 €** | ~4–6 años-persona de ingeniería senior |
| Agencia de Europa Occidental / EE. UU. de nivel | **1 – 2 M€+** | Tramo alto: motor de coste, MRP II y fiscal (VeriFactu) son trabajo especializado, no CRUD |
| Offshore (India / Sudeste Asiático) | 60–70% menos de coste de ingeniería | Riesgo alto de calidad/coordinación y de *no entender el dominio* de costes de hostelería |

**Mantenimiento posterior:** 15–25% del coste de construcción al año. Para Folvy, del orden de **75.000–200.000 €/año**. En un ciclo de 3 años, el post-lanzamiento puede acercarse o superar al coste original de construcción.

**Total estimado de encargo:** **500.000 € – 2 M€+**, más mantenimiento anual.

---

## 4. La asimetría y su lectura estratégica

El dato central de este informe es la asimetría entre los dos números: **cuesta 500K–2M€ construir Folvy, pero pre-ingresos se vende por menos.** Lejos de ser una mala noticia, es la más relevante:

1. **El coste de reconstrucción es foso y suelo.** Nadie que quiera esta capacidad la va a construir desde cero —por ese precio y ese tiempo— si puede comprarla hecha, probada y con un piloto real detrás. Eso es exactamente lo que eleva el valor estratégico frente al puramente financiero.

2. **Se ha construido por una fracción ínfima de ese coste.** El desarrollo asistido por IA (fundador + herramientas de codificación agénticas) ha colapsado un encargo de 1–2 M€ en algo radicalmente más barato y rápido. En lenguaje de valoración es un **burn multiple excelente**, y en 2026 los compradores premian el crecimiento eficiente en capital frente al que quema dinero. Un producto de esta profundidad, con este foso técnico y este consumo de capital, es un caso raro y atractivo.

3. **Pero el coste de construir no es lo que te pagan.** Un comprador no paga el coste de reconstrucción; paga por el riesgo que le quitas y por los ingresos que ve. El número que mueve la valoración de "modesto" a "varios millones" no es más código: **son clientes pagando.** El activo más valioso que se puede fabricar ahora no es otra funcionalidad, es **ARR**.

---

## 5. Conclusiones y recomendaciones

- **Hoy:** el valor realista de venta es modesto (seis cifras a ~1–2 M€), con opción de más solo vía proceso competitivo con estratégicos. No es el momento óptimo de vender si el objetivo es maximizar.
- **Palanca de valor nº 1:** convertir el piloto en **clientes de pago** y construir ARR. Es lo que multiplica la valoración por el efecto del múltiplo vertical.
- **Palanca de valor nº 2:** cerrar la deuda que sostiene el foso diferencial (enlazar catálogo↔escandallo para que la "verdad de margen" cubra toda la carta, no un tercio) — es lo que hace demostrable y creíble el diferenciador ante un comprador.
- **Si en algún momento se plantea vender o levantar en serio:** contratar a un asesor de M&A con comparables reales del vertical de hostelería y de la geografía; correr un **proceso competitivo** (estratégicos + financieros) es lo que maximiza el precio.

---

### Metodología y fuentes

Elaborado a partir de benchmarks públicos de mercado de 2026 sobre (i) múltiplos de valoración de SaaS privado y vertical, (ii) valoración de compañías pre-ingresos, y (iii) costes de desarrollo de plataformas SaaS complejas y multi-tenant, cruzados con el estado real del producto Folvy y su posición competitiva. Las cifras son rangos orientativos, no una tasación. Cualquier decisión de venta, financiación o inversión debe apoyarse en una valoración profesional independiente.
