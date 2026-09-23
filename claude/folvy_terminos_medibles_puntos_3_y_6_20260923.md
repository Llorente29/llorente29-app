# Los términos de la resta · puntos 3 y 6

> 23/09/2026. Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710`.
> Del encargo «Que los términos de la resta sean medibles».
> Todo lo de aquí está medido contra la base antes de escribir código.

## Punto 3 · El ajuste a la baja — HECHO (propuesto, sin aplicar)

`supabase/migrations/20260923T1100_el_ajuste_a_la_baja_dice_por_que.sql`
+ `src/modules/supply/lib/ajusteALaBaja.ts` + la pantalla + 11 pruebas.

### El titular del encargo no es el que dicen los datos

El encargo dice «178 ajustes a mano por −24.249,07 €, 175 sin nota». En
Alcalá, 30 días, separando por QUIÉN escribe el movimiento `ajuste`:

| viene de | movs | € | a la baja |
|---|---|---|---|
| `inventory_count` (aprobar un recuento) | 936 | +5.862,59 | 446 |
| **`adjustment` (la pantalla)** | 192 | −24.378,99 | **8** |
| `goods_receipt_line` (punto 4) | 35 | +9.366,22 | 18 |

Los 24.249 € salen de la pantalla, pero **no son 178 bajadas: son ocho**. Y
seis de ellas no son pérdidas — son correcciones de UNIDAD, 29.622,09 €:

| fecha | artículo | había | contó | € |
|---|---|---|---|---|
| 11/09 00:10 | Bolsas Ay Mamita | 55.000 | 200 | −8.891,21 |
| 11/09 00:11 | Bolsas Birria Burrito | 50.000 | 200 | −8.610,12 |
| 11/09 00:11 | Bolsas Korean | 31.750 | 100 | −5.513,36 |
| 11/09 00:12 | Bolsas Dos Coyotes | 22.500 | 0 | −3.835,80 |
| 11/09 00:12 | Bolsas Chivuo's | 12.500 | 40 | −2.195,47 |
| 05/09 14:07 | Coca-Cola Lata | 1.440 | 60 | −576,13 |

La Coca-Cola canta el error sola: **1.440 = 60 × 24**, una caja contada como
unidades. Las dos restantes sí llevan nota y se explican solas.

**Y aun así el arreglo es el mismo**, porque desde la base las dos cosas son
**indistinguibles**: un −8.891 sin nota puede ser una pérdida o un fantasma.
Esto no tapa una fuga — hace que el residuo deje de estar *explicado en falso*.

### Dos de las tres reglas no cazan nada hoy

Medido a 90 días: **cero** bajadas con `other` (los 15 son al alza y suman
0,00 €) y **cero** movimientos con `waste`/`expired` en toda la tabla. Son
preventivas. La que muerde es la nota: habría cazado las seis.

### El ensayo, los dos lados con la misma vara

Suplantando a un usuario real de la cuenta dentro de una transacción revertida
(`auth.uid()` lee el claim del JWT):

| caso | hoy | con la guarda |
|---|---|---|
| bajada `count_correction` sin nota | **pasa** (−1.933 servilletas) | rechazado |
| bajada con nota de dos letras | pasa | rechazado |
| bajada con explicación | pasa | pasa |
| bajada «Otro» | pasa | rechazado |
| bajada «Merma» | **pasa y se guarda como `ajuste`** | rechazado → va a Merma |
| bajada «Caducado» | pasa | rechazado |
| bajada «Error de escandallo» | pasa | pasa |
| **subida** «Otro» sin nota | pasa | pasa (no se toca) |

Ese «Merma pasa y se guarda como ajuste» es literalmente **cómo la merma vale
0 € mientras se tira comida**.

*Y un fallo mío, que va escrito porque enseña algo:* la primera versión del
ensayo marcó tres FALLA que eran de la prueba. Cada llamada que pasaba dejaba
el saldo en 10, así que las siguientes ya no eran bajadas sino delta 0 y la
guarda no entraba. Rehecho aislando cada caso; el saldo acabó intacto en 1.943.

---

## Punto 6 · `counted_at` — YA ESTÁ HECHO, no hace falta código

El encargo pide sellar `counted_at` al escribir `counted_qty`, y dice que hoy
falla en el 19 % (305 de 1.608). **Medido: la fuga se cerró el 03/08.**

### Lo primero, el denominador

4.076 líneas de recuentos aprobados, 1.686 sin `counted_at` (41,4 %). Pero
**857 de esas nunca se contaron** (`counted_qty` nulo): no tener hora es lo
correcto para ellas. El numerador honesto son las **contadas**:

**3.219 líneas contadas · 829 sin hora · 25,8 %** — y todas viejas.

### Cuándo paró

| semana del | contadas | sin hora |
|---|---|---|
| 08/06 → 20/07 | 538 | **538 (100 %)** |
| 27/07 | 385 | 70 (18 %) |
| **03/08 → 21/09** (ocho semanas) | **2.018** | **0** |

Últimos 15 días: **644 contadas, 0 sin hora.** El criterio del encargo —«el
porcentaje de nulos deja de crecer»— lleva **ocho semanas cumplido**.

### Y sella la hora REAL, que es lo que importaba

| recuento empezó | líneas | primera | última | cola |
|---|---|---|---|---|
| 22/09 06:00 | 23 | 13:08 | 20:30 | **871 min** |
| 21/09 06:00 | 19 | 17:41 | 20:40 | 880 min |
| 20/09 20:16 | 78 | 20:18 | 08:35 | 739 min |

O sea: el daño que describe el encargo es **real y grande** —si esas líneas
cayeran al `started_at`, un recuento de las 06:00 protegería catorce horas de
ventas— pero **ya no ocurre**, porque la hora se sella por línea.

### Por qué no hace falta backstop

El disparador `trg_a_count_line_solo_por_la_puerta` **rechaza** (FV002)
cualquier escritura de `counted_qty` que no venga de `save_count_line`, y
`save_count_line` sella. O sea que el respaldo ya es estructural: no existe
otra puerta por la que entrar sin hora. Meter el sello también en el
disparador no cambiaría ni una fila y sería churn.

**Recomendación: no tocar nada, y dar el punto 6 por cerrado.** Las 829 son
historia y el encargo dice expresamente que no se rellenan.

### Lo que sí queda, y es pequeño

**278 líneas contadas cuyo recuento tiene `started_at` nulo.** Para ésas,
`cortes_aprobados` cae a `closed_at`/`created_at`. No lo arreglo porque no
está en el encargo y son históricas, pero queda apuntado: si alguna es
reciente, es el mismo daño por otra puerta.
