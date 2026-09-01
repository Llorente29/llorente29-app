# RECON — Los modificadores y el consumo

**Fecha:** 31/08/2026, noche. **Encargo:** «Los modificadores no existen para el sistema».
**Método:** consultas contra producción (proyecto Folvy), cuenta Foodint
`51ad1792-6629-4ef7-833a-b57b09a86710`, filtrando por `account_id` en todo (regla 9).

Resumen en una línea: **el encargo acierta en el síntoma y falla en dos de las tres causas.**
El punto 1 ya está construido y funciona. El punto 2 apunta a una columna que el motor no
lee. Y hay una causa que el encargo no contempla y que explica el desvío que más duele.

---

## 1 · El punto 1 ya existe. Verificado en el ledger.

El encargo dice: *«El motor solo descuenta recorriendo `recipe_line`, así que un producto cuyo
consumo es "una unidad de sí mismo" no descuenta nunca, por definición.»*

No es así. `explode_recipe_to_raws` tiene condición de parada por hoja:

```sql
IF v_item.type IN ('raw', 'tool')
   OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
  raw_item_id := p_item_id;  qty_base := p_multiplier;  RETURN NEXT;  RETURN;
END IF;
```

Un `menu_item` que apunta a un artículo `raw` sin escandallo devuelve **una unidad de sí mismo**.
Es exactamente la regla que el encargo pide construir.

Comprobado sobre ventas reales de los últimos 7 días, motor y ledger a la vez:

| Línea vendida | Artículo | Tipo | Líneas de escandallo | Motor devuelve | `stock_movement` |
|---|---|---|---|---|---|
| Agua Mineral 50 CL (31/08 17:00) | Agua Mineral 50 CL | `raw` | 0 | 1 fila, qty 1 | `qty_base = −1.0`, «Consumo por venta» |
| Fanta Limón Lata (30/08 22:42) | Fanta Limón Lata | `raw` | 0 | 1 fila, qty 1 | `qty_base = −1.0` |
| Fanta Limón. (30/08 19:18) | Fanta Limón Lata | `raw` | 0 | 1 fila, qty 1 | `qty_base = −1` |

La verificación 1 del encargo («Vender una Coca-Cola descuenta una lata. Hoy no descuenta nada»)
**ya pasa hoy**. Si las latas aparecen agotadas de golpe, la causa está en otro sitio y hay que
buscarla; no es que no descuenten.

### El RECON que el propio punto 1 pedía

*«Comprobar que ningún producto compuesto está hoy sin escandallo por descuido.»* Sale limpio:

| Tipo del artículo | Sin escandallo | Activos | Total |
|---|---|---|---|
| `dish` | no | 252 | 261 |
| `dish` | **sí** | **0** | 1 |
| `raw` (stockable) | sí | 135 | 135 |
| `raw` (no stockable) | sí | 15 | 16 |

Un solo `dish` sin escandallo en toda la cuenta, y está inactivo. **Ningún producto compuesto
activo está hoy sin escandallo.** No hay nada que listar ni que decidir.

---

## 2 · El motor no lee `modifier_option.recipe_item_id`. Lee `modifier_recipe_impact`.

El encargo propone rellenar `modifier_option.recipe_item_id` para desbloquear el consumo.
`_sale_line_raw_consumption` no menciona esa columna ni una vez. Las cuatro ramas de
modificador del motor entran todas por aquí:

```sql
JOIN modifier_recipe_impact mri
     ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
```

Rellenar la columna no hace descontar nada. Lo que desbloquea el consumo es el **impacto**.

Eso no deja la columna sin sentido: es el vínculo directo artículo ↔ opción, que es justo lo
que necesita la cascada del 86 (punto 3, «agotar el artículo agota sus opciones»). Sirve, pero
para el punto 3, no para el 2.

### Y no son 0 opciones mapeadas: son 22

| | Foodint |
|---|---|
| Opciones de modificador | 230 (226 activas) |
| Con `recipe_item_id` | **0** |
| Impactos confirmados | **22**, sobre 22 opciones distintas |

Los más vendidos del 30–31/08 **sí** tienen impacto: Base Ternera 9 · Base Pollo 9 ·
Patatas Clásicas 8 · Smash Bacon Cheeseburger 7 · Sweet Chili 5 · Sin pepinillos 2.

(De paso: los recuentos del encargo suman opciones homónimas de marcas distintas. «Salsa
Tzatziki (Recomendada)» son cuatro filas de opción —5, 3, 2 y 1 ud—, no una de 12. «Base Pollo
(The OG)» son dos, y **una tiene impacto y la otra no**.)

---

## 3 · La causa que el encargo no contempla: 22 impactos confirmados que aportan cero

Este es el hallazgo. Los impactos existen, están confirmados, y **el motor los descarta en
silencio** por tres razones distintas. Ninguna de las tres avisa a nadie.

| Fallo | Opciones | Qué pasa | Desvío que explica |
|---|---|---|---|
| **`unit_id` nulo** | Base Pollo (The OG), Base Ternera (Premium Selection) | `_qty_in_base` hace `SELECT … WHERE id = NULL`, no encuentra, devuelve `NULL`, y el motor hace `CONTINUE` | **Milanesa Ternera −39,1 %** |
| **Dimensión no convertible** | Sweet Chili T (impacto en Gramo, artículo en Mililitro, sin fila en `recipe_item_unit_conversion`) | mismo `NULL`, misma salida silenciosa | Salsas (Coreana, Melt) |
| **`impact_type = 'none'`** | Con Pepinillos, 20 g | no cae en ninguna rama del motor: las ramas cubren `add_item`/`bundle`/`replace_item`, `remove_item` y `multiply` | **Pepinillos −51,7 %** por el lado del extra |

