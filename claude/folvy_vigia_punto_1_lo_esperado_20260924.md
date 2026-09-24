# Punto 1 del encargo del vigía — «la tabla de descartes»

**24/09, 01:4x Madrid.** Medido, escrito y ensayado. **NO aplicado, y no lo voy a
aplicar yo**: toca `generate_sale_consumption`, que es el camino del pedido.

---

## 1. La premisa se cumple a medias

**La tabla de descartes ya existe.** Es `sale_consumption_skip`, y el motor la
escribe en tres sitios. Viva, con 4.570 filas de Foodint:

| motivo | filas | ventas | ingredientes | desde | hasta |
|---|---:|---:|---:|---|---|
| por debajo del corte | 4.504 | 544 | 89 | 12/06 | 20/09 |
| anulación bajo el corte | 54 | 9 | 32 | 12/09 | 20/09 |
| precio indefendible | 6 | 3 | 6 | 11/07 | 06/09 |
| «ya no lo pide» | 6 | 6 | 1 | 15/08 | 27/08 |

Así que el punto 1, tal y como está escrito, está hecho desde hace semanas.

**Lo que no guarda nadie es LO ESPERADO**: la lista de (línea de venta,
ingrediente, cantidad) que el motor iba a consumir. Y ése es el agujero, porque
obliga a **recalcular el pasado con el motor de hoy**.

## 2. La prueba, y es la medida que el recon del 22/09 no pudo sacar

Misma consulta de cierre, misma ventana (12–22/09), mismo universo:

| casilla | 22/09 | 24/09 |
|---|---:|---:|
| 1 · sin casar con la carta | 29 / 206,13 | 12 / 25,80 |
| 2 · sin ficha y sin descontar | 7 / 75,10 | 4 / 40,60 |
| 3 · con ficha y cero movimientos | 6 / 81,60 | 9 / 116,10 |
| 3b · recasada en frío | — | 17 / 180,33 |
| **4 · le falta un ingrediente** | **93 / 1.897,42** | **2.154 / 33.070,53** |
| 5 · la comida sí, el envase nunca | 1.710 / 24.486,51 | **0 / 0,00** |
| 6 · completo | 497 / 7.498,70 | 146 / 812,10 |
| **TOTAL** | **2.342 / 34.245,46** | **2.342 / 34.245,46** |

El total cuadra al céntimo a los dos lados: el universo es el mismo y no se ha
vendido nada nuevo. Pero **2.061 líneas y 31.173 € han cambiado de casilla
solas, en 48 horas**, porque el 23/09 a las 00:01 `explode_recipe_to_raws` empezó
a devolver `packaging`. Ahora el motor «espera» envase en ventas de agosto que
nunca lo movieron, y la casilla 4 se las traga antes de que lleguen a la 5.

Es la familia de la deriva de receta que ya estaba anotada, **un piso más
arriba**: no es que cambie la receta, es que cambia el **motor**. Y contra eso no
protege versionar escandallos (el punto 2 de anoche). Solo protege escribir lo
esperado cuando se consume y no volver a calcularlo nunca.

**Un vigía montado sobre la consulta de hoy habría gritado 2.154 veces esta
mañana, y ni una sola vez por algo que pasara en la cocina.**

## 3. Lo hecho — `20260924T0130_lo_esperado_se_congela.sql`

Una tabla, `sale_line_consumo_esperado`, que congela `base` — la CTE que el motor
**ya calcula**, su propia verdad en ese instante. No es una réplica (regla 39):
es literalmente su resultado intermedio, escrito.

**No se transcribe la función.** Son 344 líneas y copiarlas a mano para cambiar
tres es justo como se cuelan los errores que ni `tsc` ni las pruebas ven. La
migración lee lo desplegado, le injerta la CTE detrás de `items`, y **aborta si
el ancla no aparece exactamente una vez** o si después del `EXECUTE` la función
no lleva el injerto. No se queda a medias.

### Lo que encontró el ensayo, y por poco no lo veo

La primera pasada dio **0 filas guardadas donde el motor decía 14**. No era un
fallo del injerto: es **FV001**, del 16/09.

