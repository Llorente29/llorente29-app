# Folvy — Módulo de Control de Inventario y Merma (AvT), de inicio a fin

**Frente 5 del guión vivo · plan maestro del módulo completo**
Estado: mapa para aprobación. No se ha tocado código.
RECON + benchmark completos (R365, MarketMan, tspoon dump real 510 inventarios, código propio).
Decisión de Julio: construir el módulo entero, de inicio a fin.

---

## 0. Qué es el módulo, en una frase

El sistema que responde a la única pregunta que un dueño no puede contestar hoy sin
pelearse con Excel: **"vendí esto, debería haber gastado tanto de cada ingrediente —
¿cuánto gasté de verdad, y dónde se evaporó el dinero?"** — y que lo responde con tan
poco esfuerzo diario que el gestor lo usa de verdad, no una vez al trimestre.

La ecuación del control, idéntica en todos los líderes:

```
stock_esperado = stock_inicial + compras − consumo_teórico ± traspasos − merma_registrada
variación €    = (stock_esperado − conteo_real) × coste
variación inexplicada = variación total − merma_registrada_con_causa
```

La variación inexplicada en € es la fuga: sobre-porcionado, robo, caducidad no
registrada, error de escandallo. Ordenada por €, es el mapa del dinero perdido.

---

## 1. El módulo entero, capa por capa

Marcado: ✅ construido · 🟡 media pieza · 🔴 falta. El módulo está completo cuando
todas están en ✅.

| Capa | Qué es | Estado hoy |
|------|--------|-----------|
| 1.1 Ledger perpetuo | `stock_movement` append-only (recepción +, consumo −) | ✅ vivo (1.820 consumo, 80 recepción) |
| 1.2 Áreas de almacén | "hogar" de cada artículo, orden shelf-to-sheet | ✅ |
| 1.3 Conteo | crear → contar a ciegas → cerrar (variación vs tolerancia ABC) | ✅ |
| 1.4 Aprobación → ajuste | escribe el ajuste al ledger, corrige el stock real | ✅ |
| 1.5 Vista de variación del conteo | esperado vs real, cantidad/%/€, ABC, motivo obligatorio fuera de tolerancia | ✅ (en `InventoryCountSheet`) |
| 2 Consumo teórico | ventas × escandallo → ledger, por ingrediente, € desc | ✅ vivo |
| **A Inventario de apertura** | anclar el stock inicial real (hoy el ledger parte de 0 el 5-jun) | 🔴 |
| **B Registro de merma proactivo** | "tiré 2 kg de tomate caducado" → baja stock + causa, en el momento | 🔴 |
| **C AvT de periodo** | cruza consumo + variación de conteos + merma → total/explicada/inexplicada, % ventas, señal | 🔴 |
| **D Umbral configurable** | señal verde/ámbar/rojo, default 5%, bajable según objetivos | 🔴 |
| **E Cycle counting IA** | la IA elige qué contar (valor×rotación×riesgo×anomalía) y quién (no su zona); la merma se comunica y explica sola | 🔴 |
| **F Traspasos entre locales** | stock que sale de un local y entra en otro (Master → local) | 🔴 (evaluable, ver §4) |

Lo construido (1.x + 2) es la mitad inferior de la torre y está sano. Lo que falta
(A–F) es lo que convierte "tengo conteos" en "controlo la merma".

---

## 2. Orden de construcción (por capas, deuda 0)

Cada tramo es completo y usable solo; el siguiente enchufa sin reescribir (principio
MRP II). El SQL del AvT se diseña desde el primer día para **sumar merma de todas las
fuentes**, de modo que añadir el waste log no obligue a reescribir el cruce.

