# RECON · Modificadores · §2 del encargo del 11/09/2026

Medido el 11/09 contra producción (Foodint, `51ad1792-…`), sin tocar nada.
Ventana: 30 días móviles, sin pedidos cancelados, rechazados ni inactivos —
el mismo filtro que usa `generate_sale_consumption` para decidir si una venta
consume (regla 39: la vara del sistema al que va a gobernar).

---

## 0 · Lo que contradice al §1 del encargo

Tres cifras no sobreviven a la medición, y una de ellas cambia el tamaño del
problema. Las demás del §1 se confirman.

### (a) El enlace a ciegas falla MUCHO más de lo que dice el §1.2

El §1.2 dice «22 ventas cedidas cayeron en una opción que no está en las
preguntas de ese plato» y, aparte, «18 ventas cedidas vienen de platos a los
que en Folvy les falta una pregunta que Last sí les pone».

De las **319** líneas de extra cedidas cuyo plato padre existe en Folvy:

| | ventas | |
|---|---:|---|
| La pregunta SÍ está puesta en ese plato | 132 | 41 % |
| La opción es de **OTRA MARCA** | **111** | 35 % |
| Misma marca, pero la pregunta no está en ese plato | **76** | 24 % |

**187 de 319 (59 %) cayeron donde no debían**, no 22 + 18 = 40. La vara es
`modifier_group_assignment`, que es la única forma de atar una pregunta a un
plato: lo comprobé leyendo `_modgroups_of_item`, que es lo que la aplicación
usa para contestar «qué preguntas tiene este plato».

Esto no cambia el plan —A2 sigue siendo la respuesta— pero sí cambia lo que
hay que esperar de él: no son 40 ventas a recolocar, son 187 en 30 días.

### (b) Las líneas sin enlazar son 35 y 169,80 €, no 13 y 67,40 €

Y no son solo de Ay Mamita ni solo de agosto. Van del **14/06 al 08/09**:

| extra | ventas | € |
|---|---:|---:|
| Coca cola Zero | 7 | 17,50 |
| Tarta 3 Leches | 5 | 39,50 |
| Coca cola | 5 | 12,50 |
| Totopos Con Guacamole | 3 | 20,70 |
| Cheesecake de Nutella | 3 | 23,70 |
| Cheesecake De Nutella | 3 | 23,70 |
| Tequeño AM | 2 | 19,80 |
| Tres Leches · Agua pet. · Fanta Naranja | 3 | 12,40 |
| 3 líneas SIN referencia de canal (06/08) | 3 | 0,00 |

Las 35 tienen `map_needs_review = true` y **`unmapped_reason` NULL en todas**:
el §1.3 se confirma entero. Tres de ellas no traen referencia ninguna, así que
**A1 no las puede rescatar**: esas se quedan para la pantalla del tablero 7.

Dato fino, por si mueve algo: «Cheesecake de Nutella» aparece con DOS
referencias distintas (`ea433ce4…` hasta el 27/07, `a5326f96…` desde el 06/08).
Lo más probable es que en Last se rehiciera la ficha. No rompe A1 —cada
referencia enlazará a su opción— pero significa que un extra puede acumular
más de un código a lo largo del tiempo, y la tabla de extras de B1 tiene que
admitirlo.

### (c) El barrido son 29 funciones, no 18

Las 18 del encargo están todas. Faltaban once:

`_extras_group_options`, `_modgroups_of_item`, `_modifier_option_ref`,
`_set_modifier_option_availability_core`, `_shop_reprice_line`,
`add_existing_product_to_brand`, `extras_availability_panel_by_token`,
`kitchen_item_delete_check`, `search_extras_by_token`,
`set_modifier_option_availability`, `set_modifier_option_availability_by_token`.

Cuatro de ellas son las del panel de extras de la tablet, de ayer mismo.

---

## 1 · §2.1 · El código del extra

**Confirmado, y por partida doble.**

El importador guarda `external_id = om.id` (el hueco dentro de la pregunta,
`lastapp-catalog-import` línea 950). Los pedidos traen `organizationModifierId`,
que es `om.modifierId`. Son dos espacios de códigos distintos:

- De las **53** referencias distintas que traen los pedidos cedidos en 30 días,
  solo **2** coinciden con algún `external_id` guardado.
- Al revés: **210 opciones `lastapp` tienen 210 códigos distintos para solo 126
  nombres.** 56 nombres llevan más de un código; el peor, **9**.

Y la referencia de los pedidos se comporta EXACTAMENTE como el id del extra,
que es lo que A1 necesita — comprobado sobre ventas reales:

| referencia | nombre | marcas | ventas |
|---|---|---:|---:|
| `27e285fc…` | mayo smokey | **6** | 19 |
| `cf46e298…` | sweet chili t | **5** | 37 |
| `369bb576…` | mayo spicy | 5 | 31 |
| `47b040b8…` | mayo trufa | 5 | 20 |
| `74c80e80…` | bbq-barbacue. | 4 | 9 |

**Cada referencia lleva un solo nombre. Cero colisiones.** La «mayo smokey»
compartida entre 6 marcas es, medida, la misma tarrina de la que habla la
decisión 1 de Julio.

Lo que NO he podido comprobar: que esas 53 referencias estén en el catálogo de
la organización en Last. No hay espejo de modificadores en la base
(`last_product_mirror` solo guarda productos) y `last-catalog-probe` pide el
secreto de despacho. **No lo doy por hecho**, pero tampoco bloquea: el
importador YA lee `om.modifierId` en la línea 941 para sacar el nombre, así que
el valor está en la mano en el momento de importar. Si quieres el dato duro,
dime y lo pido con la sonda.

