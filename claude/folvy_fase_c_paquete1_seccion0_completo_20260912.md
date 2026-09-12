# Fase C · paquete 1 · §0 completo · medido sin tocar

**12/09/2026, 10:46 (reloj de la base).** Todo `SELECT` y lectura de código.
Nada escrito.

El encargo ya está en el repo (`claude/ENCARGO_CODE_modificadores_fase_C_pantallas_20260911.md`).
Hasta las 10:45 de hoy vivía fuera, y por eso el §0 iba a ciegas en todo lo que
no fuera el §0.1.

**Tres cosas que mido contradicen el encargo. Van primero, porque gana lo medido.**

---

## A · LAS TRES CONTRADICCIONES

### A1 · El extra detrás de una opción NO vive donde el encargo supone

El tablero 2 pide pintar «el extra detrás: Extra «Salsa Yogur» · en 13 opciones».
Esa relación existe, pero **no está donde parece**:

| | |
|---|---|
| `modifier_option.recipe_item_id` | **0 de 241** · la columna existe y **nadie la ha usado nunca** |
| `modifier_recipe_impact.target_recipe_item_id` | **104 opciones** con impacto → **54 extras distintos** |
| opciones sin ningún impacto (ni propuesto) | **137** |

Y **no es 1:1**: 104 opciones tienen **115** impactos. Una opción puede llevar
más de un extra detrás (los 42 `bundle`, por ejemplo).

**Consecuencia para quien construya:** «el extra detrás» se lee de
`modifier_recipe_impact`, nunca de `modifier_option.recipe_item_id`. Esa columna
a NULL es una trampa de la regla 30: buscar el nombre en la lista equivocada y
caer a un literal de reserva.

Y el subtítulo honesto: **eso era trabajo de la fase B.** El encargo dice que se
entrega «cuando la fase B esté cerrada» (el extra existe una sola vez). No lo
está. El paquete 1 se puede construir igual, pero el campo «el extra detrás» se
pinta de lo que hay, y hay que decir en pantalla cuando una opción lleva más de
uno.

### A2 · Los permisos NO son los mismos que los de Extras

El §0.3 dice «los mismos permisos que la escritura de Extras (administrador o
encargado de la cuenta)». Medido:

| tabla | escribe si |
|---|---|
| `recipe_item` — **la vara de Extras** | `current_user_is_admin_or_manager_of()` → admin **o encargado** |
| `modifier_group`, `modifier_option`, `modifier_group_assignment`, `modifier_recipe_impact` | `current_user_is_admin_of()` → **sólo admin** |

**Pero hoy la diferencia es inerte, y hay que decir las dos cosas:** en toda la
base **no existe ni una sola persona con rol `manager`**. Los roles que hay son
`admin` y `worker`:

| cuenta | admin | worker |
|---|---:|---:|
| Foodint | 1 | 6 |
| Folvy Interno | 1 | 3 |
| Kitchen Grill LstQ | 1 | 0 |

Así que hoy sólo el administrador escribe, en Extras y en modificadores por
igual. **La diferencia muerde el día que exista un encargado**, y ese día Extras
funcionará y Modificadores no, en silencio y desde la RLS.

**Propongo** —y es propuesta, porque ampliar quién escribe en producción no es
un arreglo, es una decisión— alinear las cuatro políticas a
`current_user_is_admin_or_manager_of`, que es lo que el encargo pide. Es una
migración pequeña, no toca pedidos, consumo ni stock, y por tanto no tiene banda.
**No la aplico sin tu visto.**

### A3 · «Preguntas en ningún plato» son 15, no 5

El encargo cita el caso del 11/09: los dos combos Smash archivados el 08/09
dejaron **5 preguntas con 22 opciones**. Medido hoy en Foodint, contando todas
las preguntas que no están en ningún plato **activo**: **15 preguntas y 45
opciones**. El caso de Smash es un subconjunto, no el total. La sección aparte
del tablero 1 tiene que contar con 15, no con 5.

---

## B · §0.1 · El publicador (hecho aparte, resumen)

Detalle completo en `claude/folvy_fase_c_paquete1_seccion3_por_que_falla_el_publicador_20260912.md`.

