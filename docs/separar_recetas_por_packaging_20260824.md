# Separar 5 recetas compartidas que llevaban packaging de otra marca

Fecha: 24/08/2026 · **Migración aplicada a producción y verificada.** Solo datos:
cero cambios de motor SQL, cero front. `App.tsx` sin tocar.

## Lo entregado

Seis recetas nuevas (dos marcas se separan de la misma receta en el caso 2), con
toda la comida idéntica y solo el packaging cambiado, y su `menu_item`
reapuntado. La marca dueña del packaging actual se queda con la receta original.

| # | Receta | Se queda | Copia nueva | Cambio de packaging |
|---|---|---|---|---|
| 1 | Burrito Colosal de Cochinita | Birria Burrito | **(Bendito)** | Bolsa Birria → kraft |
| 2 | Burrito Tremendo Birria Ternera | Birria Burrito | **(Bendito)** | Bolsa Birria → kraft |
| 2 | ” | ” | **(DC)** | Bolsa Birria → Bolsas Dos Coyotes |
| 3 | Quesadilla de Pollo | Birria Burrito | **(Bendito)** | Bolsa Birria → kraft |
| 4 | Quesatacos Carnitas | Dos Coyotes | **(Bendito)** | Caja DC → genérica 1350ml · Bolsa DC → kraft · Papel antigrasa DC → pergamino blanco |
| 5 | Quesatacos Birria Ternera | Bendito Burrito | **(DC)** | *(añade)* Bolsas Dos Coyotes |

## La prueba de que la fuga se ha cerrado

Consultado después de aplicar, «qué packaging de marca ajena ve hoy cada ficha»:

| Marca | Producto | Packaging de marca |
|---|---|---|
| Bendito | Burrito Colosal de Cochinita | **(ninguno)** |
| Bendito | Burrito Tremendo de Birria de Ternera | **(ninguno)** |
| Bendito | Quesadilla de Pollo | **(ninguno)** |
| Bendito | Quesatacos Birria Ternera | **(ninguno)** |
| Bendito | Quesatacos Carnitas | Soporte Caldo Caja Dos Coyotes *(tu decisión)* |
| Birria Burrito | sus 3 | Bolsas Personalizadas Birria Burrito |
| Dos Coyotes | sus 3 | solo packaging Dos Coyotes |

Y las líneas cuadran una a una: cada copia tiene **exactamente** las mismas
líneas de comida que su origen (11/11, 11/11, 8/8, 8/8) y el mismo número de
líneas de packaging, salvo el caso 5 que suma la bolsa (3 → 4).

## Tres cosas del encargo que no eran como venían

**1 · Quesatacos Carnitas tenía CUATRO packagings de Dos Coyotes, no dos.**
El encargo nombra Caja y Bolsa. También llevaba «Soporte Caldo Caja Dos Coyotes»
y «Papel Antigrasa Dos Coyotes» — este último con la marca impresa, que el
cliente de Bendito ve. Te pregunté y elegiste: **el papel pasa a genérico, el
soporte se mantiene**. No existe «papel antigrasa genérico» en el catálogo (los
dos que hay son de marca, Dos Coyotes y Fitipaldi), así que usé el **Envoltorio
Pergamino 31x31 blanco**, que es el envoltorio neutro que ya usan los dos
burritos. Queda anotado que el soporte está diseñado para la Caja DC y la copia
usa la genérica.

**2 · El espejo no hacía falta tocarlo, pero deja una deuda.**
«Burrito Colosal de Cochinita ★» (`36e47125`) es la versión promo del de Bendito.
Tiene **`recipe_item_id = NULL`**, así que no arrastraba la receta y reapuntar el
original bastó. Pero eso significa otra cosa: **la versión promo no descuenta
stock ni tiene coste**. Es el mismo defecto que los duplicados de la ingesta de
Last. No lo toco aquí porque no es este encargo, pero cuando esa promo esté
activa se vende a ciegas.

**3 · `pg_get_functiondef` no aplica.**
Lo pedías como verificación, pero esta migración **no crea ni modifica ninguna
función**: son datos (6 `recipe_item`, sus `recipe_line`, y 6 `UPDATE` de
`menu_item`). Verificar con `pg_get_functiondef` habría devuelto lo mismo antes y
después. Lo sustituí por lo que sí prueba algo: los guardas dentro de la propia
transacción (si las líneas no cuadran, si no salen 6 recetas, si no se reapuntan
6 `menu_item`, o si queda **una sola** línea con el packaging viejo, la
transacción entera se cae) más las consultas de arriba, hechas después.

