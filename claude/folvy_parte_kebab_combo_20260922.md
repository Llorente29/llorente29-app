# PARTE — Kebab Combo Individual pasa a combo de verdad

> 22/09/2026, 12:16–13:0x (reloj de Madrid). Encargo de Julio del 22/09.
> Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710` · proyecto `xzmpnchlguibclvxyynt`.
> Marca The Urban Kebab `5a230c99-1de4-47ca-82fb-65d4af589176`.

## Lo primero, porque manda sobre todo lo demás

**Son las 12:16 de Madrid: estamos DENTRO de la banda.** El encargo dice que el
catálogo en vivo no se toca entre las 12:15 y las 00:30. Así que hoy **no he
escrito ni una fila**: todo lo de abajo son medidas hechas con `SELECT` y una
migración **propuesta, sin aplicar**, para que la pase Julio fuera de servicio.

Y hay una segunda cosa que manda: **esto no se termina sin dos respuestas de
Julio** (la salsa y el Duo). Están en «Lo que necesito de ti», con mi
recomendación para la primera.

## El hallazgo que no venía en el encargo, y es el que más duele

**La carta de The Urban Kebab no se publica a HubRise desde el 1 de septiembre
a las 19:48.** Medido en `catalog_publish`: ocho publicaciones, la última
`done` el 01/09 19:48:17.

Eso explica el G160 del 21/09. «Montmartre.» está apagado en la base **desde el
13/09 a las 18:43:09**, apagado por una persona — y aun así un cliente lo
escogió ocho días después, porque el escaparate de HubRise sigue enseñando la
carta del 1 de septiembre. No es que la base no lo supiera: es que nadie se lo
ha contado a HubRise.

Es la regla del repositorio en otra cara: *una cosa está aplicada cuando está en
producción, no cuando está en la base*. **Montmartre no se quita apagándolo otra
vez; se quita publicando.** Y lo mismo vale para todo lo que sigue: la migración
no cambia nada de lo que ve el cliente hasta que se publique la carta.

## Qué pasa hoy, verificado contra la base

El G160 (21/09, 20:11:24 Madrid, total 20,00 €) está en `sale_line` así:

| tipo | nombre | ficha | artículo |
|---|---|---|---|
| `product` | Kebab Combo Individual | sí (`39c33485…`) | **no** (`recipe_item_id` nulo) |
| `modifier` | Patatas Harisa | — | **sin impacto** |
| `modifier` | Montmartre. | — | sin impacto |
| `modifier` | Pollo | — | 100 g `RAW-00057` Kebab Pollo Loncheado |
| `modifier` | Salsa Yogur | — | 50 g `RAW-00127` SALSA Yogur |

Un pedido de 12,50 € descuenta **150 gramos de comida en total**. El pan, la
verdura, el entrante y la caja, nada.

La causa es exactamente la que dice el encargo y la he leído en la función:
`adapt_hubrise_order` solo crea `combo_item` dentro del bloque que agrupa por
`deal_line.deal_key`. Sin deal no hay combo, y sin combo la ficha padre es la
única que podría descontar — y no tiene artículo.

Y del otro lado, `hubrise-catalog-publish` reparte la carta por `product_type`:
`i.product_type === "combo"` sale como **deal**, todo lo demás como **producto**.
**El interruptor es ese campo.** No hace falta ficha nueva, ni matrícula nueva,
ni tocar el adaptador.

## Cómo casa el deal, y por qué NO hay que tocar la matrícula

Lo he comprobado contra un deal real que ya funciona, el G324 de Smash del 21/09
a las 20:20: HubRise manda `deals: {"0": {"ref": "fv_3f924443…", "name": "Combo
Individual Smash"}}` — **el `ref` del deal llega SIN prefijo de marca**, y es
idéntico al `menu_item.external_id`. Los hijos sí llegan con prefijo
(`smash-brothers-burgers:db3f64ea…`), y `hubrise_strip_ns` se lo quita.

O sea: dejando `external_id = d21e1cfa-33ba-4a7e-8d51-8ef947113688` como está,
el casado del combo sigue funcionando el día 1. **La migración no lo toca.**

Y la salsa puede seguir viajando dentro del combo: **33 de los 182 hijos de deal
que han entrado por HubRise desde el 06/08 traen `options` no vacías**, y
`adapt_hubrise_order` las convierte en líneas `modifier` colgadas del
`combo_item`. No es una suposición sobre HubRise: ya ha pasado 33 veces.

## Lo que propongo, y lo que descontaría

`product_type='combo'` + dos huecos, copiando el modelo del Combo Individual
Smash. Reutilizando fichas que **ya existen y ya tienen artículo** — ninguna
nueva, como pedía el encargo:

**Hueco 1 · «Elige tu Kebab»** (1 de 1)

| opción | ficha | artículo | recargo hoy | recargo propuesto |
|---|---|---|---|---|
| Kebab de Pollo Gyros 🌯 | `3288f6c4…` | DSH-00010 | 0 | **0** |
| Kebab de Ternera Gyros 🌯 | `03881add…` | DSH-00009 | +0,80 | **+0,80** |
| Kebab Mixto: Pollo y Ternera 🌯 | `da2425da…` | DSH-00008 | +0,50 | **+0,50** |
| Kebab de Falafel 🌿 | `de9c174c…` | DSH-00011 | +0,90 | **+0,90** |

**Hueco 2 · «Escoge tu entrante favorito»** (1 de 1)

| opción | ficha | artículo | recargo hoy | recargo propuesto |
|---|---|---|---|---|
| Patatas Harisa | `59615289…` | **DSH-00389** | 0 | **0** |
| Falafel con salsa de yogur (3 uds) | `960bc26c…` | DSH-00368 | +0,90 | **+0,90** |
| Rollitos de Queso Feta (3 uds) | `560a02e6…` | DSH-00015 | +1,00 | **+1,00** |

Los recargos son los mismos que cobra hoy el grupo de extras, uno a uno: **el
cliente paga exactamente lo mismo**. «Hummus con pan de pita» se queda fuera
porque su opción ya estaba apagada **y** su ficha no tiene artículo.

**Medido en seco (solo `SELECT`, cero escrituras), lo que descontaría cada pieza:**

| pieza | artículos que mueve | coste estimado |
|---|---|---|
| Kebab de Pollo Gyros | 9 | 2,0882 € |
| Kebab de Ternera Gyros | 10 | 2,1680 € |
| Kebab Mixto | 11 | 2,1298 € |
| Kebab de Falafel | 9 | 1,3770 € |
| Patatas Harisa | 4 | 2,4654 € |
| Falafel c/ yogur (3 uds) | 2 | 0,9261 € |
| Rollitos de Queso Feta | 1 | 1,4700 € |

El combo más vendido (Pollo + Patatas Harisa) pasaría de mover **2 artículos** a
mover **13**, y de 12,50 € de venta con ~4,55 € de materia prima (≈36 %).

## Lo que necesito de ti, Julio

### D1 · La salsa. **Esto bloquea la publicación.**

Aquí es donde el encargo y la base no encajan, y no lo voy a tapar.

El encargo dice: «Salsa (1 de 1): Yogur o Harissa, como extra del kebab».
Pero **las cuatro fichas de kebab ya llevan 30 g de `RAW-00127` SALSA Yogur
dentro del escandallo**, y sus grupos de extras no son de elegir salsa, son de
**quitarla**: «Quieres quitar aguna salsa de tu kebab?» (Sin Salsa Harisa / Sin
Salsa Yogur) y «Algun extra en tu pita?» (salsas a +1,50 €).

Si encima le cuelgo el grupo de salsa del combo, un pedido con Yogur descontaría
30 g (de la ficha) + 50 g (del impacto) = **80 g**. Eso es contar dos veces.

Dos caminos, y ninguno es gratis:

- **(A) — el que recomiendo.** El kebab del combo es el kebab de la carta, con
  sus salsas de serie. El cliente deja de elegir Yogur-o-Harissa gratis y pasa a
  ver «quitar salsa» y los extras de pago, igual que cuando pide el kebab suelto.
  Una sola carta, un solo comportamiento, cero doble conteo. **Cambia lo que ve
  el cliente**, y por eso te lo pregunto en vez de hacerlo.
- **(B).** Grupo nuevo «Elige la salsa de tu kebab» (1 de 1, 0 €) asignado a las
  cuatro fichas de kebab. Mantiene la elección gratis, pero: se ve **también en
  el kebab suelto** (la asignación es por ficha, no por combo), y hay que
  decidir el escandallo — Yogur con impacto 0 porque ya está en la receta, y
  Harissa quitando los 30 g de yogur y poniendo la harissa.

### D2 · El Duo. No lo deduzco.

`a53c577d…`, 20,50 €, **0 ventas**. En la base **no tiene ni un grupo de extras
asignado** — ni carne, ni salsa, ni entrante: cero. Así que su composición no
está escrita en ningún sitio del que pueda sacarla. Necesito de ti: ¿dos kebabs
a elegir? ¿un entrante o dos? ¿bebidas? ¿qué recargos?

### D3 · Los nombres que verá el cliente

Las etiquetas de los huecos del deal son el `name` del `combo_slot`, y los
nombres de las opciones son los de la ficha. Con mi propuesta el cliente pasa de
ver «Pollo / Ternera / Mixto (Ternera & Pollo) / Falafel.» a ver «Kebab de Pollo
Gyros 🌯 / Kebab de Ternera Gyros 🌯 / …». Me parece mejor, pero **es un cambio
en lo que ve el cliente** y lo decides tú. El hueco del entrante lo he dejado
con el nombre exacto de hoy.

### D4 · Las dos fichas están apagadas

`Kebab Combo Individual` y `Kebab Combo Duo` tienen **`is_available = false`**
ahora mismo, sin motivo anotado. Eso es un 86 operativo y no lo toca la
migración. Dime si hay que encenderlas.

## Tres cosas que el encargo daba por otra cosa

1. **«Falta confirmar el impacto de Salsa Harissa (Picante)»** — ya está
   confirmado: `add_item`, **0,5 de `REC-00003` Salsa Mayo Harissa**, `status`
   `confirmed`, `source` `human`. Lo que sigue en pie no es confirmarlo, es
   decidir si convive con los 30 g de yogur de la ficha (D1).
2. **«Solo descuentan Pollo y Salsa Yogur»** — las cuatro carnes tienen impacto
   confirmado (Ternera 100 g, Mixto 50 g, Falafel 3 ud), y el entrante también
   salvo **Patatas Harisa, que es el único de los tres sin ningún impacto**. Con
   el combo, eso deja de importar: descuenta por ficha, no por extra.
3. **El Mixto cojea.** «Mixto (Ternera & Pollo)» descuenta **50 g de ternera y
   nada de pollo**. La ficha suelta `DSH-00008` sí lleva las dos (60 g + 60 g).
   El combo lo arregla de rebote. Lo anoto porque el extra suelto sigue mal.

## Anotado, y no es de este encargo

- El **empaquetado nunca descuenta**: `explode_recipe_to_raws` solo para en
  `raw`/`tool`/receta stockable, y un `packaging` sin líneas hijas devuelve cero
  filas. Envoltorio, aluminio, bolsa y servilletas del kebab no se mueven — ni
  hoy ni después. Pasa con toda la carta, no con este combo.
- **`RAW-00010` Aceite de Oliva tampoco sale** en la explosión del kebab (9
  artículos, no 10). La causa no la he perseguido: pasa ya hoy con el kebab
  suelto y no la cambia esta migración.
- El **gramaje no coincide**: el extra «Pollo» del combo descuenta 100 g y la
  ficha `DSH-00010` lleva 120 g. Al reutilizar la ficha, el combo pasará a
  descontar 120 g. Si el kebab del combo es más pequeño, hay que decirlo.

## Qué hay escrito en el repositorio

| fichero | qué es |
|---|---|
| `supabase/migrations/20260922T0030_kebab_combo_individual_a_combo.sql` | La migración. **Propuesta, sin aplicar.** Tres guardas que abortan si la base no está como la medí, los dos huecos, y tres comprobaciones para pegar aquí. Termina en `rollback;`. |
| `claude/folvy_ensayo_kebab_combo_20260922.sql` | El ensayo por caminos: mete un pedido de HubRise con deal, lo pasa por `adapt_hubrise_order` y mira qué descuenta. Se pega dentro de la transacción de la migración, antes del `rollback`. |
| este parte | lo de arriba |

**El ensayo cubre un solo camino, el de la venta, y va dicho:** `combo_slot`,
`combo_slot_option` y `menu_item.product_type` no los lee ni la recepción de
albarán, ni la merma, ni la aprobación de recuento. Esos tres no cambian, por
eso no se ensayan.

## El orden, cuando haya respuesta a D1

1. Julio contesta D1 (y D2 si quiere el Duo en la misma pasada).
2. **Fuera de servicio** (después de las 00:30): pasar la migración con
   `rollback`, leer las tres comprobaciones + el ensayo, y repetir con `commit`.
3. **Publicar la carta a HubRise** con el visto bueno de Julio. Sin esto no
   cambia nada de cara al cliente — y de paso se lleva por delante a Montmartre,
   que lleva nueve días vivo en el escaparate.
4. Comprobar la publicación **en HubRise, no en el color del run**: que
   «Kebab Combo Individual» aparece como **deal** con dos líneas y 12,50 €, y
   que los cuatro kebabs y los tres entrantes siguen en la carta a su precio.
5. Con el primer pedido real: comprobación 1 del parte diario en **ok sin
   faltan**, comprobación 2 **sin «Kebab Combo Individual»**, y una línea padre
   con **2 `combo_item`**, los dos con ficha y artículo.

No reproceso nada de lo anterior. G160 y las dos ventas previas se quedan como
están.
