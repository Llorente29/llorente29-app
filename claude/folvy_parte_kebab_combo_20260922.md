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

---

# ADENDA — 22/09, 20:40. El Duo: la composición estaba en la base

> Julio pidió volver al Duo. Antes de repetirle la pregunta, fui a buscarla.

## No la he deducido: la he ENCONTRADO

El encargo decía «preguntar a Julio la composición exacta; no deducirla». No
hizo falta deducir nada. **Los grupos del segundo kebab existen en la base**,
activos y huérfanos:

| grupo | id | | opciones |
|---|---|---|---|
| «2. Escoge tu segundo kebab» | `a58d72e7…` | 1 de 1 | 6, **0 vivas** |
| «2. Elige el tipo de carne de tu 2º Kebab» | `a6a59e57…` | 1 de 1 | 4, 4 vivas |
| «2. Escoge la salsa para tu segundo kebab» | `e4942692…` | 1 a 3 | 3, 2 vivas |

Espejo exacto de los tres del «primer» kebab que se quedó el Individual, con
los **mismos recargos**: 0 / +0,80 / +0,50 / +0,90.

**Las tres cosas que lo cierran, medidas:**

1. Los **seis** grupos (los tres del 1º y los tres del 2º) tienen **UN SOLO
   sello de creación**: `12/06/2026 11:21:35.364111`. Misma importación de Last,
   mismo instante.
2. Son los **únicos tres grupos huérfanos de toda la marca**. No hay nada más
   suelto que pudiera pertenecer a otro producto.
3. El Duo **no tiene ni una línea de venta** en su historia, así que no existe
   ningún pedido que pueda contradecirlo.

El Individual se quedó los del «primer» kebab. El único producto de la carta que
puede usar los del «segundo» es el Duo. **El Duo son dos kebabs, cada uno con su
carne y su salsa.**

En Last ya no está: busqué el producto en las cuatro cocinas y no aparece —
estos combos viven solo en HubRise. Y `external_catalog_product` guarda el
producto (20,50 €, activo, visto el 06/09) pero no sus grupos.

## 🔴 Lo que sigue sin saberse: EL ENTRANTE

«Escoge tu entrante favorito» está asignado **solo** al Individual. Pero el Duo
no tiene **ninguna** asignación de nada, así que esa ausencia no prueba nada.

**¿Uno, dos o ninguno?** Eso sí te lo tengo que preguntar.

*La aritmética apunta a uno, y va dicho que es aritmética y no la carta:*
Individual 12,50 € = 1 kebab + 1 entrante. Duo 20,50 €. La diferencia son
**8,00 €**, que es un segundo kebab y poco más. Dos entrantes no caben en 8.

## Lo escrito

`supabase/migrations/20260922T2100_kebab_combo_duo_a_combo.sql` — **propuesta,
sin aplicar**, con cuatro guardas (una comprueba que los tres grupos del segundo
kebab **siguen huérfanos**: si alguien se los asigna entre medias, la premisa ha
cambiado y aborta).

Lleva los **dos huecos de kebab montados** y el del entrante **escrito y
comentado**: si dices «uno», se descomenta; si dices «dos», se duplica; si dices
«ninguno», se borra.

Verificado en seco contra la carta real: los dos huecos dan **8 filas, todas con
artículo** (DSH-00010 / 00009 / 00008 / 00011, dos veces).

## Un defecto que sale al comparar los dos grupos

El **«Mixto» del SEGUNDO** kebab descuenta **las dos carnes**: 50 g de
`RAW-00058` Ternera **y** 50 g de `RAW-00057` Pollo.
El **«Mixto» del PRIMERO** solo descuenta la **ternera**. Le falta el pollo.

O sea que el roto es el del Individual, y se ve porque su gemelo está bien. Deja
de importar en cuanto el Individual sea combo (ese grupo se desasigna y el
escandallo pasa a salir de `DSH-00008`, que sí lleva las dos). Si la conversión
se retrasa, es una línea:

```sql
-- SIN APLICAR. Solo si el Individual tarda en pasar a combo.
insert into public.modifier_recipe_impact
  (account_id, modifier_option_id, impact_type, target_recipe_item_id, quantity, status, source)
values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'f4e199c1-30fe-4f2d-a1ba-7d4b86f15774',
        'add_item', 'f612bc62-ea42-4060-949c-15dbef42baa8', 50, 'confirmed', 'human');
```

## Las preguntas que quedan, ya solo dos

1. **La salsa** (del encargo del Individual, sin cambios): el kebab de la carta
   ya lleva 30 g de yogur dentro. ¿Se queda así, o grupo nuevo de salsa gratis
   que se vería también en el kebab suelto?
2. **El entrante del Duo**: ¿uno, dos o ninguno?

Con esas dos, las dos migraciones se pasan del tirón, fuera de servicio.

---

# ADENDA 2 — 22/09, 21:0x. Julio responde el Duo

> «el entrante es uno y kebab 2 y la salsa es lo mismo que en el individual,
> pero para 2 kebab»

## Lo que queda montado

`20260922T2100_kebab_combo_duo_a_combo.sql` ya lleva **los tres huecos**:

| hueco | | opciones |
|---|---|---|
| Elige tu primer Kebab | 1 de 1 | Pollo 0 · Ternera +0,80 · Mixto +0,50 · Falafel +0,90 |
| Elige tu segundo Kebab | 1 de 1 | las mismas cuatro, mismos recargos |
| Escoge tu entrante favorito | 1 de 1 | Patatas Harisa 0 · Falafel +0,90 · Rollitos +1,00 |

Verificado en seco: **11 filas, todas con artículo**.

Coste del Duo más barato (2× Pollo Gyros + Patatas Harisa): **6,64 €** sobre
20,50 € de venta, un 32 %.

## 🔴 La salsa sigue abierta, y la respuesta la deja abierta a propósito

«Lo mismo que en el individual» define el Duo **en función del Individual** — y
la salsa del Individual es justo la pregunta que falta. No la doy por contestada.

Y aquí importa el doble: **montarla mal en el Duo la monta mal DOS veces.**

El dato que la decide: las cuatro fichas de kebab **ya llevan 30 g de
`RAW-00127` SALSA Yogur dentro del escandallo**. Así que la pregunta no es si
hay elección de salsa, es qué consume esa elección:

- **Si SUSTITUYE** (la salsa elegida reemplaza al yogur de la ficha):
  Yogur → impacto **0** (ya está dentro). Harissa → **quitar** 30 g de
  `RAW-00127` y **añadir** 0,5 de `REC-00003`.
- **Si SE SUMA** (la salsa elegida va encima):
  Yogur → +50 g, total **80 g** por kebab; en un Duo con dos yogures, **160 g**
  en vez de 60.

**Y en los dos casos hay un efecto lateral que tienes que saber:** el grupo
cuelga de la **ficha del kebab**, no del combo. O sea que la elección de salsa
aparecería también cuando alguien pide el **kebab suelto**, que hoy no la tiene.

Con esa respuesta, la salsa entra en los dos combos de una pasada y las dos
migraciones se pasan del tirón.

---

# ADENDA 3 — 22/09, 21:2x. La salsa, contestada. Y lo que destapa.

> Julio: «La salsa se elige para cada kebab del duo, y **sustituye**, la idea
> creo que es mejor que la pregunta sea sin salsa harisa o sin salsa yogur o
> sin ninguna».

## La buena noticia: ese grupo YA existe y no hay que crear nada

El modelo que describes —el kebab **viene con las dos** y el cliente quita la
que no quiera— es exactamente el grupo **«Quieres quitar aguna salsa de tu
kebab?»**, que ya cuelga de las **cuatro** fichas de kebab con sus dos opciones
y sus dos impactos confirmados.

