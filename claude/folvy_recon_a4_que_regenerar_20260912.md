# RECON de A4 · qué regenerar, qué mueve y qué se queda fuera

**12/09/2026, 07:45–08:40 (Madrid, reloj de la base).** Todo `SELECT`. No se ha
escrito nada. Para revisar hoy y aplicar a partir de las 23:45.

Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710`, anclado por
`account_id` y por `location_id` en todas las cifras (regla 9).

---

## 0 · Lo que iba a medir y lo que apareció

Iba a medir «ventas cuyo consumo cambia porque los extras ahora casan». La
primera pasada, sobre la semana del 08/06, dio **563 de 588 ventas distintas,
con 5.190 pares que «faltan» y 0 que «sobran»**. Eso no es un extra: es que
falta el consumo entero. Paré antes de escribir la cifra, y era eso:

**A 2.802 ventas vivas no se les escribió consumo nunca.**

*La lección:* una comparación que devuelve «casi todo cambia» no es un
resultado, es un aviso de que la pregunta está mal planteada. Si la hubiera
pasado al parte, el número habría sido correcto y la conclusión, falsa.

---

## 1 · LO GORDO: 914 ventas cerradas sin descontar, con el motor funcionando

De las 2.802 sin consumo:

| tramo | motivo | ventas |
|---|---|---:|
| antes del 29/06 (el motor no existía) | tiene línea mapeada | 1.846 |
| **29/06 → 06/09, con el motor en marcha** | **tiene línea mapeada** | **914** |
| 29/06 → 11/09 | líneas sin mapear a plato (legítimo) | 40 |
| 18/07 | la venta no tiene líneas | 2 |

Las 914 están **todas `closed` / `completed`**: 851 de Last (29/06→23/08) y 63
de HubRise (06/08→06/09). No hay excusa de «aún no ha cerrado». Y
`sale_consumption_failure` no registró ni una: **nadie se enteró** (regla 8).

Reparto por semana y local:

| semana | Alcalá | Plaza Castilla | Carabanchel | total |
|---|---:|---:|---:|---:|
| 29/06 | 173 | 78 | 108 | 359 |
| 06/07 | 71 | 33 | 37 | 141 |
| 13/07 | 63 | 0 | 47 | 110 |
| 20/07 | 57 | 0 | 30 | 87 |
| 27/07 | 26 | 0 | 20 | 46 |
| 03/08 | 38 | 0 | 11 | 49 |
| 10/08 | 53 | 0 | 9 | 62 |
| 17/08 | 35 | 0 | 19 | 54 |
| 24/08 | 1 | 0 | 0 | 1 |
| 31/08 | 2 | 0 | 3 | 5 |

**La fuga se corta el 24/08** (1, 5 y 0 desde entonces): coincide con la
auditoría de la cadena de stock del 25/08. Quedan 6 posteriores.

---

## 2 · Y AHORA LO QUE REORDENA A4: regenerar recupera el 15 %

El escritor único **no escribe lo protegido** — lo salta y deja la nota. Así
que regenerar solo recupera lo que está por ENCIMA del corte por ingrediente.

| población | ventas | pares | protegidos | **escriben** | % |
|---|---:|---:|---:|---:|---:|
| 914 con el motor en marcha | 914 | 7.896 | 6.884 | **1.012** | 13 % |
| 1.846 anteriores al motor | 1.846 | 17.812 | 15.103 | **2.709** | 15 % |
| **total** | **2.760** | **25.708** | **21.987** | **3.721** | **14 %** |

Por local, y aquí está todo el peso:

| local | corte más nuevo | arts. con corte | pares que escriben |
|---|---|---:|---:|
| Foodint Alcalá | **12/09 07:31** (hoy) | 226 | **1** de 12.541 |
| Foodint Carabanchel | 07/09 22:15 | 118 | **216** de 6.704 |
| **Foodint Plaza Castilla** | **09/07 12:31** | **63** | **3.504** de 6.463 |

**Alcalá: 1.380 ventas escribirían 1 movimiento.** Contaron esta mañana: la
regla 6 las protege enteras. Ni stock ni coste se recuperan.

**Plaza Castilla concentra el 94 % de lo que se movería**: su último recuento
aprobado es del 09/07 y solo cubre 63 artículos.

### Lo que no puede hacerse y hay que decir

**El mismo corte que protege el almacén impide recuperar la historia de coste.**
Tu regla es «coste en todo el histórico; almacén solo desde el último recuento».
El motor de hoy no sabe separarlas: si no escribe el movimiento, no hay ni
stock ni coste. Las 21.987 parejas protegidas **no se recuperan de ninguna de
las dos formas**. Para separarlas haría falta un cambio de diseño (un asiento
que cuente para coste y no para almacén), y eso no es A4.

---

## 3 · Qué movería el almacén, artículo a artículo

**Plaza Castilla, ventas anteriores al motor** (581 ventas, 2.706 pares, 51
artículos, 144.334 unidades). Los que se quedan en negativo:

| artículo | unidades | stock hoy | stock después |
|---|---:|---:|---:|
| Arroz Largo | 21.056,8 | 19.086,4 | **−1.970,4** |
| Solomillo de Pollo Piri-piri | 18.360,0 | 12.196,0 | **−6.164,0** |
| Caldo de Birria | 17.238,0 | 13.100,0 | **−4.138,0** |
| Queso Mozarela | 15.930,0 | 8.780,0 | **−7.150,0** |
| Tomate Pera | 6.544,2 | 4.012,5 | **−2.531,7** |
| Lima | 4.882,2 | 437,1 | **−4.445,1** |
| Queso Cheddar Loncheado | 4.120,0 | 2.240,0 | **−1.880,0** |
| Aceite de Birria | 3.473,2 | 955,2 | **−2.518,0** |
| Cilantro | 1.934,3 | 475,6 | **−1.458,7** |
| Cebollino | 1.046,0 | 169,0 | **−877,0** |
| Tortilla Trigo 30 cm | 128,0 | 74,0 | **−54,0** |
| Tarta 3 Leches | 28,0 | 19,0 | **−9,0** |
| (+ 12 más que ya estaban a 0 o en negativo) | | | |

**Plaza Castilla y Carabanchel, con el motor en marcha** (78 artículos). Los
que cruzan a negativo: Salsa White Bbq (380 → −100) y Queso Parmesano
(8,4 → −51,6) en Carabanchel; Lima (437,1 → −245,2), Cebollino (169 → −8),
Salsa Smokey Baconesa (0 → −80), Calabacín (0 → −62,5) y Salsa Cesar (0 → −25)
en Plaza Castilla.

La lista completa de los 78 + 51 artículos está en las consultas de este RECON
y se vuelve a sacar en un momento si la quieres impresa.

---

## 4 · Qué cambia el coste

**1.337,38 €** se apuntarían como coste de consumo:

| población | € |
|---|---:|
| post-motor · Carabanchel (19 art.) | 37,57 |
| post-motor · Plaza Castilla (59 art.) | 395,07 |
| pre-motor · Plaza Castilla (51 art.) | 904,74 |
| **total** | **1.337,38** |

### HALLAZGO APARTE, Y MUERDE A ESTO: hay costes negativos

**22 artículo-local con `avg_unit_cost` NEGATIVO**, y los 22 tienen su
`computed_cost` positivo. Un coste medio negativo no existe: consumir sumaría
valor. Los peores: Pasta Trufada (PC) −0,199 €/g con `stock_value` −65,79 €;
Pan Bocadillos (Carabanchel) −0,102 con computed 0,5112; Hamburguesa Mixta
(PC) −0,027 con computed 0,7482.

**En esta regeneración, 10 renglones se apuntarían con coste negativo
(−4,14 € en total).** Es poco dinero y es igualmente inaceptable: mete basura
en la historia que luego alimenta la varianza. Es del motor de coste medio
ponderado, no de A4, y yo lo arreglaría ANTES.

---

## 5 · Los extras que ahora casan

4.408 líneas de extra de 4.444 casan (99,2 %), en 2.718 ventas. De lo que
tienen decidido qué llevan:

| qué hace | líneas | ventas |
|---|---:|---:|
| **sin decidir** (casa pero no se sabe qué lleva) | **1.618** | **1.087** |
| `add_item` confirmado | 1.521 | 1.225 |
| `bundle` confirmado (es un plato) | 810 | 561 |
| `none` confirmado | 433 | 333 |
| `remove_item` confirmado | 176 | 149 |

**Medido solo donde la vara sirve** — ventas que SÍ tienen consumo, impacto
`add_item`, artículo concreto:

> **983 líneas en 789 ventas. 397 ya están descontadas. Faltan 586, en 522 ventas.**

**Lo que NO se puede medir así, y lo digo:** para un `bundle` el impacto es un
PLATO, que se descompone en ingredientes — buscar el id del plato entre los
movimientos da «no descontado» siempre. Ese «810 de 810» de mi primera pasada
es un artefacto de mi medida, no un hallazgo. Y en `remove_item`, la ausencia
del artículo puede ser lo correcto.

Las **1.087 ventas con extra sin decidir** no las arregla A4 de ninguna forma:
necesitan la fase B.

---

## 6 · Los duplicados de los dos motores

Reconciliado con el RECON del 11/09, y las dos cifras eran correctas midiendo
**lados distintos**:

| medida | total | Alcalá | Carabanchel | Plaza Castilla |
|---|---:|---:|---:|---:|
| movimientos del **motor B** con gemelo | **516** | 369 | 121 | 26 |
| movimientos del **motor A** con gemelo | **769** | 530 | 199 | 40 |
| pares (venta, artículo) | 505 | | | |
| ventas | 52 | | | |

Del 12/06 al 03/08. **A4a no «quita el motor B»:** al regenerar una venta
anterior al 05/08 borra LOS DOS lados y reescribe del escandallo. Así que lo
que importa es la diferencia, con el corte delante:

**19 filas artículo-local por encima del corte, TODAS devolviendo stock**
(Alcalá 0: protegido por el recuento de hoy).

| local | artículo | unidades que vuelven | stock hoy → después |
|---|---|---:|---|
| Carabanchel | Cebolla Morada | 220,0 | 11.290,7 → 11.510,7 |
| Carabanchel | Nachos | 100,0 | −1.680,0 → −1.580,0 |
| Carabanchel | Salsa Coreana | 90,0 | 5.061,0 → 5.151,0 |
| Carabanchel | Pepinillos Agridulce | 30,0 | 10.855,7 → 10.885,7 |
| Carabanchel | Sal | 18,0 | 408,2 → 426,2 |
| Plaza Castilla | Patatas Bastón | 540,0 | 56.740,0 → 57.280,0 |
| Plaza Castilla | DELICIAS DE POLLO SOUTHERN | 448,0 | 2.616,0 → 3.064,0 |
| Plaza Castilla | Lechuga Romana | 184,2 | 7.017,4 → 7.201,6 |
| Plaza Castilla | Pulled Pork | 130,0 | 14.180,0 → 14.310,0 |
| Plaza Castilla | Queso Cheddar Loncheado | 120,0 | 2.240,0 → 2.360,0 |
| Plaza Castilla | Salsa Melt | 90,0 | 2.290,0 → 2.380,0 |
| Plaza Castilla | Salsa Sweet Chilli | 80,0 | 880,0 → 960,0 |
| Plaza Castilla | Pepinillos Agridulce | 64,4 | 3.172,7 → 3.237,1 |
| Plaza Castilla | Salsa BBQ | 60,0 | 2.710,0 → 2.770,0 |
| Plaza Castilla | Salsa Coreana | 60,0 | 1.390,0 → 1.450,0 |
| Plaza Castilla | Cebollino | 40,0 | 169,0 → 209,0 |
| Plaza Castilla | Salsa Mil Islas | 40,0 | 3.420,0 → 3.460,0 |
| Plaza Castilla | Pan Hamburguesa | 4,0 | 419,0 → 423,0 |
| Plaza Castilla | Agua Mineral 50 CL | 4,0 | 8,0 → 12,0 |

Carabanchel devuelve 458 unidades en 5 artículos; Plaza Castilla 1.864,7 en 14.
**Ninguno empeora: todos suben.**

---

## 7 · Qué se queda FUERA, y por qué

1. **21.987 parejas protegidas por el corte** (regla 6). Ni stock ni coste. Es
   el 86 % de todo. No es un fallo: es la regla funcionando.
2. **1.380 ventas de Alcalá** enteras: contaron esta mañana.
3. **1.087 ventas con extra sin decidir**: hace falta la fase B.
4. **40 ventas con líneas sin mapear** y **2 sin líneas**: no hay qué descontar.
5. **Los impactos `bundle` y `remove_item`**: mi vara no los mide. Hace falta
   comparar el escandallo completo, no buscar el artículo.
6. **DECISIÓN QUE NO ES MÍA — la receta de hoy sobre una venta de junio.**
   Regenerar aplica el escandallo ACTUAL a una venta vieja. Si una receta
   cambió desde entonces, la historia se reescribe con la receta nueva y ya no
   dice lo que pasó: dice lo que pasaría hoy. Para las 1.846 anteriores al
   motor eso son casi tres meses de deriva de recetas. No lo he medido —
   hacerlo es comparar versión a versión de cada escandallo— y **no lo daría
   por bueno sin que lo decidas tú**.

---

## 8 · Lo que yo propondría aplicar esta noche, y en qué orden

Es una propuesta, no una decisión tomada.

1. **Antes que nada, los 22 costes negativos.** Es barato y evita meter 10
   renglones con precio imposible en la historia.
2. **Los 52 duplicados.** Solo devuelven stock (19 filas, ninguna empeora),
   está medido artículo a artículo y arriba está la lista. Es el más seguro.
3. **Las 914 con el motor en marcha.** 1.012 pares escriben; el grueso es
   Plaza Castilla. Aquí ya hay artículos que cruzan a negativo.
4. **Las 1.846 anteriores al motor: yo NO las metería esta noche.** 2.706
   pares, 144.334 unidades, casi todo en Plaza Castilla, doce artículos que
   quedan en negativo fuerte — y por delante la pregunta 7.6 sin contestar.
   Si entran, que entren con su propia decisión y su propia ventana.

Y una que no es de A4 pero sale de aquí: **914 pedidos cerrados sin descontar y
cero avisos.** Tape lo que tape A4, mientras no haya un vigía que cuente
«ventas cerradas sin consumo» esto vuelve a pasar y nadie se entera. Es la
regla 8, y es lo que yo pondría delante de todo lo demás.

---

# ADENDA · 12/09 09:15 · dos correcciones mías y una contradicción

## A · Corrección 1: los costes negativos son 24, no 22

Dije 22 en el parte. Son **24**, y Julio lo tenía bien. Mi consulta devolvió 24
filas y yo conté mal las de la lista. Además hay **40 más a cero exacto**.

## B · Corrección 2: mi filtro escondía 43 pedidos sin descontar

Yo decía «quedan 6 posteriores al 24/08». Julio dice 49. Medido: la diferencia
es **mía**, y está en mi propio filtro.

| estado | estado_pedido | sin `closed_at` | ventas | Carabanchel |
|---|---|---|---:|---:|
| **`open`** | **`cancelled`** | sí | **44** | **40** |
| `open` | `delivery_failed` | sí | 2 | 1 |
| `cancelled` | `cancelled` | sí | 12 | 4 |

**Yo excluyo `order_status IN ('cancelled','rejected')`** — y estos 44 lo
llevan. Por eso no aparecían.

*La lección, y es la misma de la regla 7 por otra puerta:* un filtro que
excluye «lo anulado» da por hecho que anulado quiere decir anulado. Cuando el
dato está en un estado contradictorio, ese filtro no protege de nada: esconde.

**Las varas que probé y NINGUNA da el 48/42 de Julio** (con >24 h):
`status <> 'closed'` → 2. `closed_at IS NULL` → 210 (¡155 de ellas YA tienen
consumo!). `opened_at NOT NULL y closed_at NULL` → 207. `closed_at NULL y
lastapp` → 204. `closed_at NULL y sin consumo` → 55. La buena es
`status='open'`, que da 46 (44+2), 41 en Carabanchel. **Hay que fijar UNA y que
el vigía cuente esa**, o el aviso discutirá con la pantalla desde el primer día.

## C · LA CONTRADICCIÓN: dicen `cancelled` y no hay nadie que los cancelara

Julio: «los pedidos abiertos de Carabanchel se sirvieron». Medido sobre los 14
más recientes de los 44:

- `accepted_at` = `created_at`, al minuto.
- `ready_at`, `handed_to_courier_at`, `delivered_at`: **los tres en blanco, en
  los 14**.
- `paid` y `delivery_state`: **nulos**.
- **`cancelled_at`: NULO** — aunque `order_status` diga `cancelled`.
- Cinco de ellos con `updated_at` idéntico: 11/09 12:31. Un toque en lote.

O sea: **nadie los canceló; la marca se la puso algo, no alguien.** Y tampoco
hay rastro de que se prepararan ni se entregaran. El registro no dice que se
sirvieran NI que se anularan: no dice nada.

Lo que moverían si se cierran:

| local | abiertas | pares | protegidos | **descontarían** | artículos | unidades |
|---|---:|---:|---:|---:|---:|---:|
| Alcalá | 4 | 25 | 25 | **0** | 0 | — |
| **Carabanchel** | **41** | 453 | 276 | **177** | **49** | **7.525,0** |

Del 15/08 al 10/09.

## D · Las 522 con `add_item` sin descontar, medidas

| local | ventas | pares | protegidos | **escriben** | artículos | unidades |
|---|---:|---:|---:|---:|---:|---:|
| Alcalá | 367 | 954 | 950 | **4** | 2 | +310,0 |
| Carabanchel | 105 | 311 | 223 | **88** | 18 | +4.947,0 |
| Plaza Castilla | 50 | 213 | 66 | **147** | 40 | +5.442,4 |

*(Y un defecto que cacé en mi propia consulta antes de pasarlo: la primera
versión no arrastraba `location_id` por el lado de «lo que hay», así que 113
pares con −9.203 unidades salían agrupados bajo un local que no era el suyo. El
`CASE` los mandaba al `ELSE`. Corregido: el local se toma SIEMPRE de la venta.)*

Coste: **80,72 €**. Carabanchel 84,49 €, Alcalá 1,72 € y **Plaza Castilla
−5,49 €**.

## E · HALLAZGO: la guarda de coste imposible se queda corta

Plaza Castilla sale en **negativo** por UNA fila:

> **Albahaca · Plaza Castilla · 7,1536 €/gramo**, contra **0,0278** del
> escandallo. **258 veces más.** 41,19 g valorados en 294,68 €.

En esta regeneración esa fila sola vale **−84,16 €** y **le da la vuelta al
signo de un local entero**: sin ella, el coste pasa de 80,72 € a 164,88 €.

**La guarda de `avg_unit_cost < 0` NO la atrapa**, porque es positiva. Lo que
quitaría la guarda de Julio son 6 filas por **−1,44 €** — calderilla al lado de
esto.

Hay **2 artículo-local con el coste medio más de 20 veces por encima de su
escandallo**: Albahaca (258×) y Servilletas 30 x 40 (30×), las dos en Plaza
Castilla.

**Propuesta:** que la guarda no sea «precio negativo» sino **«precio que no se
puede defender»**: negativo, o más de N veces el coste del escandallo. Con N=20
son 2 filas más, las dos medidas y con nombre. El resto igual: se salta ese
artículo y va a la lista.