### T1 — Inventario de apertura (capa A)
El AvT necesita un punto de partida. Hoy el ledger arranca de 0 el 5-jun, así que el
primer AvT saldría raro. Solución limpia, sin tabla nueva: **el primer conteo "full"
de un local actúa de apertura** — su `counted_qty` ancla el stock inicial real, y de
ahí en adelante el ledger lleva la cuenta. Es el patrón de los líderes ("el conteo
final del periodo anterior es el inicial del siguiente"). Tramo pequeño: marcar/usar
el primer conteo full como línea base y que el AvT cuente desde ahí.
**Golea**: nace anclado a la realidad, no a un cero ficticio.

### T2 — Registro de merma proactivo (capa B)
Tabla de merma (espejo del `40_mermas` de tspoon, mejorada) + pantalla rápida para
registrar en el momento: artículo, cantidad en unidad de uso amigable, causa (catálogo
ya definido: caducado, mal estado, consumo personal, regalo, rotura, error…), foto
opcional. Escribe al ledger como salida tipo `merma` con su causa. Es la **segunda
fuente de merma explicada** (la primera es el `reason_code` del conteo).
**Golea**: registro en gestos de cocina (no gramos), con foto, en segundos.

### T3 — AvT de periodo + umbral configurable (capas C + D)
El corazón. Pestaña nueva "AvT / Merma" (ver §3 por qué pestaña y no dentro de
Consumo). Para un rango y un local, cruza:
- consumo teórico del periodo,
- variación real de los conteos del periodo,
- merma registrada con causa (conteo + waste log),
→ por ingrediente y en €, ordenado por €: **variación total**, **merma explicada**,
**variación inexplicada**. Cabecera: variación total €, % eficiencia, **variación como
% de ventas** (métrica estrella de MarketMan; las ventas ya están integradas), y señal
verde/ámbar/rojo contra **umbral configurable por cuenta (default 5%, bajable)**.
**Iguala** el techo de R365/MarketMan/tspoon. Con mejor base (ledger perpetuo vs su snapshot).

### T4 — Cycle counting IA (capa E)
El gol. Dos motores:
- **Qué/quién contar**: cada día la IA propone 3-5 artículos por valor (ABC) × rotación
  (los que más € mueven en consumo) × riesgo (alta variación histórica) × anomalía
  (consumo raro vs patrón), y rota el responsable evitando que cuente su propia zona.
- **La merma se explica sola**: al cerrar la mini-cuenta, la IA comunica la diferencia
  y propone causa probable ("Aceite: faltan 4 L = 28 €. Probable sobre-porcionado o
  merma no registrada"). IA propone, humano decide.
**Golea**: nadie en hostelería cierra este bucle. Convierte el AvT de "2 inventarios
pesados" a "un goteo diario sin esfuerzo".

### T5 — Traspasos entre locales (capa F) — solo si se confirma necesidad (§4)
Movimiento que sale de un local y entra en otro (Master → FoodInt Alcalá, como en el
dump). Cierra la ecuación multi-local del AvT.

---

## 3. Por qué pestaña "AvT / Merma" separada de Consumo (decisión 1, razonada)

Por los tres ángulos que pediste:
- **Sistema**: Consumo es dato puro, legible desde el minuto cero sin inventario. El AvT
  es un cruce que necesita conteo real. Mezclarlos obliga a Consumo a tener dos estados
  según haya o no conteo — frágil. Separados, cada uno una responsabilidad.
- **Usuario (cocinero)**: el que cuenta no necesita el AvT; necesita la hoja de conteo y
  el registro de merma. No le añades ruido.
- **Gestor**: el AvT es *su* pantalla, la que abre para ver dónde se fuga el dinero. Con
  entidad propia es encontrable y seria, no escondida al pie de otra. Los líderes lo
  tratan como informe de primer nivel.
- Consumo mantiene su frase de cierre, ahora enlazando: "…la diferencia es tu merma →
  **ver AvT**".

---

## 4. Decisión abierta única: Traspasos (capa F)

Es la única pieza que no doy por segura sin tu palabra, porque depende de cómo opera
Llorente29:
- tspoon los tiene (`Master → FoodInt Alcalá`). Si Llorente29 mueve stock entre locales
  (p. ej. una cocina central "Master" que surte a los puntos), el AvT **necesita**
  traspasos o la variación saldrá inflada (lo que salió de Master "desaparece" sin causa).
- Si cada local compra y consume lo suyo sin moverse stock entre ellos, los traspasos
  son ruido y se dejan fuera (deuda declarada, no bloqueante).

**Pregunta concreta**: ¿en Llorente29 se mueve género físicamente de un local a otro
(o de una central a los locales), o cada local es estanco en compras/consumo?

Si sí → T5 entra en el módulo. Si no → se declara como capa futura y el módulo se
considera completo en T4.

---

## 5. Lo que NO toca este módulo (contención)

- No toca el motor de coste ni el de consumo (sanos).
- No toca recepción (frente A, en paralelo — validándose con albaranes).
- No añade selector manual de local (sale del contexto operativo — deuda activa conocida).
- No limpia catálogo (frente 2, al final de pruebas).
- Antes de CADA tramo: RECON puntual de las tablas/funciones que toca + benchmark de la
  pieza concreta. Este mapa es el destino, no el diseño detallado de cada capa.

---

## 6. Validación

El AvT no se puede probar con datos reales hasta ejecutar **el primer conteo real** en
Folvy Interno (hoy hay 0). T1 lo fuerza, y es además la prueba en vivo del onboarding
real: un cliente nuevo arranca exactamente así. La cobertura parcial de escandallos no
es defecto del laboratorio, es el estado normal de arranque — el módulo debe funcionar
en él y se irá completando solo.
