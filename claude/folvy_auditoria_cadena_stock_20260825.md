# Auditoría de la cadena de stock — 25/08/2026

**Encargo:** que ningún euro de diferencia sea culpa del código.
**Método:** `pg_get_functiondef` de las 14 funciones de la cadena + cuantificación en la BD viva. La BD manda sobre el repo.
**Resultado:** 3 defectos de motor nuevos, encontrados y corregidos. 1 eslabón sale limpio. El resto de lo que falla es dato, cuantificado.

---

## 1. Veredicto por eslabón

| # | Eslabón | Veredicto | Qué se ha encontrado |
|---|---|---|---|
| E1 | Ingesta | ❌ → ✅ **corregido** | Las anulaciones **no devolvían el stock**: 9 ventas, 95 movimientos, ~74,50 € |
| E2 | Mapeo | ⚠️ dato | 564 líneas sin mapear (7.892 €) · 1.024 mapeadas sin receta (16.101 €) |
| E3 | Consumo | ❌ → ✅ **corregido** | **Los combos sin mapear descontaban CERO**: 331 líneas / 312 ventas / 7.885 € en 30 días |
| E4 | Escandallo | ✅ **sólido** | 0 de 1.758 líneas se saltan. El bug del Arroz Criollo **no está repartido** |
| E5 | Movimiento | ⚠️ | Ledger íntegro, pero **5.289 movimientos con coste unitario negativo** |
| E6 | Caché | ❌ → ✅ **corregido** | Causa raíz aislada: 1 de 11 funciones escribía sin refrescar |
| E7 | Entrada | ⚠️ dato | 19 líneas de recepción con movimiento duplicado · 8 sin coste |
| E8 | Ajuste | ✅ **sólido** | El fix de esta mañana verificado; `apply` sigue cortando en `counted_at` |
| E9 | Informe | ✅ con reserva | El clasificador **no es texto fijo**, va por evidencia. Pero tiene un punto ciego |
| E10 | Vista | ⚠️ | La app lee **siempre la caché, nunca el ledger** |

---

## 2. Los tres defectos de motor (corregidos y verificados)

Migración `20260825T1400_blindaje_stock_consumo.sql`, **aplicada en producción** y verificada con `pg_get_functiondef`.

### D1 · Los combos sin mapear descontaban cero — E3

`generate_sale_consumption` recorría las líneas de producto exigiendo `menu_item_id IS NOT NULL`. Pero **un combo no necesita que su cabecera esté mapeada**: `_sale_line_raw_consumption` lo resuelve por sus hijos `combo_item`, que sí están mapeados y sí tienen escandallo. La cabecera sin mapear hacía que el combo entero se saltara.

Probado línea a línea en la venta `f07a28e6` (19-08): la cabecera `PACK PA 2 (DC)` está sin mapear y devuelve **17 crudos** por sus hijos. El motor la saltaba y esa venta descontó cero.

| | 30 días | Histórico (desde 12-06) |
|---|---|---|
| Líneas de combo saltadas | 331 | 685 |
| Ventas afectadas | 312 | 641 |
| Facturación implicada | 7.885,30 € | 16.428,90 € |
| Crudos que debieron descontarse | 3.010 | — |

**Corrección:** la cabecera entra en el bucle si está mapeada **o** si tiene hijos `combo_item`. Verificado: el bucle ya selecciona `PACK PA 2 (DC)`.

### D2 · Las anulaciones no devolvían el stock — E1

`cancel_sale()` sí revierte. Pero cuando el webhook mueve `sale.order_status` a `cancelled`/`rejected` sin pasar por esa RPC, el consumo se quedaba puesto para siempre. La prueba está en el reparto por camino:

| status | order_status | ventas | con consumo vivo |
|---|---|---|---|
| `cancelled` | `cancelled` | 28 | **0** ← pasaron por `cancel_sale()` |
| `closed` | `cancelled` | 18 | 0 |
| `open` | `cancelled` | 17 | **8** ← fuga |
| `open` | `rejected` | 1 | **1** ← fuga |

9 ventas, 95 movimientos, ~74,50 €. Todas de las últimas 48 h — es un goteo activo, no un residuo.

