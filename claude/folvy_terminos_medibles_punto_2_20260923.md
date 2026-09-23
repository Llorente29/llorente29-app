# Punto 2 — La versión del escandallo, viva

**23/09, 23:3x Madrid.** Encargo CODE «Que los términos de la resta sean medibles».
Escrito y ensayado; **NO aplicado**: la ventana prohibida es 12:15–00:30. Va después.

---

## 1. La tabla lleva tres meses muerta, y dos sitios del motor lo citan

Medido antes de escribir una línea de código:

| | |
|---|---:|
| `recipe_item_version` | **1 fila**, de **1 ficha**, creada el 30/06 |
| de esa fila, de Foodint | **0** |
| disparadores en la tabla | **0** |
| crons | **0** |
| fichas con escandallo | **244** (169 Foodint + 75 plantilla) |
| líneas de escandallo en Foodint | 1.575 |
| líneas **editadas** alguna vez | **94**, en 63 fichas, del 15/06 al 20/09 |

El modelo era «hito manual»: un botón en la pestaña Histórico. **No se ha pulsado
nunca.** Y la deuda ya estaba escrita dentro del motor, en dos sitios:

```
generate_sale_consumption, línea 258:
  «distinguirlas pediría comparar versiones de escandallo que no existen:
   recipe_item_version tiene 1 fila»
  → la nota de «ya no lo pide» no puede decir CUÁL de las tres causas es.

sale_line_cost_sweep, líneas 37-44:
  «de las 606 líneas reparables de toda la vida, 598 (98,7 %) se costearían con
   una receta tocada DESPUÉS de la venta, y recipe_item_version tiene 0 filas.
   Escribir el coste de hoy sobre una venta del 7 de junio es inventar una cifra
   con cara de medida.»
  → la ventana de 30 días es una renuncia, no un diseño.
```

> **Una cuenta mía que corrijo antes de que la leas.** Mi primera medida decía
> «501 líneas tocadas en 30 días». Falso: 496 de ellas eran líneas **creadas**
> (la carta de kebab), no editadas. Separando `created_at` de `updated_at` salen
> las 94 de arriba. La consulta tiene que medir lo que uno cree que mide.

## 2. Lo hecho — `20260924T0045_el_escandallo_se_sella_solo.sql`

**El escandallo se sella solo.** Cada alta, edición o baja de línea, y cada
cambio de nombre o de raciones, deja una versión con su foto y su coste. Hacia
delante, que es tu regla del 12/09.

Tres decisiones que no son obvias:

- **Un solo constructor de foto** (`_recipe_snapshot`), que usan el camino a mano
  y el automático. Si cada uno se hiciera la suya, `diffSnapshots` acabaría
  enseñando cambios fantasma. Es la familia de la regla 30.
- **Una edición de doce líneas es UNA decisión, no doce.** Dentro de la misma
  transacción la versión en curso se corrige en sitio en vez de encadenar doce.
- **El coste NO dispara sellado.** Cambia cada vez que se mueve el precio de
  cualquier ingrediente, en cascada; llenaría la historia de versiones con la
  misma receta dentro. El coste viaja igual, refrescado sobre la versión viva.

**Y una columna nueva, `is_auto`, que por poco no existe.** `restore_recipe_version`
guarda el estado actual como versión —esa es su red— y **luego** reescribe las
líneas. Sin distinguir automático de manual, el sellado de esas líneas habría
sobrescrito justo la foto que era la red. Salió pensando el caso, antes de
aplicar; la prueba B7 lo cierra.

**La semilla: 244 fichas, la foto de HOY, dicha como lo que es.** Su nota dice
literalmente *«Semilla del 24/09: es la foto de HOY, no el origen de la receta.
Antes de esta fecha no hay versiones guardadas y no se pueden inventar»* — para
que nadie lea «v1 · 24/09» y concluya que la receta nació ese día (regla 30).

## 3. El ensayo — `claude/folvy_sellado_escandallo_ensayo_20260923.sql`

Todo en transacción revertida. **9 comportamientos, 9 OK.** Detalle en el fichero.

Y los **cuatro caminos** (regla 10), como usuario real de la cuenta:

| camino | movs antes | después | versiones | |
|---|---:|---:|---|---|
| cerrar una venta (regenerar consumo) | 14 | 14 | 169→169 | OK |
| recibir un albarán (confirmar) | 15 | 15 | 169→169 | corrió limpio, **0 escrituras nuevas** |
| apuntar una merma | 0 | 1 | 169→169 | OK |
| aprobar un recuento | 20 | 22 | 169→169 | OK |

**El camino del albarán es el hallazgo, y lo digo** (regla 10 lo pide): corrió sin
excepción y no perdió nada, pero no escribió movimientos **nuevos**, porque las 15
líneas posteables de ALB-00173 ya estaban posteadas —`adjust_goods_receipt_line`
las postea según se casan— y las 2 que quedaban las marqué yo como no mercancía.
De los cuatro, es el único cuya **escritura** no he llegado a ejercer sobre un
borrador virgen. Los otros tres escriben.

La última columna es idéntica en los cuatro, y es lo que importa: **el sellado no
se mete en el camino del pedido.** Y no podía: medido, las únicas siete funciones
que escriben `recipe_line` son de catálogo (`add_ingredient_to_recipes`,
`duplicate_recipe_item`, `materialize_recipe_session`, `migrate_kitchen_core`,
`remove_ingredient_from_recipes`, `restore_recipe_version`,
`substitute_ingredient_in_recipes`) y ninguna corre al vender.

## 4. Lo que esto NO hace, y hay que decirlo

- **No inventa el pasado.** Sellar desde hoy no le da a `sale_line_cost_sweep` la
  receta del 7 de junio. Su ventana de 30 días **sigue siendo correcta** y sigue
  donde está. Lo que cambia es que dentro de un mes ya habrá cadena, y esa
  ventana se podrá discutir con datos en vez de con una renuncia.
- **No sella la versión EN la venta.** Eso pide una columna en `sale_line`
  —camino del pedido— y tocar el motor de consumo: las dos cosas prohibidas en
  este encargo. Y resulta que **no hace falta una columna**: `valid_from`/`valid_to`
  ya contestan «qué receta regía el 12/09 a las 21:40». Ese cable lo tira el
  encargo que lo use; yo no dejo un lector que nadie llama, que es exactamente
  el error que acabo de diagnosticar en el punto 4 con `receiptsQtyBase`.
- **No toca los pasos** (`recipe_item_step`). Viajan en la foto pero no disparan
  sellado: no afectan ni al coste ni al consumo. Dicho, no escondido.

**Lo visible hoy:** la pestaña **Histórico** de 244 escandallos deja de estar
vacía, y a partir de mañana cada cambio deja su fila con el impacto económico que
esa pestaña ya sabe calcular. Es lo que prometía desde el 30/06.

## 5. Banda y estado

Crea disparadores sobre `recipe_line`, y eso toma **ACCESS EXCLUSIVE** sobre una
tabla que `_sale_line_raw_consumption` y `compute_sale_line_cost` leen en **cada
pedido**. Espera a la noche por la banda, y además por tu condición de este
encargo.

- Migración **escrita, ensayada, NO aplicada**. Va con la del punto 4, después de las 00:30.
- **Sin cambio de front**: la pestaña ya pinta `change_note`, y `is_auto` es una
  columna que el cliente ignora. Nada que compilar, nada que publicar.
- No toca el motor de consumo. No reprocesa ni una venta. No reescribe ni una
  fila ya escrita.