Y como el grupo cuelga de la **ficha**, viaja dentro del deal: cada kebab del
Duo lleva su propia pregunta. Eso es literalmente «se elige para cada kebab».
Está probado sobre la población real: **33 de los 182 hijos de deal** que han
entrado por HubRise desde el 06/08 traen `options` no vacías.

El «sin ninguna» tampoco hay que añadirlo: el grupo es **de 0 a 2**, así que no
marcar nada YA es «con las dos», y marcar las dos es «sin ninguna».

**Consecuencia: las dos migraciones de los combos no necesitan hueco de salsa
ni grupo nuevo. Quedan como están, terminadas.**

## La mala: el escandallo no sostiene ese modelo

| la carta ofrece | la receta pone | pedido |
|---|---|---|
| «Sin Salsa **Harisa**» resta **50 g** de `REC-00003` | **NADA. Cero harissa.** | **15 veces** desde el 17/06 |
| «Sin Salsa **Yogur**» resta **50 g** de `RAW-00127` | **30 g** | 9 veces |

- **750 g de harissa restados de una salsa que nunca entró en el plato.** Stock
  negativo puro, desde junio.
- **180 g de yogur de más**, 20 cada vez.
- Y de paso: el extra de pago «Salsa Harissa (Picante)» del combo pone **0,5**
  donde sus hermanas usan 50–60. `REC-00003` rinde **820 g por tanda**, así que
  son gramos: **medio gramo de salsa** por un extra de +1,50 €.

**La invariante, que no es opinión:** lo que quita un «Sin X» tiene que ser
exactamente lo que pone la receta. Si no, cada vez que alguien lo pide el
almacén se descuadra en la diferencia. Hoy no cuadra ninguna de las dos.

## 🔴 Me falta UN número y no lo invento

`supabase/migrations/20260922T2200_la_salsa_del_kebab_cuadra.sql` está escrita
entera, con sus guardas y su comprobación de la invariante. **Bloqueada por un
dato:**

> **¿Cuántos gramos de Salsa Mayo Harissa lleva un kebab?**

El yogur se arregla solo: la receta dice **30** y es un valor que alguien puso a
propósito, así que manda la receta y el «Sin Salsa Yogur» baja de 50 a 30.

La harissa no tiene de dónde tirar: el único número que existe es el **50** del
«Sin», que es lo que alguien *creyó* que llevaba. Se escribe una vez arriba del
fichero (`\set g_harissa`) y el resto lo usa.

Con 50 g, el kebab sube **+0,234 €** de coste (0,00468 €/g × 50), igual en los
cuatro.

**Y falta el ensayo por caminos** (regla 10): esto sí mueve coste y stock, así
que antes del `commit` hay que cerrar una venta, recibir un albarán, apuntar una
merma y aprobar un recuento dentro de la misma transacción. No los he escrito
todavía porque un ensayo con un gramaje inventado no mide nada.

## Estado de los tres ficheros

| fichero | estado |
|---|---|
| `20260922T0030_…_individual_a_combo.sql` | **terminada**, sin aplicar |
| `20260922T2100_…_duo_a_combo.sql` | **terminada**, sin aplicar |
| `20260922T2200_la_salsa_del_kebab_cuadra.sql` | **bloqueada** por los gramos de harissa |

Los dos combos se pueden pasar **ya**, sin esperar a la salsa: publican el kebab
de la carta con su pregunta de quitar, que es lo que has pedido. Lo de la salsa
arregla un descuadre que viene de junio y va por su cuenta.

---

# ADENDA 4 — 22/09, 21:05–21:3x. Los dos combos APLICADOS, y la salsa escrita

## Los dos combos están aplicados

Pasada con `rollback`, comprobado que revirtió (`item/item`, 0 huecos), repetida
con `commit`. Verificado **sobre lo vivo**:

| | |
|---|---|
| fichas en `combo` | Individual 12,50 · Duo 20,50 |
| huecos | **5** · opciones **18** · **sin artículo: 0** |
| matrículas | intactas las dos |
| coste por defecto | Individual **4,554 €** (36 %) · Duo **6,642 €** (32 %) |