**Corrección en dos capas:** (a) `generate_sale_consumption` se niega a consumir una venta anulada/rechazada/inactiva y borra lo que hubiera; (b) el trigger de la venta lo llama también en la transición a anulada. Cualquier camino que anule una venta ahora devuelve el stock.

### D3 · Vender no refrescaba la caché de stock — E6 + E10

De las **11 funciones que escriben en `stock_movement`, `generate_sale_consumption` era la única que no llamaba a `recompute_location_stock`.** Las otras diez sí. Y como el consumo por venta es el movimiento más frecuente del sistema, la caché derivaba sin parar: **144 de 716 filas** descuadradas con el ledger.

Esto explica de golpe dos cosas: el stock falso que ve la gente (E10: la app lee siempre `qty_on_hand`, nunca el ledger) y por qué el conteo tenía que dejar de leer esa tabla (fix de esta mañana).

**Corrección:** el motor refresca la caché de todos los artículos que toca — los nuevos y los que tenía antes, para que una anulación también deje la caché bien.

---

## 3. E4 — el eslabón que sale limpio

Era la prioridad 1 del encargo: la hipótesis de que el bug del Arroz Criollo estuviera repartido por el catálogo. **No lo está.**

| Comprobación | Resultado |
|---|---|
| Líneas de escandallo con `_qty_in_base` NULL (se saltan en silencio) | **0 de 1.758** |
| Líneas con `quantity_gross = 0` y `net > 0` | 0 |
| Líneas sin cantidad o con cantidad 0 | 0 |
| Líneas sin unidad | 0 |
| Ciclos de sub-receta | imposibles: trigger `recipe_line_prevent_cycle` activo |
| Sub-recetas sin rendimiento resuelto | 0 de 2 |