```
-- ══ SI NADA HA CAMBIADO, SE DESHACE EL BLOQUE ENTERO · FV001 ══
IF NOT v_legacy AND v_huella_despues = v_huella_antes THEN
  RAISE EXCEPTION USING ERRCODE = 'FV001', MESSAGE = 'consumo sin cambios';
```

Cuando la huella no cambia, el motor lanza su propio error **para deshacer la
subtransacción entera** — «mismos identificadores, 0 filas nuevas, caché
incluida». Cualquier registro adicional que viva dentro de ese bloque se deshace
con él. Mi prueba lo cazó porque estaba escrita contra una venta real que ya
tenía su consumo bien.

**Consecuencia, y va dicha porque limita lo que esto sirve:** lo esperado se
escribe en toda pasada que **cambie** el consumo —que es todo primer cierre— y no
en una re-pasada que no cambia nada. O sea: **empieza a llenarse el día que se
aplique, hacia delante.** Las 2.342 líneas ya cerradas no van a tener esperado
guardado nunca, salvo reprocesando, que está prohibido. La casilla 4 seguirá sin
poderse partir para el pasado; para lo que venga, se contesta leyendo.

## 4. El ensayo — todo en transacción revertida

| | medido | esperado | |
|---|---|---|---|
| la función lleva el injerto | 1 | 1 | OK |
| filas guardadas = filas del motor | 14 | 14 | OK |
| ni una fila distinta del motor | 0 | 0 | OK |
| los movimientos se reescriben | true | true | OK |
| 2ª pasada (FV001) no pierde lo guardado | 14 | 14 | OK |
| una fila intrusa se limpia sola | 14 | 14 | OK |

Y los **cuatro caminos** (regla 10), como usuario real de la cuenta:

| camino | antes | después | |
|---|---:|---:|---|
| cerrar una venta | 0 | 14 movimientos + 14 esperados | OK |
| recibir un albarán | 15 | 15 | OK |
| apuntar una merma | 0 | 1 | OK |
| aprobar un recuento abierto | 0 | 1 | OK |

**Dos «FALLA» que eran del ensayo y no del cambio, y lo digo:**

1. La primera vez puse el andamio (decidir las 2 líneas del albarán, poner motivo
   a las 15 del recuento) **ya suplantando al usuario**, y la RLS se lo comió en
   silencio: el camino salía `false` en vez de `FALLA`. Hecho como postgres antes
   de suplantar, pasa.
2. El recuento `5536132c` salía sin movimientos nuevos porque **ya estaba
   aprobado**: lo cerró Julio a las 00:55 desde la app, 22 movimientos firmados
   con su nombre y con las horas reales del conteo (20:02–20:25). No es una fuga
   de mis ensayos — los míos firman `Ensayo`. Repetido contra `771648e1`, que
   sigue abierto: 0 → 1. **De paso queda comprobado en caliente que los
   disparadores de anoche no estorban al aprobar un recuento.**

## 5. Por qué no lo aplico

Esto toca `generate_sale_consumption`. Es la función que el 10/09 se llevó por
delante 79 entregas por token, 33 cambios de estado, 10 mermas y 7 cierres de
venta, y aquel cambio también parecía inocuo. Las salvaguardas están puestas —la
tabla no tiene ni un CHECK ni un NOT NULL que pueda saltar con datos que el motor
considera válidos, `location_id` es nullable, y las dos escrituras son disjuntas
por construcción para no repetir el 21000— pero **el motor lo ejecuta y lo
verifica Julio**, no yo a las dos de la mañana.

Está escrita, ensayada por los cuatro caminos y commiteada. Cuando digas.

## 6. Lo que queda del encargo del vigía

- **Partir la casilla 4** — con esto aplicado se parte sola para lo nuevo. Para
  el pasado, no: no hay forma honesta.
- **El vigía en sí**, con el cierre dentro, por día / local / marca, 72 h de
  gracia y severidad por dinero. **Y no se puede encender sobre la consulta de
  hoy**: la sección 2 explica por qué.
- El silencio de un canal (punto 6) y los anulados (punto 7).