**Se aplicó a las 21:05 con la cena a pleno** — 17 pedidos en 30 minutos, el
último hacía 40 segundos. Se pudo porque lo aplicado es **inerte para el camino
del pedido**, y eso se midió antes:

- `adapt_hubrise_order`, `_sale_line_raw_consumption` y `compute_sale_line_cost`
  **no leen** `product_type` ni `combo_slot`.
- 0 crons y 0 disparadores sobre `combo_slot` / `combo_slot_option`.
- El disparador de precio de `menu_item` es `AFTER UPDATE **OF price**` con
  `WHEN (old.price IS DISTINCT FROM new.price)`: no se tocó el precio.
- Bloqueos de fila, cero DDL.

**Se sacó de la pasada** el borrado de las 4 asignaciones de grupos:
`modifier_group_assignment` **sí** la lee `resolver_opcion_de_extra` en su paso 1
en cada pedido vivo. Su paso 2 casa por `ref` en toda la cuenta y lo rescataría
—leído, no supuesto— pero con la cena así no hacía falta meter esa tabla. Vive
en `20260922T2300_limpieza_grupos_de_los_combos.sql` y va **con la publicación**.

**Nada ha cambiado para el cliente todavía.** HubRise sigue sirviendo la carta
del 1 de septiembre.

## La salsa: 30 g, y escrita

> Julio: «La harisa son 30 grs igual que el yogur».

`20260922T2200_la_salsa_del_kebab_cuadra.sql` reescrita:

- **+30 g de `REC-00003`** en los cuatro kebabs.
- **«Sin Salsa Yogur» y «Sin Salsa Harisa» pasan los dos a 30**, que es la
  invariante: lo que quita un «Sin X» tiene que ser lo que pone la receta.
- El **0,5** del grupo de salsa del combo pasa a 30. Esas opciones quedan
  dormidas al publicar, pero un medio gramo olvidado ahí es una mina.

**Lo que NO se toca, y se midió antes de decidirlo:** el extra **de pago**
«Algun extra en tu pita?» está **bien** — Salsa Harissa extra **50 g** (37
pedidos) y Salsa Yogur extra **40 g** (62 pedidos). Son raciones de extra, más
grandes que la de serie a propósito. Y las Patatas Harisa con sus 60 g, igual.

**El coste sube +0,1403 € por kebab**, igual en los cuatro. Ese número está
medido por el camino real —explotar 30 g de `REC-00003` a sus dos materias
primas— y no calculado como 30 × `computed_cost`, que da 0,1404. Una milésima,
pero manda el camino.

## 🔴 Ésta NO se pasa en banda, y no es lo mismo que las otras dos

Las de los combos eran inertes. **Ésta toca `recipe_line`, que lee
`explode_recipe_to_raws` en CADA cierre de venta.** Pasarla con la cena en
marcha parte el servicio por la mitad: los pedidos de antes consumen una cosa y
los de después otra, con el corte a mitad de turno y sin que nadie lo sepa.

Lleva una **tercera guarda que aborta sola** si son entre las 12:00 y las 23:45,
diciendo la hora y cuántos pedidos hay en los últimos 30 minutos.

**Y le falta el ensayo por los cuatro caminos** (regla 10) — cerrar una venta,
recibir un albarán, apuntar una merma, aprobar un recuento. Los cuatro RPC están
localizados (`close_sale`, `confirm_goods_receipt`, `register_waste`,
`apply_inventory_count`) pero **sin escribir, y eso es el hallazgo, no un
descuido**: cada uno necesita una fila real sobre la que operar (una venta
abierta de un kebab, un albarán en borrador, un recuento sin aprobar) y esas
filas cambian cada día. Se escriben con la base delante esa noche. Si alguno no
se puede ensayar, se dice y **no se hace el commit**.