## 2 · §2.4 · Los pedidos de Folvy ya lo hacen bien

`_adapt_folvy_pos_order` y `adapt_folvy_shop_order` enlazan así:

```sql
from modifier_option mo
join modifier_group mg  on mg.id = mo.modifier_group_id
join modifier_group_assignment mga on mga.modifier_group_id = mg.id
where mo.id = (v_m->>'optionId')::uuid
  and mga.menu_item_id = v_mi.id
  and mo.is_active and mg.is_active
```

Eso **es** el paso 1 de A2: por código, dentro de las preguntas de ese plato.
No hay búsqueda por nombre y no hay `LIMIT 1` sin orden. La pieza común de A2
tiene aquí su implementación de referencia, y de paso confirma que el orden que
pide el encargo ya funciona en producción.

## 3 · §2.5 · Cómo se guarda el consumo · **lo más importante para A4**

`generate_sale_consumption`, por cada ingrediente crudo:

```
movement_type = 'consumo'   source_type = 'sale'   source_id = LA VENTA
occurred_at   = COALESCE(sale.created_at, now())
qty_base      = -teórico  (con signo: remove entra en positivo)
unit_cost     = COALESCE(ril.avg_unit_cost, ri.computed_cost)
```

**Dos cosas que chocan con A4 tal y como está escrito:**

1. **Es todo o nada por venta.** Lo primero que hace es
   `DELETE FROM stock_movement WHERE source_type='sale' AND source_id = la venta`,
   y después reescribe. No existe granularidad por línea ni por ingrediente.
   A4 pide «se aplica **solo la diferencia**» y «por cada ingrediente… solo si
   la venta es posterior al último recuento aprobado». **Eso no se puede hacer
   llamando a `generate_sale_consumption`:** llamarla reescribiría el consumo
   entero por debajo de recuentos ya cerrados, que es justo lo que la decisión 2
   de Julio y la regla 6 prohíben. A4 necesita un escritor NUEVO, y hay que
   decirlo antes de escribirlo.

2. **La fecha del movimiento es `created_at`, no `sold_at`.** El corte de A4
   («posterior al último recuento aprobado») se mide contra el libro mayor, así
   que tiene que usar la misma fecha que el libro mayor. Hoy las dos casi
   coinciden —de 2.962 ventas en 30 días, **3** se separan más de una hora y
   ninguna más de un día— pero `lastapp-backfill-sales` existe, y el día que se
   reimporte historia las dos fechas se abren. Lo dejo escrito para decidirlo a
   propósito y no por descuido.

## 4 · §2.6 · Publicar una pregunta a HubRise

`hubrise-catalog-publish` sí publica preguntas: lee
`modifier_group_assignment` → `modifier_group` → `modifier_option`, arma
`option_lists` con `ref = external_id ?? 'mg_' + id`, y cuelga
`option_list_refs` de cada sku. **Una pregunta creada en Folvy llega a Glovo,
Uber y la web** sin tocar el publicador. Dos condiciones: el grupo tiene que
estar activo y tener al menos una opción — las vacías se descartan con aviso.

## 5 · El resto del §1, confirmado

- **§1.3 · las líneas sin enlazar se quedan en blanco**: `unmapped_reason` es
  NULL en las 35. Confirmado.
- **§1.4 · «qué lleva» cuelga de cada copia**: 234 opciones activas para 125
  nombres. Confirmado.
- **§1.5 · `replace_item` suma y no quita**: en `_sale_line_raw_consumption`
  aparece solo en la rama de sumar,
  `mri.impact_type IN ('add_item','bundle','replace_item')`. No hay ninguna
  rama que reste lo que sustituye. Confirmado leyendo el código.
- **§1.6 · el vigía solo mira los que cobran**: `modifier_zero_cost_watchdog`
  filtra `COALESCE(price_impact, 0) > 0`. Confirmado.
- **`modifier_option.recipe_item_id` está muerta de verdad**: 0 de 241 filas la
  tienen. Pero **la leen 6 funciones** (`_modgroups_of_item`,
  `_sale_line_raw_consumption`, `add_existing_product_to_brand`,
  `order_for_print`, `orders_feed`, `orders_feed_by_token`), casi todas para
  sacar alérgenos. Retirarla (B2) es tocar esas seis, no borrar y ya.

## 6 · La línea base, para comparar después con la misma vara

30 días móviles, medido el 11/09 a las 09:5x UTC:

| | líneas | |
|---|---:|---|
| Extras vendidos | **1.343** | (el §1 decía 1.393) |
| · descuentan algo | **799** | (decía 827) |
| · enlazados pero sin decidir qué llevan | **532** | (decía 552) |
| · sin enlazar | **12** | (decía 14) |

La diferencia es la ventana móvil: el §1 se midió unas horas antes. La forma
es la misma. **Para el antes/después usaré una ventana con fecha fija**, no
«últimos 30 días», para que las dos cifras se tomen con la misma vara.

Por dónde entran, y cómo casarían HOY por código:

| fuente | líneas | sin enlazar | casarían por código |
|---|---:|---:|---:|
| hubrise (propias) | 935 | 0 | **935** |
| lastapp (cedidas) | 408 | 12 | **6** |

Las propias ya están sanas de identidad: `extras_p3b` dejó
`_modifier_option_ref` devolviendo la referencia efectiva, y hoy las 935 casan.
El agujero es entero de las cedidas.

En toda la historia hay **4.346** líneas de extra desde el **12/06**, de las
que 34 están sin enlazar. Ése es el alcance de A4.
