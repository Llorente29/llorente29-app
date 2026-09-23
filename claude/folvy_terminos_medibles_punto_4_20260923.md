# Punto 4 — «Las recepciones que entran como ajuste»

**23/09, 18:4x Madrid.** Encargo CODE «Que los términos de la resta sean medibles».
Escrito y probado; **NO aplicado y NO fusionado**: son las 18:4x y tu condición
dice *fuera de servicio, nunca entre 12:15 y 00:30*. Va después de las 00:30.

---

## 1. La premisa no se sostiene, y hay que decirlo

El encargo pedía arreglar «las recepciones que entran como ajuste». Medido sobre
`stock_movement` de Foodint (`account_id = 51ad1792…`, regla 9):

| `source_type = 'goods_receipt_line'` | movs | € (valor absoluto) | últimos 30 d | desde | hasta |
|---|---:|---:|---:|---|---|
| `recepcion` | **1.046** | 69.030,00 | 365 | 12/06 | 23/09 |
| `ajuste` | **52** | 15.285,08 | 37 | 10/07 | 21/09 |

Los 52 **no son recepciones por la puerta equivocada**. Son correcciones y
anulaciones de recepciones que ya entraron bien, y sus notas lo dicen todas —
las 52, sin una sola huérfana:

- **39** «Ajuste de oficina sobre ALB-…», en parejas que se compensan sobre el
  mismo `source_id`. Ejemplos: 21/09 RAW-00057 −10.000 @ 0,0092 y +10.000 @
  0,0084 (misma cantidad, otro coste: corrección de precio); 11/09 RAW-00228 −1
  y +80 @ 119,77 (corrección de cantidad, la que domina el total).
- **1** «Reverso por anulación de albarán ALB-00062».
- **12** «Correc(c)ión manual …» del 14–15/08, cada una con su motivo escrito
  («el albarán 128513 dice caja de 250», «el albarán dice ALUBIA…»).

Y lo escriben **a propósito** dos funciones, con la decisión firmada dentro del
código:

```
adjust_goods_receipt_line, líneas 83-97:
  -- ENCARGO CODE (14/08) A.3.bis (decisión de Julio) — ¿esta línea ya había
  -- posteado alguna vez? Si NO, esto no es una corrección: es una entrega
  -- que llega tarde…
  if v_had_movement then v_movement_type := 'ajuste';
  else                   v_movement_type := 'recepcion';

void_goods_receipt, línea 42:
  'ajuste', -v_mov.qty_base, …  'Reverso por anulación de albarán '…
```

**Tu criterio de aceptación ya se cumple: 1.046 de 1.046.** Una recepción nueva,
por cualquiera de las vías de la pantalla, escribe `recepcion`. Y el contador de
`ajuste` sobre `goods_receipt_line` **debe** seguir creciendo: cada vez que la
oficina corrija un albarán, ahí habrá una fila. Vigilar ese contador era vigilar
el termómetro equivocado.

## 2. Dónde se pierde de verdad el término: en el que LEE

Dos funciones de la misma familia de pantallas no se ponen de acuerdo en qué es
una entrada:

| función | qué cuenta como entrada |
|---|---|
| `_count_review_context_core` (la revisión del conteo) | `source_type='goods_receipt_line'` **OR** `movement_type IN ('recepcion','traspaso_entrada','apertura')` |
| `avt_cause_context` (el clasificador de causas del AVT) | `movement_type = 'recepcion'` — **y sólo eso** |

Es la familia de la **regla 30**: la puerta por la que se ESCRIBE no puede ser
otra que la puerta por la que se LEE. Aquí la mercancía entra corregida
(`'ajuste'`) y el AVT mira sólo por la puerta sin corregir.

**La medida, en el conteo que tienes VIVO ahora mismo** (771648e1…, `en_revision`):

| artículo | entradas que ve el AVT hoy | entradas reales por albarán |
|---|---:|---:|
| RAW-00174 **Milanesa de Pollo Rebozado** (ALB-00146, 2 correcciones) | **0** | **−22,440 kg** |

Cero. Ni un `recepcion` en el periodo, porque la recepción original quedó del
lado de antes del conteo anterior y en esta ventana sólo viven las dos
correcciones. El AVT va a juzgar la desviación de ese artículo creyendo que no
se tocó nada por albarán.

Y sobre el conjunto: **34 movimientos dentro de la ventana de 15 conteos ya
aprobados**, 2 más en el vivo, 2 en uno anulado.

## 3. Y hay un segundo agujero, más tonto y más grande

`receiptsQtyBase` se mide en la base, viaja hasta el cliente, está tipado en
`CauseContext`… y **ninguna rama de `classifyCauseV2` lo lee**. Medido:

```
$ grep -rn "receiptsQtyBase" src/ tests/
src/…/inventoryCountService.ts:773    ← la declaración del tipo
src/…/inventoryCountService.ts:1025   ← se rellena desde la RPC
src/…/inventoryCountService.ts:1032   ← el cero del caso sin contexto
tests/…/causaConCobertura.test.ts:21  ← un cero en un fixture
```

Tres apariciones, ninguna es un uso. El término estaba en la mesa y no llegaba
a ninguna decisión ni a ninguna pantalla. Por eso arreglar sólo la base habría
sido aplicar una migración **sin ningún efecto visible** — que es justo lo que la
regla 8 prohíbe dar por bueno.

## 4. Lo hecho

**(a) `20260924T0035_la_entrada_corregida_tambien_es_entrada.sql`** —
`avt_cause_context` suma `movement_type='recepcion'` **O** cualquier movimiento
con `source_type='goods_receipt_line'`, con su signo: el reverso de una anulación
resta, porque esa mercancía no entró.

De propósito **estrecho**: no copio el resto del criterio de la función hermana
(`traspaso_entrada`, `apertura`). Esa contesta otra pregunta — «qué se ha movido
desde tu último conteo» — y meter la apertura dentro de «entradas» sería falso.

*Ensayo, en transacción revertida, llamando al MOTOR (regla 39) y como usuario
real de la cuenta, no como postgres:*

```
filas antes 2 · filas después 2
filas con otro campo movido ............ 0
filas con entradas distintas ........... 1
delta total de entradas ............ -22,440
```

*Banda:* `create or replace` de función, no toma cierre sobre ninguna tabla.
Medido: **0** funciones, **0** crons y **0** disparadores la llaman. Aun así
espera a las 00:30 porque tu condición de este encargo es más estricta que la
banda, y la duda va a favor de esperar.

**(b) El término deja de ser mudo** (`inventoryCountService.ts`). `receiptsQtyBase`
va escrito en la evidencia de las dos hipótesis que dependen de él —
«Recepción sin registrar» y «Sin causa clara»— con **signo**, porque el neto por
albarán puede ser negativo:

- `+` → «Por albarán entraron 37,6 kg en el periodo.»
- `−` → «Por albarán el periodo neteó −22,4 kg: hay correcciones o anulaciones de
  oficina que restan más de lo que entró.»
- `0` → «Por albarán no entró nada en el periodo.»

**No cambia ni el `reasonCode` ni la `confidence` de ninguna causa.** El término
ordena y etiqueta; no decide (regla 7). Subir la confianza de «Recepción sin
registrar» a `high` la sacaría del filtro de cobertura, y eso es una decisión
tuya, no mía.

**(c) `tests/unit/modules/supply/entradaPorAlbaran.test.ts`**, 6 pruebas contra la
población real: la Milanesa con sus −22,44 kg medidos, no un ejemplo inventado
(regla 31). Incluye la que comprueba que el término **no** decide, y la que
comprueba que con merma registrada manda la merma y la entrada no se cuela.

## 5. El «no he roto nada», con dos cifras y la misma vara

| | antes (sin el cambio) | después |
|---|---|---|
| `npx vitest run` | 110 ficheros · **1.670** pruebas · 0 fallos | 111 · **1.676** · 0 fallos |
| `npx eslint .` | **1.379** problemas (1.079 errores, 300 avisos) | **1.379** (1.079, 300) |
| `npm run build` (borrando `*.tsbuildinfo` antes) | — | ✅ `built in 11.71s` |

El «antes» se tomó con `git stash -u` de los dos ficheros tocados y el mismo
comando, no de memoria.

## 6. Lo que queda por decidir — y es tuyo

Los 52 movimientos son entradas de mercancía **tipificadas como `ajuste`**. Con
(a) el AVT ya los lee bien, pero siguen contando en la casilla «Ajustes» del
histórico de movimientos (`MOVEMENT_FILTERS`, `movementsService.ts:187`). Ahí no
esconden nada —el filtro «Todos» existe— pero quien busque la entrada de un
albarán corregido en «Entradas» no la encuentra.

**No lo he tocado**, porque cambiar esa etiqueta es taxonomía y es tuya:
¿una corrección de albarán es una **entrada** o es un **ajuste**? Yo diría
entrada, porque el hecho físico es mercancía cruzando la puerta. Pero es un
chip que el operario lleva meses leyendo de una manera.

## 7. Estado

- Migración **escrita, ensayada, NO aplicada**. Va después de las 00:30.
- Front **commiteado en la rama, NO fusionado**: fusionar publica también las
  tablets, y eso es publicar en banda. Va después de las 00:30.
- No toca el motor de consumo. No reprocesa ni una venta. No reescribe ni una
  fila ya escrita: ni los 52 ajustes, ni los ~35 movimientos mal tipificados,
  ni las 147 líneas sin `started_at`.
