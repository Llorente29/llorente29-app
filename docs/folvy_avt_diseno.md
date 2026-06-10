# Folvy — Diseño del AvT (Análisis de Variación Teórica)

**Frente 5 del guión vivo · Inventario perpetuo capa 2 · cerrar el bucle merma**
Estado: diseño para aprobación. No se ha tocado código.
RECON + benchmark completos (R365, MarketMan, tspoon dump real, código propio).

---

## 1. Qué es y por qué lidera

El AvT responde a la pregunta que ningún dueño de restaurante puede contestar hoy
sin pelearse con una hoja de cálculo: **"vendí esto, debería haber gastado tanto de
cada ingrediente — ¿cuánto gasté de verdad, y dónde se evaporó el dinero?"**

La ecuación, idéntica en todos los líderes:

```
stock_esperado = stock_inicial + compras − consumo_teórico ± traspasos − merma_con_causa
variación      = stock_esperado − conteo_real
```

Lo que la variación NO explicada vale en € es la fuga: sobre-porcionado, robo,
caducidad no registrada, error de escandallo. Ordenado por €, es el mapa del dinero
perdido.

---

## 2. Lo que YA está construido (no se reconstruye)

Verificado contra BBDD y repo:

- **Consumo teórico vivo** — `stock_movement` tipo `consumo` (1.820 mov, −78.719 en
  Folvy Interno). Ventas × escandallo. Pestaña Consumo ya lo muestra por ingrediente,
  ordenado por €.
- **Recepciones en el ledger** — tipo `recepcion` (80 mov, +426.834).
- **Conteo capa 1 completo** — crear → contar a ciegas → cerrar → aprobar. Ya calcula
  por línea: `system_qty` (esperado), `counted_qty` (real), `variance_qty`,
  `variance_pct`, `variance_value` (€), `abc_class`, `within_tolerance`, `reason_code`.
- **Catálogo de causas** — merma/caducado/rotura/robo_desconocido/error_escandallo/
  error_recepcion/traspaso/otro.

**Conclusión clave:** el ledger ya acumula `+recepción − consumo teórico`. El stock
esperado del AvT **ya vive en el saldo**. El conteo capa 1 ya lo cruza contra el conteo
real por línea. **El AvT no hay que calcularlo desde cero: hay que CERRAR el bucle y
PRESENTARLO como análisis de periodo, no solo como variación de un conteo puntual.**

---

## 3. Benchmark — dónde igualamos y dónde goleamos

### Techo del AvT clásico (R365 + MarketMan)
- Ecuación inicial+compras−consumo−merma, ingrediente a ingrediente, en cantidad Y €.
- Métricas: uso teórico, uso real, variación, **variación inexplicada**, merma,
  **% eficiencia**, todo como **% de ventas**.
- Objetivo de variación ~1%. Recomiendan tracking diario.
- **Exigen DOS conteos completos** del periodo (uno abre, otro cierra).

### tspoon (dump real, 510 inventarios)
- Línea de inventario = AvT por ingrediente ya montado: `quantity` vs `quantityExpected`
  → `quantityDeviation`; `cost` vs `costExpected`; `percent`/`percentCost`; `listLots`;
  `listCalculator` (factores formato anidado); por **área**; merma con causa en tabla
  aparte; traspasos src→dst.
- **Calcula el teórico a fecha de inventario (snapshot), no ledger perpetuo continuo.**

### Veredicto
Replicar el AvT clásico = **EMPATE**. Folvy ya tiene mejor base (ledger perpetuo
append-only vs snapshot). Donde se golea de verdad:

| # | Gol | Nadie lo tiene |
|---|-----|----------------|
| 1 | **Cycle counting con IA**: la IA elige QUÉ contar (valor×riesgo×rotación×anomalía) y QUIÉN cuenta (no su zona → mata el sesgo). Convierte el AvT de "2 inventarios pesados" a "3-5 productos/día". | R365/MarketMan exigen 2 conteos completos; tspoon conteos por área a mano; WMS usan ABC fijo, no IA. |
| 2 | **La merma se comunica y se explica sola** (IA propone causa probable, humano decide). | Todos presentan el AvT como informe pasivo que el dueño debe ir a mirar. |
| 3 | **Variación inexplicada** cruzada con merma-con-causa ya registrada. | tspoon tiene merma con causa pero no la cruza con la variación del conteo. |
| 4 | **Dos relojes de coste** (coste de venta congelado / coste de ingrediente vivo) ya resueltos → AvT honesto sin recalcular el pasado. | Ventaja de arquitectura propia. |