Las dos sub-recetas vivas: **Arroz Criollo** (yield declarado 2,223, el del fix #83) y **Pico de Gallo** (sin declarar, pero `_batch_yield_in_base` cae al auto-yield y resuelve 1.420 g = suma de sus líneas, que es lo correcto para una preparación sin merma). Cuando se creen más sub-recetas, el auto-yield seguirá cubriendo el caso 1:1; el yield declarado solo hace falta si hay pérdida en la elaboración.

---

## 4. Lo que falla y es DATO, no sistema

Cuantificado sobre ventas vivas de 30 días.

| Hallazgo | Filas | Dinero | Eslabón |
|---|---|---|---|
| Líneas mapeadas a producto **sin escandallo** | 1.024 | 16.100,81 € | E2 |
| Líneas de producto **sin mapear** (no combos) | 564 | 7.892,14 € | E2 |
| Modificadores vendidos **sin impacto de receta definido** (92 opciones distintas) | 1.101 de 1.151 | 709,65 € | E3 |
| Ventas con producto con receta y **cero consumo** | 75 | 2.131,78 € | E3 |
| Movimientos con **coste unitario negativo** | 5.289 de 36.057 | — | E5 |
| Líneas de recepción con **movimiento duplicado** | 19 | — | E7 |
| Filas de caché con **coste medio negativo** | 58 | — | E6 |
| Filas de caché con **stock negativo** | 189 | — | E6 |

Sobre las **75 ventas sin consumo**: no es un fallo del motor disparándose. Es que **el consumo se calcula una sola vez, en el momento de la venta**. Si el escandallo o el mapeo se completan después, esa venta se queda sin consumo para siempre. De los 115 pares (venta × producto), 11 son ventas anteriores al alta de la receta y 100 son ventas cuyo producto ya funcionaba — la mayoría son cabeceras de combo, o sea D1. `recompute_sales_consumption(cuenta, desde, hasta)` existe y hace justo eso, pero **no está en ningún cron** (revisados los 43 jobs activos).

---

## 5. E5 — la latencia manda sobre cuándo se puede cerrar un conteo

El asiento de consumo lleva `occurred_at` = hora de la venta (correcto), pero se **inserta** mucho después, porque el trigger salta cuando el pedido llega a `accepted`/`completed`:

| | minutos |
|---|---|
| Mediana (p50) | **123** |
| p90 | 129 |
| Peor caso (14 días) | **912** (15,2 h) |

Consecuencia directa: **cualquier conteo cerrado antes de +2 h desde la última venta ve un teórico incompleto** y se inventa merma. El cron `autoinventory-autoclose` corre a los 10 minutos de cada hora entre las 14 y las 3 — puede cerrar a las 22:10 un día cuyas ventas de las 21:30 no se asientan hasta las 23:30.

**Propuesta (no ejecutada):** mover el autocierre a partir de las 03:10 o exigir que hayan pasado ≥3 h desde la última venta del local. Es un cambio de cron, decisión tuya.

---

## 6. E9 — el clasificador de causas no miente, pero es ciego a lo grande

Respuesta a la pregunta del encargo: **no es texto fijo.** `avt_cause_context` cruza mermas registradas, recepciones, traspasos de salida y uso en escandallo del periodo, y `classifyCauseV2` marca cada hipótesis con su evidencia y su confianza (`'Sobre-porción en elaboración'` sale como `confidence: 'low'`, no como acusación).

El punto ciego: la rama de sobre-porción exige `usedInRecipes` y ausencia de merma, pero **no comprueba si en el periodo se vendieron productos sin escandallo**. Con 16.100 € en 30 días vendidos por productos sin receta, esa es hoy la causa más probable de que "falte" producto — y el clasificador dice "sobre-porción".

**Propuesta (no ejecutada):** añadir a `avt_cause_context` una señal `ventas_sin_escandallo_en_periodo` por artículo, y que la rama de sobre-porción degrade a "consumo incompleto" cuando exista. Es un cambio de función + cliente; lo dejo diseñado, no hecho.

---

## 7. Correcciones que necesitaban autorización — EJECUTADAS el 25-08

Julio autorizó A2 → A1 → A3 → A5 en ese orden exacto. A4 queda para revisar una a una.

| # | Qué | Resultado medido | Estado |
|---|---|---|---|
| A2 | Resync de la caché contra el ledger | **144 → 0** filas desalineadas · valor 40.684,21 € → 41.212,40 € · costes medios negativos 58 → 52 | ✅ hecho |
| A1 | Devolver el stock de las 9 ventas anuladas | 9 ventas, **95 → 0** movimientos de consumo | ✅ hecho |
| A3 | Reprocesar el consumo de los combos | 641 ventas · **392 → 6.340** movimientos (+5.948) · 397 ventas pasan de cero a descontar · −1.798,25 € de coste · 4 ventas bajaron (2 a cero) | ⚠️ hecho, **con efecto lateral** (§9) |
| A5 | Backfill del informe de variance | 1.604 líneas / 97 conteos (1.591 / 96 sin INV-00004) · merma informada −10.116,87 € → **−10.564,09 €** · 128 dejan de ser anomalía, 210 pasan a serlo · **0 líneas con el teórico fuera del ledger** | ✅ hecho, reversible |
| A4 | Revisar las 19 recepciones duplicadas | — | ⏸ pendiente, una a una |

Registro exacto de lo ejecutado, con las consultas y las marchas atrás: `claude/sql/20260825_A1_A2_A3_A5_ejecutado.sql`.

El orden importó: hacer A3 antes que A5 redujo la corrección de A5 de los −7.330 € previstos a **−447,22 €**, porque el consumo que faltaba ya estaba en el ledger cuando se recalculó la merma.

---

## 8. Tests de regresión

`claude/sql/20260825_tests_regresion_stock.sql` — 10 consultas, todas de solo lectura, cada una con su baseline de hoy. La columna `fallos` debe dar 0.

| Test | Vigila |
|---|---|
| T1 | Combos sin consumo (D1) |
| T2 | Anuladas que conservan consumo (D2) |
| T3 | Caché desalineada (D3) — baseline 144/716 |
| T4 | Escandallo no convertible (#83) — baseline 0/1.758 |
| T5 | Cantidades de escandallo que descuentan 0 |
| T6 | Integridad del ledger |
| T7 | Recepciones duplicadas — baseline 19 |
| T8 | **Informe de conteo ≠ asiento de conteo** (el bug de esta mañana) |
| T9 | Ventas sin consumo — baseline 75 |
| T10 | Latencia del asiento — baseline p50 123 min |

T1, T2 y T8 filtran por fecha del fix: solo miran lo ocurrido después, porque el histórico no se reprocesa solo.

---

## 9. Efecto lateral de A3 que hay que decidir

**A3 mete consumo real en tramos que un conteo aprobado ya había cuadrado, y ahí se cuenta dos veces.**

Un ajuste de inventario aprobado hace una cosa muy fuerte: **fuerza el ledger a igualar el físico contado en ese instante.** Si el consumo de los combos faltaba, ese ajuste ya lo absorbió — apareció como "merma" y se corrigió el stock. Al añadir ahora ese consumo con fecha anterior al ajuste, el mismo producto sale dos veces del ledger.

Medido justo después de A3:

| | |
|---|---|
| Movimientos escritos por A3 | 6.340 |
| De ellos, **fechados antes del último conteo aprobado de su local** | **6.108** |
| Coste en zona ya conciliada | **1.882,72 €** |
| Líneas de conteo donde el ajuste asentado ya no coincide con la variación recalculada | 1.055 |

Se ve en Pan Hamburguesa de INV-00181, que es el caso que abrió todo esto:

| Momento | Teórico | Contado | Variación |
|---|---|---|---|
| Con el bug del teórico congelado | 140 | 120 | −20 (merma falsa) |
| Con el teórico reconstruido del ledger | 137 | 120 | **−17** |
| Después de A3 | 87 | 120 | **+33** |

El teórico se ha ido 50 unidades por debajo del físico. No es que sobre pan: es que ese consumo ya estaba descontado por el ajuste del conteo del 23-08.

### Qué se puede hacer

1. **Re-anclar el ledger con los conteos aprobados** (lo correcto). Volver a aplicar cada conteo aprobado en orden cronológico para que su ajuste se recalcule contra el ledger nuevo: cada conteo vuelve a decir "aquí había esto de verdad" y el doble descuento se cancela solo. Requiere tocar `apply_inventory_count`, que hoy sale de vacío si el conteo ya está `aprobado`. **Es la opción que recomiendo.**
2. **Limitar A3 al tramo posterior al último conteo aprobado** de cada local: borrar los 6.108 movimientos fechados antes. Más simple, pero deja el consumo de los combos sin registrar en el histórico anterior — o sea, renuncia a esa parte de la verdad.
3. **Dejarlo así.** No lo recomiendo: el stock teórico queda por debajo del real y los próximos conteos enseñarán sobrantes falsos, que es el mismo tipo de mentira que veníamos a quitar.

**A3 no es reversible fila a fila**: `generate_sale_consumption` borra y reescribe todo el consumo de la venta, así que las 392 filas previas ya no existen. `_a3_antes` guarda recuento y suma por venta (suficiente para auditar la magnitud, no para restaurar). El camino de vuelta es re-anclar, no resucitar filas.

**Lo que debí avisar antes de ejecutar A3:** dije que bajaría el stock teórico, pero no que chocaría con los conteos ya aprobados. La interacción es mía, no tuya.

---

## 10. Crons cambiados el 25-08

| Job | Antes | Ahora | Por qué |
|---|---|---|---|
| `autoinventory-autoclose` | `10 14-23,0-3 * * *` | `10 3 * * *` | El asiento llega con p50 123 min y peor caso 912. Cerrar durante el servicio inventa merma |
| `sales-consumption-reprocess` | *(no existía)* | `30 1 * * *` | Reprocesa las ventas que reciben escandallo o mapeo tarde. Va después del asiento (~23:30) y antes del cierre (03:10) |

Ambos en UTC: 03:10 UTC = 05:10 Madrid en verano.

Dos cosas a tener en cuenta:

- **Contrapartida del autocierre:** un conteo terminado por la mañana ya no se cierra esa tarde, espera al 03:10 siguiente. Si eso molesta, la alternativa es exigir ≥3 h desde la última venta del local dentro de `cron_autoclose_daily_counts` — queda propuesto, no hecho.
- **El reproceso hereda el caveat del §9:** con `p_days = 7` puede meter consumo anterior a un conteo aprobado. Esta noche tocaría 5 ventas, 3 de ellas en esa situación. Bajar a `p_days = 2` lo reduce casi a cero; es un `cron.alter_job` de un minuto.