- **Lo dispara una persona**, no un cron: `hubrise-catalog-publish` es POST con
  JWT. Lo llaman `catalogPublishService` (front) y `hubrise-brand-connect`.
- **Publica** el catálogo entero de una marca; los modificadores viajan como
  `option_lists` desde asignación → pregunta activa → opciones activas, y **una
  pregunta sin opciones válidas se descarta**.
- **Tarda** 1,5 s de mediana sobre 100 publicaciones (mín. 0,7, máx. 19,1).
- **Falla en cuatro clases distintas**, ninguna viva hoy, y **reintentar sólo
  sirve para una** (`Retry later`).

→ El aviso «Pendiente de publicar en Glovo, Uber y la web» **hace falta**, y el
botón tiene que dar el resultado **por destino**.

---

## C · §0.2 · Qué pantallas tocan hoy preguntas, opciones y sus platos

| pantalla | ruta real | qué hace | qué pasa con ella |
|---|---|---|---|
| **Pestaña Modificadores de la ficha del plato** — `ModifierEditorSection` + `ModifierImpactsTab` | dentro de `CatalogFichaPage` (líneas 1150 y 1175) | crear pregunta *para ese plato*, asignar una existente, editar opciones, y decidir impactos | **Se queda.** Es donde se ve un plato concreto, como dice el encargo |
| **`SalesExceptionsPage` «grupos»** | **no tiene ruta propia**: se pinta dentro de `KitchenMenuPage` (`/kitchen/menu`) con un `useState` (`showExceptions`), líneas 1180-1181 y 1212 | lo que llega de ventas y no casa | Es el antecesor del **tablero 7**, que va en el **paquete 3** |
| **Extras** | `/kitchen/extras` (`KitchenExtrasPage`), carril «Extras» | los extras y su escandallo | Es la **vara de construcción** y gana su ficha en el **paquete 2** |

El carril nuevo «Modificadores» va al lado de `kitchen_extras`, que hoy se declara
así: `requiredRole: 'manager'`, `requiredPermission: 'show_costes'`. La copia es
directa — pero **la puerta de verdad es la RLS de A2, no el carril**.

### Y el segundo camino, dicho

El paquete 1 crea un **segundo sitio** donde se crea una pregunta: hoy sólo se
puede desde la ficha del plato (`createGroupForProduct`, siempre atada a un
plato). El encargo lo pide y la pestaña se queda, así que **no es un descuido:
es una decisión tomada**. Queda dicho aquí para que no parezca lo otro.

---

## D · §0.3 · Quién puede editar

Contestado en A2. Resumen: hoy, **sólo el administrador de la cuenta**, tanto en
Extras como en modificadores, porque no hay ningún encargado en la base.

---

## E · §0.4 · Cómo se ven hoy los datos del tablero 1 (Foodint)

Las cinco cifras de la cabecera, con la consulta que usará la RPC:

| # | cifra | hoy |
|---|---|---|
| 1 | preguntas (con sus opciones) | **65 preguntas · 241 opciones** |
| 2 | platos con alguna pregunta, de cuántos | **137 de 595** platos activos |
| 3 | repetidas (mismo nombre en la misma marca) | **4 nombres, 12 preguntas** implicadas |
| 4 | opciones frente a extras distintos | **241 opciones → 54 extras** (y 137 opciones sin ninguno) |
| 5 | opciones sin decidir qué llevan | **137 sin decidir, 45 de ellas cobran** |

Y el corte propias / cedidas, que manda el orden de la lista:

- **propias 14** (`external_source` nulo) · **de Last 51** (`external_source = 'lastapp'`).
- Por tipo: `choice` 46 · `extras` 12 · `removal` 6 · `cross_sell` 1.
- Activas **56**, apagadas **9** → la lista enseña **65**, con las 9 etiquetadas
  y ordenadas abajo (regla 7, y decisión tuya de las 10:35).
- Sección aparte: **15 preguntas en ningún plato activo, con 45 opciones** (A3).