**Por qué el pollo cuadra y la ternera no**, que es la pregunta que hacía el encargo: los dos
impactos tienen el `unit_id` nulo y los dos aportan cero. Pero el escandallo del plato **ya lleva
el pollo** —es la base por defecto—, así que el pollo se descuenta por la línea del plato y
cuadra. La ternera es la **sustitución** que nunca se aplica. Medido: Milanesa de Pollo 11/11
descuentan; Milanesa Ternera 5/11.

Un detalle menor, por completitud: hay 3 movimientos de `consumo` **positivos** (+120 g de
pepinillos en 30 días), de platos cuyo escandallo lleva menos de 20 g y reciben un
`remove_item` de 20. `generate_sale_consumption` inserta cada crudo por separado sin el
`HAVING SUM(qty_base) > 0` que sí tiene `compute_sale_line_consumption`, así que el neto
negativo entra como entrada de stock. Son 120 g: ruido, no la causa del −51,7 %.

---

## 4 · Y la medición del encargo cuenta mal los modificadores

La tabla del encargo dice «Modificadores 120 → 0 descuentan». El motor **nunca** devuelve nada
para una línea de modificador, por diseño:

```sql
IF COALESCE(v_line.line_type, 'product') <> 'product' THEN
  RETURN;  -- modifier/combo_item no conducen; lo hace su padre product
END IF;
```

El consumo del modificador lo emite la línea **padre**. Medido en la línea del modificador da
siempre 0, tenga impacto o no. Lo mismo con los componentes de combo (55 → 26 es la misma
ilusión). El 57 % del encargo mide en el sitio equivocado; el número honesto no es ese.

---

## 5 · Lo construido esta noche: el punto 5

El punto 5 no depende de nada de lo anterior y sale entero, porque el hallazgo del §3 lo hace
más necesario, no menos: hay tres caminos por los que el motor devuelve «nada» sin decirlo.

`avt_consumption_coverage(p_count_id)` mide, en la ventana del conteo:

- **por artículo**: cuántas ventas *deberían* haberlo tocado (su escandallo llega hasta él, sea
  por el plato, por un componente de combo o por el impacto confirmado de un modificador) y en
  cuántas el motor lo devolvió de verdad. La diferencia es el hueco **demostrable**.
- **del periodo**: líneas vendidas, con consumo, sin mapear, y modificadores sin vínculo o
  mudos. Son los huecos **no atribuibles**: no se pueden repartir por artículo sin inventar.

Validada contra INV-00194 (Foodint Alcalá, 30/08 17:42 → 31/08 17:37):

```
23 artículos contados. El único con hueco: Milanesa Ternera Rebozado, 5 de 11.
Los otros 22 al 100 % — Queso Cheddar 14/14, Pepinillos 14/14, Carne de Birria 13/13,
Salsa Coreana 8/8, Salsa Melt 3/3, Tequeños 3/3, Sal 35/35.
Periodo: 115 líneas vendidas · 106 con consumo · 7 sin mapear ·
         54 modificadores (37 sin vínculo, 9 mudos, 8 aportan) → cobertura 67,5 %.
```

Que sea un bisturí importa: si silenciara las 23 filas, la pantalla dejaría de servir y el
operario aprendería a ignorarla. Silencia una.

**Lo que cambia en pantalla.** La cobertura va en la cabecera del conteo **siempre**, calculada.
Y una causa deja de proponerse si se apoya en la *ausencia* de evidencia —«no hay merma
registrada, luego se sirvió de más»— y no hemos medido todo. Las que se apoyan en evidencia
*positiva* (merma registrada en el ledger, teórico negativo, escandallo sin revisar) se
mantienen: no son hipótesis. El filtro usa la `confidence` que el propio clasificador ya declara,
así que no se queda desactualizado cuando alguien añada una hipótesis nueva.

Falla **cerrado**: si la cobertura no se puede medir, no se propone causa. No saber si medimos
el consumo no es lo mismo que haber medido y salir limpio.

Y la fila **no desaparece** (regla 7): sigue con su desviación y sus euros. Lo que se sustituye
es la causa inventada por el hueco declarado.

---

## 6 · Lo que queda, y lo que hay que decidir

- **Punto 1** — no hay nada que construir. Si las latas se agotan de golpe, es otro problema.
- **Punto 2** — reescribir contra `modifier_recipe_impact`, no contra `recipe_item_id`. Y antes
  que rellenar los 205 huecos, **arreglar los 22 que ya existen y están mudos**: es menos trabajo
  y explica los desvíos que más duelen. La herramienta ordenada por unidades vendidas sigue
  haciendo falta para el resto.
- **Regla que falta en el motor** — los tres caminos del §3 devuelven «nada» sin avisar. Un
  impacto confirmado que no puede aportar debería ser visible en la ficha, no un silencio.
  Es la regla 8 aplicada al motor.
- **Punto 3** (86 a modificadores) — necesita `modifier_option.recipe_item_id`, así que la
  columna del punto 2 sí hace falta, por esta vía. Pendiente el RECON de `availability-dispatch`.
- **Punto 4** (combos) — pendiente.
