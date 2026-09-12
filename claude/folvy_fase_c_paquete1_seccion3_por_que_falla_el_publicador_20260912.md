# Fase C · paquete 1 · §3 · Por qué falla el publicador, medido

**12/09/2026, 10:37 (reloj de la base).** Todo `SELECT` y lectura de código.
Nada tocado.

Encargo de Julio (10:35): *«mide qué falla: qué marca, qué local, qué conexión y
desde cuándo; si es un permiso de la conexión, dilo y dime qué hace falta».*

---

## 0 · Lo primero: mi «falla 1 de cada 12» era una tasa histórica, no el estado

Lo dije en el §0 y hay que corregirlo antes de que alguien construya sobre ello.
**No hay un fallo recurrente. Hay cuatro fallos distintos, ninguno vivo hoy.**

| cuenta | destinos | en error | último error | última publicación |
|---|---:|---:|---|---|
| Foodint | 105 | **7** | 08/09 20:04 | **12/09 08:46** |
| Folvy Interno | 6 | 2 | 24/06 19:13 | 24/06 19:21 |

En los **últimos 30 días** hay **4 destinos en error**, y los cuatro están
explicados abajo. La publicación de hoy a las 08:46 salió bien.

---

## 1 · Los cuatro fallos, uno a uno

### (1) PERMISO DE LA CONEXIÓN — **esto lo arregla Julio, no yo**

| | |
|---|---|
| error | `{"message":"A 'catalog' write scope is required","error_type":"forbidden"}` |
| marca | **Bendito Burrito** |
| conexiones | **`Glovo Bridge - Bendito Burrito`** y **`Just Eat Flyt Bridge - Bendito Burrito`** |
| catálogo | `j99jm` |
| cuándo | **29/07/26 10:02**, una vez cada una. **No ha vuelto en 45 días.** |

**Qué hace falta:** esas dos conexiones puente de HubRise no tienen el permiso
de **escritura sobre `catalog`**. Se concede en HubRise, en los scopes de cada
conexión. No hay nada que tocar por nuestro lado.

**Por qué no ha vuelto a pasar:** desde entonces Bendito Burrito publica por la
conexión directa (`Bendito Burrito`, 9 veces ok, la última el 01/09), no por los
puentes. O sea que el permiso **sigue faltando**, simplemente ya no se usa ese
camino. Si algún día se vuelve a publicar por un puente, volverá a fallar igual.

### (2) CATÁLOGO QUE NO EXISTÍA — se resolvió solo el mismo día

| | |
|---|---|
| error | `{"message":"Catalog does not exist","error_type":"not_found"}` |
| marca / conexión | Bendito Burrito · `Uber Eats Bridge - Bendito Burrito` |
| cuándo | 29/07/26 **09:03**, una vez |

Esa misma conexión publicó **ok a las 09:11 y a las 10:02** del mismo día: el
catálogo se creó en medio. Nada que arreglar.

### (3) UN PRODUCTO SIN CATEGORÍA — **fallo nuestro, y ya está arreglado**

| | |
|---|---|
| error | `Validation failed · /products/9/category · not found ({'category_ref':'__uncat__'} given)` |
| marca | **Meraki Pita**, sus **dos** catálogos (`x77xp` y `dmmj9`) |
| cuándo | **19/08/26 08:29** |

Es la **regresión F1.6**, y está documentada dentro de la propia función: un
producto sin categoría salía con `category_ref: "__uncat__"` y esa categoría **no
viajaba en el catálogo**, porque `usesUncat` se ponía a `true` como efecto
secundario de una función que desde F1.6 se evalúa perezosamente, después del
`if` que añadía la categoría. HubRise rechaza una referencia que no existe, y la
marca entera dejaba de publicar.

**Está arreglado, con una comprobación anticipada y explícita**, y —regla 1— lo
he comprobado: **el arreglo está en git, no sólo en el desplegado.** Comparando
línea a línea el cuerpo desplegado con `supabase/functions/hubrise-catalog-publish/index.ts`,
la única línea que el repo tiene y el desplegado no es el comentario de ruta de
la primera línea; las 307 de más del volcado son los módulos `_shared` que vienen
en el mismo fichero.

### (4) `Retry later` — transitorio de HubRise, y el reintento funcionó

| | |
|---|---|
| error | `Retry later` |
| marca / conexión | Smash Brothers Burgers · `Smash Brothers Burgers`, catálogo `x77qy` |
| cuándo | **08/09/26 20:04**, dos veces |

**A las 20:05 del mismo día publicó ok.** Es el único de los cuatro para el que
«reintentar» es la respuesta correcta.

---

## 2 · Lo que esto le dice al botón del paquete 1

Los cuatro fallos son de **cuatro clases distintas**, y un botón que los trate
igual miente en tres de cada cuatro:

| clase | ejemplo | qué debe decir el botón | ¿sirve reintentar? |
|---|---|---|---|
| **permiso de la conexión** | `write scope is required` | «esta conexión no tiene permiso para escribir el catálogo en HubRise; hay que concedérselo allí» | **no** |
| **catálogo inexistente** | `Catalog does not exist` | «esa conexión todavía no tiene catálogo» | no, hay que crearlo |
| **dato nuestro** | `Validation failed` | el producto concreto y qué le falta | no hasta arreglar el dato |
| **transitorio** | `Retry later` | «HubRise ha pedido esperar» | **sí** |

Y el resultado va **por destino**, no global: una marca puede publicar bien en su
conexión directa y fallar en un puente, que es exactamente lo que pasó el 29/07.
Nunca un verde si un destino falló — eso ya lo dijo Julio, y los datos lo
respaldan.

---

## 3 · Un dato que sale de paso y no es un fallo, pero es un escaparate

**66 platos activos de Foodint no tienen categoría**, repartidos en 8 marcas:

| marca | platos activos | sin categoría |
|---|---:|---:|
| Chivuos | 56 | **18** |
| Big Mike´s Burger Joint | 58 | **14** |
| Dos Coyotes | 47 | 9 |
| Koreans do it better | 47 | 8 |
| Ay Mamita Bowls | 28 | 7 |
| Milanesa Haus | 41 | 5 |
| Deep Pizza | 30 | 4 |
| Birria Burrito | 28 | 1 |

Gracias al arreglo de (3) **esto ya no rompe la publicación**: salen bajo una
categoría llamada **«Sin categoría»**. Pero salen así **en Glovo, en Uber y en la
web**. No es avería y no abro nada; queda dicho porque es lo que ve el cliente.

---

## 4 · Resumen

- **No hay que arreglar el publicador.** Hay que hacer que el botón **cuente** lo
  que pasa, por destino y por clase de fallo.
- **Lo único pendiente de Julio en HubRise:** el permiso `catalog` de escritura
  en `Glovo Bridge - Bendito Burrito` y `Just Eat Flyt Bridge - Bendito Burrito`.
  Hoy no molesta porque no se publica por ahí, pero el permiso falta.
- **Y 66 platos salen como «Sin categoría»** en las plataformas.