---

## 4. El bucle a cerrar — qué falta exactamente

Hoy la variación existe **por conteo puntual** (capa 1). Falta elevarla a **análisis de
periodo** y exponer la merma con su efecto económico. Tres piezas:

### Pieza A — Vista de variación del conteo (rematar lo que ya calcula)
El conteo capa 1 ya calcula todo. Falta verificar que `InventoryCountSheet` al cerrar
**muestre bien**: por ingrediente, esperado vs real, variación en cantidad y €, % ,
clase ABC, dentro/fuera de tolerancia, y el motivo. Ordenado por € de variación (la
fuga más cara arriba). Si ya lo muestra → es solo pulir presentación.

### Pieza B — AvT de periodo (lo nuevo)
Una vista que, para un rango y un local, cruce:
- **consumo teórico del periodo** (lo que ya muestra la pestaña Consumo),
- contra la **variación real registrada por los conteos del periodo**,
- y la **merma con causa** ya registrada,
- para producir, por ingrediente y en €: **variación total**, **merma explicada**
  (con causa), y **variación inexplicada** (total − explicada).
- Métricas de cabecera: variación total €, % de eficiencia, variación como % de ventas
  (las de MarketMan), señal verde/ámbar/rojo contra umbral.

### Pieza C — Cycle counting IA (el gol, encima de A y B)
La IA propone cada día una mini-lista de 3-5 artículos a contar:
- **Qué**: prioriza por valor (ABC), rotación (los que más € mueven en consumo),
  riesgo (alta variación histórica), y anomalía (consumo raro vs patrón).
- **Quién**: rota el responsable y evita que alguien cuente siempre su propia zona.
- Al contar, alimenta el mismo motor de conteo (capa 1) → ajuste al ledger → AvT.
- La diferencia se **analiza y comunica sola**: "Aceite: contado 8 L, esperado 12 L →
  faltan 4 L (28 €). Causa probable: sobre-porcionado o merma no registrada."

---

## 5. Orden de construcción propuesto (por capas, deuda 0)

Cada tramo es completo y usable solo; el siguiente se enchufa sin reescribir.

- **T0 — RECON final** *(falta una pieza)*: leer `InventoryCountSheet.tsx` para ver si
  la vista de cierre ya presenta bien la variación (Pieza A). Sin esto no sé si A es
  "pulir" o "construir". **Es el único fichero que me falta.**
- **T1 — Pieza A**: vista de variación del conteo clara y ordenada por €. Probable que
  sea pulido, no construcción.
- **T2 — Pieza B**: AvT de periodo (nueva pestaña o vista). Cruza consumo teórico +
  variaciones de conteos + merma con causa → variación total / explicada / inexplicada,
  con las métricas de cabecera. Aquí se iguala el techo de R365/MarketMan.
- **T3 — Pieza C**: cycle counting IA. El motor de sugerencia (qué/quién) + la
  comunicación proactiva de la diferencia. Aquí se golea.

Validación: el AvT no se puede probar con datos reales hasta que haya **al menos un
conteo real ejecutado** en Folvy Interno (hoy hay 0). T1 obliga a hacer el primer
conteo, que ancla el punto de partida — es además la prueba en vivo del onboarding real.

---

## 6. Decisiones abiertas para Julio

1. **Pieza B — ¿pestaña nueva "AvT / Merma" o se integra en la de Consumo?**
   (La de Consumo ya promete el AvT al pie; podría crecer ahí, o separarse cuando madure.)
2. **Umbral de la señal** verde/ámbar/rojo: ¿fijo (~1% como los líderes) o configurable
   por cuenta?
3. **Cycle counting IA (T3)**: ¿entra en este frente o se declara como sub-frente
   posterior una vez B esté sólido? (B sin C ya iguala a tspoon; C es el gol.)
4. **"% de ventas"** como métrica de cabecera: requiere ventas del periodo del local
   (las tienes). ¿Se incluye desde T2 o se añade después?

---

## 7. Lo que NO toca este frente (contención)

- No toca el motor de coste ni el de consumo (están sanos).
- No toca recepción (frente A, en paralelo).
- No añade selector manual de local (sale del contexto operativo — deuda activa conocida).
- No limpia catálogo (frente 2, al final de pruebas).