## 🔴 El coste: hay que recostear, y hay un cero que no es cero

Las 6 copias nacieron con el `computed_cost` heredado del origen y con
`needs_review = true`. **Están sin recostear.** No puedo lanzar
`kitchen_recompute_item` desde aquí: su guarda `belongs_to_account` necesita un
`auth.uid()` que por MCP viene nulo. **Te toca darle a «Recostear todo».**

Y antes de hacerlo, un aviso que sale de leer el motor:

```sql
v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
```

| Envase | computed_cost | fixed_cost | lo que usará el motor |
|---|---:|---:|---:|
| Bolsas Personalizadas Birria Burrito | 0,21508 | — | 0,21508 |
| Bolsas Dos Coyotes | 0,17048 | — | 0,17048 |
| CAJA GENERICA 1350Ml | 0,09360 | 0,2838 | 0,09360 |
| Envoltorio Pergamino 31x31 | 0,02800 | 0,028 | 0,02800 |
| **Bolsas de papel kraft** | **0,00000** | **0,093** | **0,00000** ⚠️ |

La bolsa kraft tiene `computed_cost = 0`, y como `COALESCE` coge el primero **no
nulo**, el cero gana a los 0,093 € del `fixed_cost`. Al recostear, **las tres
copias de Bendito contarán la bolsa a 0 €**. No lo causa esta migración —el
artículo ya estaba así y afecta a cualquier receta que use kraft— pero se nota
ahora porque acabamos de meterlo en tres platos. Se arregla recosteando ese
artículo de packaging, o poniendo su `computed_cost` a NULL para que mande el
`fixed_cost`. Dime cuál prefieres y lo preparo; no lo toco por mi cuenta porque
es cambiar un coste de compra.

Con ese matiz, el coste de packaging queda así (calculado a mano, no por el
motor, usando `fixed_cost` cuando `computed_cost` es 0):

| Receta | € packaging |
|---|---:|
| Burrito Colosal Cochinita — Birria / **Bendito** | 0,4974 / **0,4364** |
| Burrito Tremendo — Birria / **Bendito** / **DC** | 0,4790 / **0,4179** / **0,4567** |
| Quesadilla Pollo — Birria / **Bendito** | 0,5462 / **0,4851** |
| Quesatacos Carnitas — DC / **Bendito** | 0,8974 / **0,6114** |
| Quesatacos Birria Ternera — Bendito / **DC** | 0,1278 / **0,2982** |

## Un detalle que dejo literal y señalo

En el Burrito Tremendo, la bolsa va a **0,5 ud** por plato (una bolsa cada dos).
La copia de Dos Coyotes hereda ese 0,5, mientras que el otro plato de DC
(Quesatacos Carnitas) cuenta **1 bolsa** por plato. Copié la cantidad del origen
porque el encargo decía «cambiar solo la línea de packaging», pero las dos no
pueden ser ciertas a la vez. Si en DC va una bolsa por pedido, es un `UPDATE` de
una línea.

## Grupo B y lo que se queda como está

**Tequeños (`7818bfae`) — deuda documentada, no tocada.** Verificado: los
comparten **12 marcas** (Ay Mamita Bowls, Big Mike´s, Birria Burrito, Chivuos,
Deep Pizza, Dirty Burger, Dos Coyotes, Mila's Sandwiches, Milanesa Haus,
Milanesa House, Scandal Burgers, Smash Brothers). Tienes razón en el diagnóstico:
**añadir la bolsa personalizada a tres de ellas es imposible sin separar la
receta**, porque la línea de packaging es de la receta, no del `menu_item`.
Separar aquí costaría 3 recetas nuevas para 3 marcas y dejaría 9 en la
compartida — hacedero, pero es otro encargo y con 12 marcas conviene decidir
antes si el sitio correcto para esto es un packaging por marca en el `menu_item`
en vez de multiplicar recetas.

**Nachos (`bef71b9a`, 2 marcas) y Patatas (`16416b15`, 10 marcas):** sin tocar.
Su packaging es genérico y correcto.

## Reversión

`REVERT_20260824T1200_separar_recetas_por_packaging.sql`: devuelve los 6
`menu_item` a su receta compartida y borra las 6 copias (sus líneas se van solas
por el `ON DELETE CASCADE` de `recipe_line.parent_item_id`, verificado en
`pg_constraint`). Seguro **mientras nadie haya editado las copias a mano**; el
propio fichero lleva la consulta para comprobarlo antes.