**La plantilla no entra en ninguna cifra.** `Folvy Interno`
(`00000000-…-0001`) tiene 44 preguntas, 163 opciones y 220 asignaciones con los
mismos nombres. Toda consulta de estas pantallas lleva `account_id` (regla 9).

---

## F · Lo que necesito para arrancar el §1

1. **Visto o no** a la migración de permisos de A2.
2. Cómo quieres que el tablero 2 pinte **una opción con más de un extra detrás**
   (A1): hoy son 115 impactos en 104 opciones.
3. **La maqueta.** El encargo la cita como artifact
   `51e7d1ea-da4d-4c64-a835-dc0eda650dde`, versión 2. No la tengo, y el §1 dice
   «fiel a la maqueta, no al estilo de hoy de la app». Sin verla no puedo
   construir fiel: puedo hacer una pantalla razonable, que es justo lo que el
   encargo prohíbe. Pásamela como pasaste el encargo.

Con esas tres, el §1 empieza.

---

# ADENDA · 11:05 · la franja del tablero 1, medida — y dos varas mías rotas

La franja es lo único del tablero 1 que no estaba medido. Al medirla me he
equivocado dos veces, y las dos merecen quedar escritas porque son trampas que
volverán.

## G1 · «Descuentan» NO se mide por `stock_movement.sale_line_id`

Mi primera vara preguntaba si la **línea del extra** tenía un movimiento con su
llave. Dio **0 de 1.378**, y no era verdad: el consumo de un extra se escribe
colgando de la **línea del producto**, no de la del modificador —
`_sale_line_raw_consumption` de la línea del plato ya trae dentro lo que aporta
el modificador, y `base` agrupa por la línea del plato.

Si la franja se hubiera construido con esa vara, **habría nacido diciendo 0 %**
el día 1, con el almacén funcionando bien. La vara buena es: *el extra que la
opción tiene decidido, ¿tiene movimiento en esa venta?*

## G2 · El mismo NULO de esta mañana, otra vez

`(mg.external_source = 'lastapp')` da **NULL** para una marca propia, no `false`.
Mi recuento salió «cedidas 1.087 · propias 0 · sin saber 291». Las 291 son
**propias**. Con `COALESCE(external_source,'propia')`: **lastapp 1.087 · propia
291**. Es exactamente el agujero de la guarda de las 08:56, en otra consulta y
cinco horas después. Va a la lista: **cualquier comparación con una columna que
admite NULL se escribe con COALESCE o con `IS NOT DISTINCT FROM`.**

## La franja, con las varas corregidas (Foodint, 30 días)

| | |
|---|---:|
| líneas de extra vendidas | **1.378** |
| de marca cedida · de marca propia | 1.087 · 291 |
| con «qué lleva» decidido | **859** |
| sin decidir | **519** |
| que Folvy no conoce | **0** |
| **descuentan del almacén** | **281 · el 20 %** |

La maqueta pone 59 % (827 de 1.393) como ejemplo; la verdad de hoy es **20 %**.

### Y una pregunta que sale de ahí y no es mía

**859 tienen decidido qué llevan y sólo 281 descuentan.** Los 578 de diferencia
pueden ser tres cosas legítimas —protegidos por el corte, frenados por precio
indefendible, o que la receta del plato ya los lleve y el extra sustituya en vez
de sumar— o una avería. **No lo he medido, y no lo pinto hasta saberlo**: una
franja que diga «el 20 %» sin distinguir eso es un número que asusta sin
enseñar. Eso es tablero 7, paquete 3.

Para el paquete 1 propongo que la franja diga las cuatro cifras que **sí** están
medidas (vendidas, con qué lleva, sin decidir, y las que Folvy no conoce) y deje
el porcentaje para cuando el tablero 7 pueda explicarlo.

## Lo que me falta para cerrar la RPC del tablero 1

**La pastilla «N vendidas antes de llegar».** Está en la maqueta y no sé
definirla sin inventármela: ¿ventas de una opción con fecha anterior a la de la
propia opción en Folvy? ¿O las que entraron por la cola de excepciones antes de
enlazarse? Dímelo y la pinto; mientras, la RPC no la devuelve y la fila no la
enseña (regla 35).
