# PARTE — Los combos de tienda propia: lo que queda del encargo, medido

> 28/09/2026, 09:31–10:1x (reloj de Madrid, **fuera de banda**). Encargo de Julio
> del 22/09, ampliado el 28/09 con «Combo Doble» de Mila's Sandwiches.
> Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710` · proyecto `xzmpnchlguibclvxyynt`.

**Hoy no he escrito ni una fila.** Todo lo de abajo son `SELECT`, con el
resultado pegado. No hay migración nueva, porque el Combo Doble tiene una
pregunta previa que no me toca contestar a mí (§2).

## Lo primero, porque tumba la premisa del caso 2

**El Combo Doble no es un producto con extras al que le falte convertirse en
combo. Es una ficha que se ARCHIVÓ el 12/09 a las 08:44:51 y que sigue a la
venta en Carabanchel, porque el catálogo de Mila's de Carabanchel no se publica
desde el 28/08.**

Es el caso de Montmartre otra vez, pero esta vez en otro local:

| catálogo de Mila's | local | última publicación `ok` | ¿Combo Doble? |
|---|---|---|---|
| `62253` | Alcalá | **12/09 08:46:44** (dos minutos después de archivarla) | ya no aparece |
| `5qqrj` | **Carabanchel** | **28/08 08:52:53** | **sigue a la venta** |

Los dos pedidos del encargo entraron por el `location_id` de HubRise `1b6p8-2`,
que es Carabanchel:

| pedido | Madrid | total del pedido | local HubRise |
|---|---|---|---|
| `7ED51` | 24/09 21:09:45 | 63,56 € | `1b6p8-2` |
| `0E81F` | 27/09 14:51:24 | 20,64 € | `1b6p8-2` |

Y no es una suposición sobre el escaparate: se nota en los nombres. La opción
que el cliente ve como **«Patatas Dirty»** (`ref fc15b7fc…`) es, en la base, la
opción `f4711855…` **«Patatas Clásica»**. Alguien la renombró después del 28/08
y Carabanchel nunca se enteró. Igual que el «Bocadillo Parmigiana» del segundo
bocadillo (`81f57397…`): está **apagado** en la base, pero se pidió en los dos
pedidos.

**Consecuencia:** convertirlo en combo tampoco serviría de nada mientras
Carabanchel no se publique. El arreglo del encargo, se elija el que se elija,
pasa por publicar ese catálogo.

## 1 · Kebab Combo (The Urban Kebab): hecho y publicado, **sin probar con un pedido real**

Aplicado el 22/09 y publicado el 23/09 a las 00:43 (ver
`folvy_parte_kebab_combo_20260922.md`). Hoy he contado cuántos pedidos han
entrado desde entonces con «Kebab Combo» en alguna línea:

> **0.** Ni el Individual ni el Duo se han vendido desde el 23/09 00:43.

O sea que la condición de «hecho» del encargo —*un pedido nuevo llega con una
línea padre y 2 `combo_item`*— **sigue sin cumplirse**. No por fallo: porque no
ha habido pedido. The Urban Kebab solo tiene catálogo en Alcalá (`5qqxx`), así
que aquí no hay un segundo local olvidado.

### 🔴 El encargo y lo aplicado no dicen lo mismo sobre la salsa

La versión del encargo que me llega hoy dice en **D1**: *«lo que ve el cliente
no cambia: puede elegir más de una salsa»*, Yogur → `none`, Harissa →
`add_item` de REC-00003.

Lo que está aplicado **no es eso**, y lo está por lo que dijiste en la adenda 3
del parte del 22/09: *«la idea creo que es mejor que la pregunta sea sin salsa
harisa o sin salsa yogur o sin ninguna»*, y después *«la harisa son 30 grs
igual que el yogur»*. Con eso:

- El kebab del combo lleva **las dos salsas de serie** (30 g de yogur + 30 g de
  harissa en la receta de los cuatro kebabs).
- El cliente ya no elige salsa: ve **«¿Quieres quitar alguna salsa?»**, y cada
  «Sin X» resta 30 g.
- El grupo «1. Escoge la salsa para tu primer kebab» se **desasignó** del combo
  el 23/09 a las 00:39.

**No lo he tocado.** Si D1 es lo que quieres ahora, eso sería volver atrás lo
publicado el 23/09. Te lo pregunto abajo (P3); no lo deduzco del texto.

## 2 · Combo Doble (Mila's Sandwiches): la composición está en el pedido, la decisión no

### Lo que ya NO hay que preguntar

**La composición.** El encargo pedía preguntar si el «Doble» son dos bocadillos
con la milanesa como relleno o cuatro cosas. Lo dice el pedido en bruto, con el
nombre de cada grupo (`raw_tab.items[].options[].option_list_name`, `0E81F`):

| grupo | opción | recargo |
|---|---|---|
| Escoge tu entrante | Patatas Dirty | 0,00 |
| Elige tu bocadillo | Bocadillo Bacon Queso | 0,50 |
| Escoge el tipo de milanesa para tu bocadillo | Milanesa de ternera | 1,50 |
| Elige tu segundo bocadillo | Bocadillo Parmigiana | 0,00 |
| Elige el tipo de milanesa para tu segundo bocadillo | Milanesa de pollo | 0,00 |

**Dos bocadillos, cada uno con su tipo de milanesa, y un entrante.** Las dos
«Milanesa de pollo» del `7ED51` son dos opciones distintas (`c3d1c5e3…` y
`69386a68…`), una de cada grupo. No son cuatro cosas.

**Lo que resta cada opción.** El encargo pedía decidir qué milanesa usar. Pero
**ya está decidido en la base**: las catorce opciones tienen impacto
`confirmed`:

| grupo | impacto |
|---|---|
| Elige tu (segundo) bocadillo | `bundle` × 1 de la ficha del bocadillo (Bacon Queso, César, Clásico, Club, Mila's, Parmigiana) |
| Tipo de milanesa (los dos grupos) | `add_item` **0,5** de «Milanesa de Pollo **Rebozado**» / «Milanesa Ternera **Rebozado**» |
| Escoge tu entrante · Patatas Clásica | `add_item` × 1 de «Patatas Clásicas Meraki» |

Nadie ha puesto «Milanesa de Pollo MH» (de Milanesa Haus). La milanesa de
Mila's es la rebozada, a media pieza por bocadillo. Si eso está mal, dilo; si
está bien, no hay nada que decidir.

**Por qué entonces no descuenta nada:** los extras sí casan
(`modifier_option_id` relleno en las 10 líneas de modificador de los dos
pedidos), pero cuelgan de una línea padre con `unmapped_reason =
'no_menu_item'`, porque la ficha está archivada. Medido: el `0E81F` tiene
**0 movimientos de stock**.

### 🔴 La pregunta que sí es tuya

**¿El Combo Doble tiene que seguir existiendo?**

Se archivó el 12/09 a las 08:44:51, y dos minutos después se publicó Alcalá.
Eso tiene pinta de retirada a propósito. En la carta sigue vivo **«Combo Mila´s
Doble con Refresco»** (`efd86813…`, **ya es `combo`**, 26,90 €). Hay dos
caminos, y son muy distintos:

- **(A) Se retiró a propósito. Es el que me parece más probable.** No hay que
  convertir nada: basta con **publicar Mila's en Carabanchel** y desaparece,
  igual que Montmartre. No hace falta migración.
- **(B) Tiene que seguir.** Hay que **desarchivarlo** y convertirlo en combo:
  dos huecos de bocadillo, que reutilizan las seis fichas de bocadillo (todas
  tienen artículo), y un hueco de entrante. **Y queda un problema de forma:** el
  tipo de milanesa es una elección *de cada bocadillo*, no un hueco del combo.
  Dentro de un deal tiene que ir como extra de la ficha del bocadillo, y eso la
  haría aparecer también cuando alguien pide el bocadillo suelto. Pasa lo mismo
  que con la salsa del kebab el 22/09. Además, «Patatas Clásica» no tiene ficha
  con artículo; tiene un impacto a «Patatas Clásicas Meraki». Habría que decidir
  qué ficha es el entrante.

Con (A) cierro el caso 2 hoy. Con (B) escribo la migración, pero necesito
también la respuesta a la milanesa-como-extra.

## 3 · Lo que pediste medir: cuándo se publicó cada marca propia

**Hay 15 catálogos, no 9.** Las marcas propias tienen un catálogo por local, y
la pantalla publica **un local cada vez** (`catalogPublishService.ts` manda
`location_id`). En septiembre, Carabanchel solo ha recibido **Bendito Burrito
(01/09) y Smash (08/09)**; todo lo demás fue a Alcalá:

| marca | local | catálogo | última `ok` | días | fichas cambiadas desde entonces | retiradas desde entonces |
|---|---|---|---|---|---|---|
| Meraki Pita | **Carabanchel** | `x77xp` | 28/08 | 31 | 26 | 1 |
| Mila's Sandwiches | **Carabanchel** | `5qqrj` | 28/08 | 31 | 24 | 2 |
| Milanesa House | **Carabanchel** | `7ggdq` | 28/08 | 31 | 30 | 0 |
| Scandal Burgers | **Carabanchel** | `8eevr` | 28/08 | 31 | 28 | 2 |
| Bendito Burrito | Alcalá | `j99jm` | 01/09 | 27 | 23 | 2 |
| Bendito Burrito | Carabanchel | `vvvdv` | 01/09 | 27 | 25 | 2 |
| Dirty Burger | Alcalá | `eyyjq` | 01/09 | 27 | 18 | 0 |
| Meraki Pita | Alcalá | `dmmj9` | 01/09 | 27 | 20 | 1 |
| Milanesa House | Alcalá | `vvvqp` | 01/09 | 27 | 26 | 0 |
| Scandal Burgers | Alcalá | `4gg4v` | 01/09 | 27 | 20 | 2 |
| Lovers Burgers | Alcalá | `kxxje` | 08/09 | 20 | 16 | 1 |
| Smash Brothers | Alcalá | `x77qy` | 08/09 | 20 | 8 | 0 |
| Smash Brothers | Carabanchel | `rkkj7` | 08/09 | 20 | 8 | 0 |
| Mila's Sandwiches | Alcalá | `62253` | 12/09 | 16 | 8 | 0 |
| The Urban Kebab | Alcalá | `5qqxx` | 23/09 | 5 | 3 | 0 |

*Cómo se mide cada columna.* «Última `ok`» es `max(catalog_publish_target.published_at)`
con `status='ok'` para ese `external_catalog_id`, no el estado global (la deuda
del 23/09: 12 publicaciones `done` sin conexión). «Fichas cambiadas» es
`menu_item.updated_at` posterior a esa fecha. **Es una cota por arriba:**
`updated_at` también se mueve con cambios que no ve el cliente (coste,
notas internas), así que no afirmo que las 30 de Milanesa House Carabanchel
sean 30 cambios visibles. Qué cambia de verdad lo dice la vista previa del
publicador (`dry_run`), que lo compara producto a producto.

**Productos que Folvy ya quitó y que se han seguido vendiendo DESPUÉS de
quitarlos (últimos 30 días, marcas propias, solo ventas posteriores a la
retirada):**

| marca | local | producto | veces | fechas | retirada |
|---|---|---|---|---|---|
| Mila's Sandwiches | Carabanchel | Combo Doble | 2 | 24/09 y 27/09 | 12/09 |
| Bendito Burrito | Alcalá | Birria Chicken Bowl | 1 | 30/08 | 23/08 |

(La primera versión de esta consulta contaba también ventas *anteriores* a la
retirada y sacaba cinco productos más. Quedan fuera. Eran ruido de la
consulta, no del escaparate.)

## Lo que necesito de ti, Julio

- **P1 · Combo Doble: ¿(A) retirado o (B) sigue?** Recomiendo (A).
- **P2 · ¿Publico los 14 catálogos desfasados?** Como mínimo, los cuatro de
  Carabanchel del 28/08. Antes pasaría la **vista previa** de cada uno para que
  veas qué cambia. Siempre fuera de servicio y con tu visto bueno, como dice el
  encargo. Hoy, hasta las 12:15, hay hueco. Si no llega, a partir de las 00:30.
- **P3 · La salsa del kebab:** ¿se queda como se publicó el 23/09 («quitar
  salsa», las dos de serie a 30 g) o vuelves a lo que dice D1 (elegir salsa)? Mi
  recomendación es que se quede: es lo último que dijiste y está publicado.

## Anotado, y no es de este encargo

- **La causa de fondo del caso 2 es de diseño, no de datos.** Una marca con dos
  locales tiene dos catálogos, y la pantalla deja publicar uno solo sin avisar
  de que el otro se queda atrás. Merece que la pantalla de publicar enseñe
  **la última publicación de cada local de la marca**, con los días. Es la
  regla 7: el operario abre esa pantalla a propósito, así que no puede esconder
  que hay un catálogo con un mes de retraso.
- Líneas de descuento de HubRise («Buy one get one free», «Item discount»):
  sin tocar, como dice el encargo.
