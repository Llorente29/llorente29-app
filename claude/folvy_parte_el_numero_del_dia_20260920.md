# PARTE · El número del día y la pegatina de 80 mm

**20/09/2026.** Lotes 1 y 2 del encargo del 20/09. Rama `claude/jolly-carson-exjwn3`.
**Nada aplicado en producción.**

**Preview, en la dirección fija de la rama:**
<https://folvy-app-git-claude-jolly-carson-exjwn3-llorente29s-projects.vercel.app>

> Ojo con lo que el preview enseña y lo que no. **La tarjeta del pase** sí: es web.
> **La pegatina y el ticket NO**, porque los pinta la app de la tablet contra una
> impresora — el preview no tiene ninguna. Y el **número** sólo aparece cuando la
> migración esté aplicada; hasta entonces la tarjeta enseña el código de pase en el
> hueco del número, que es exactamente lo que tiene que hacer.

---

## 0 · Lo primero, porque cambia el camino: dónde se compone la pegatina

El encargo daba por hecho que la pinta el agente de Windows (`C:\folvy-print-agent`,
fuera del repositorio) y pedía que lo dijera «el primero». **No lo pinta el agente.**

**La pegatina se compone DENTRO de este repositorio**, en `src/native/print/`, y la
pinta la app nativa de la tablet. Medido, no supuesto:

| | |
|---|---|
| Dispositivos activos de Alcalá | **dos**, los dos `estacion`: «Pase» (`platform: web`) y «Cocina» (`platform: android`, `1.0.49 (49) · bundle 306`) |
| Trabajos servidos 18–19/09 | 211 `kitchen`, 209 `labels`, 204 `bag` — todos `done` |
| Quién puede reclamar la cola | `printWorker.ts` **sólo corre en la app nativa** (`Capacitor.isNativePlatform()`), así que es la tablet Android de Cocina |
| Agente de Windows en `kds_device` | **ninguno** en toda la cuenta Foodint |

Y dentro del repositorio, cada papel en su fichero:

| papel | fichero | cómo |
|---|---|---|
| **Pegatina** | `src/native/print/labelImage.ts` *(nuevo)* | imagen (canvas → ráster) |
| **Ticket de cocina** | `src/native/print/ticketImage.ts` → `renderKitchenImage` | imagen |
| Bolsa | `ticketImage.ts` → `renderBagImage` | imagen |
| *(respaldo por texto)* | `ticketRenderer.ts` + `escpos.ts` | sólo si el canvas falla |

**Los tres caminos de publicación son distintos, y conviene no mezclarlos:**

1. **La pegatina y el ticket → por OTA.** Van en el paquete web. Fusionar a `main`
   dispara `build-apk.yml`, que sube `bundle-NNN.zip` y el manifiesto; las tablets
   lo aplican **solas, dentro de su ventana** (fuera del horario del local y con la
   cocina en calma). No llega por Vercel ni por la base.
2. **La tarjeta del pase → por Vercel.** El dispositivo «Pase» de Alcalá es `web`.
3. **El número → por la migración**, que la aplicas tú.

---

## 1 · La lista, cruzada

| # | | estado |
|---|---|---|
| N1 | Contador por local y día, atómico, sin repetidos ni huecos | ✅ ensayado |
| N2 | Dicho si reutilizo `pos_ticket_counter` o hermano, y por qué | ✅ **hermano** |
| N3 | El pedido que cruza medianoche | ✅ ensayado con uno |
| N4 | El número no cambia al reimprimir | ✅ ensayado |
| N5 | El número en `label_token` y en el resolutor de texto | ✅ con una salvedad, abajo |
| N6 | El mismo número en tarjeta, ticket y pegatina | ✅ ensayado |
| G1 | Pegatina 80 mm, número en el tercio izquierdo y lo más grande | ✅ **47,8 mm, no 45** |
| G2 | «1 de 3» grande | ✅ 38 px = 4,75 mm |
| G3 | Alérgenos en caja con borde, «sin datos» cuando no hay | ✅ **con tres estados, no dos** |
| G4 | Los platos sin alérgenos, listados | ✅ y el 61 se parte en 47 + 11 + 3 |
| G5 | Marca entera, sin cortar | ✅ |
| G6 | QR intacto, mismo tamaño | ✅ 29 módulos × 6 = 21,75 mm |
| G7 | Código del repartidor sin partir | ✅ |
| G8 | Dónde se compone y por qué camino se publica | ✅ §0 |
| D1 | Legible con `7` y con `139` | ✅ dibujado, no razonado |
| D2 | Quince pegatinas en la mesa | ✅ veinte, ver la foto |

---

## 2 · N2 · Hermano, y no `pos_ticket_counter`. Con el fichero delante

`supabase/migrations/20260815T1702_tpv_t1_pos_sale_rpc.sql`:

- **línea 66** — «tabla interna, solo la toca `_pos_next_ticket_code`»
- **línea 508** — el TPV inserta la venta con
  `pos_short_code = _pos_next_ticket_code(cuenta, local)`

O sea que `pos_ticket_counter` **no numera pedidos: numera tickets del TPV**, y lo
que escribe acaba en `sale.pos_short_code` con formato `'T042'`. Y `pos_short_code`
es exactamente el campo del que `passCode.ts` saca el código de pase de Glovo y del
reparto propio.

Compartir esa fila hace **dos** daños, no uno:

1. **Colisión en pantalla.** El pedido de Glovo que coge el 42 para el pase y el
   ticket de mostrador que coge el 42 para su `T042` enseñan el mismo número en el
   mismo pase.
2. **Y el peor: le mueve al TPV el correlativo de su factura simplificada.** Si el
   pase le consume números, el mostrador salta de `T003` a `T071`. Eso no es un
   choque de nombres: es meterse en la numeración de un documento que ya existe.

Además las poblaciones no son la misma. El TPV numera **sólo mostrador** (2 filas en
toda su historia, el piloto del 10 y 11/08). El pase tiene que numerar **todo** lo
que entra al local. Medido, Alcalá, 30 días, con el corte de 4 h: **media 69, máximo
139** — que casa con los 70/139 del encargo tomados por otro lado.

→ **`pase_day_counter`**, misma forma, misma regla de día de servicio.

---

## 3 · N3 · La medianoche, contestada con la regla que ya existía

No he inventado día de servicio: he reusado el **corte de 4 h** de
`_pos_next_ticket_code` / `orders_feed` / `_kitchen_day_banner_for`. Lo único que
cambia es que ahora vive en **una** función (`_pase_dia_de_negocio`) en vez de
copiado en línea en cada sitio.

El dato real que lo confirma es el que apuntabas: la fila de
`business_date = 2026-08-10` tiene `updated_at = 2026-08-11 00:11:14+00`, que en
Madrid (UTC+2 en agosto) son **las 02:11 del 11**; menos 4 h → 22:11 del día 10 →
día de servicio **10/08**. Coincide.

**Ensayado con uno:** metí un pedido con `opened_at = 21/09 00:11 Madrid` y salió
`pase_dia = 2026-09-20`, número 6 de ese día. Cuenta en la noche del 20, no en el 21.

> La deuda que declaró el TPV sigue abierta y no la cierro aquí: **si un local
> necesitara un corte distinto de 4 h, hoy no hay dónde configurarlo.**

---

## 4 · El ensayo: la migración entera, por sus caminos, y deshecha

Regla 10 — un cambio se ensaya por sus caminos, no por su fórmula. Apliqué la
migración **completa contra producción** dentro de una transacción y la deshice.
Cinco pedidos reales clonados en Alcalá, con sus líneas:

| paso | resultado |
|---|---|
| N1 · cinco pedidos seguidos | `numeros=1,2,3,4,5 · distintos=5 · huecos=0` |
| N1 · un pedido cancelado | `sin numero` — no gasta número |
| N3 · pedido de las 00:11 del 21/09 | `pase_dia=2026-09-20 · numero=6` |
| N4 · reimprimir | `primera=1 · segunda=1 · igual=true`, y los 3 tokens de etiqueta, los mismos |
| G3 · estados de alérgenos en el papel | `listed x2` |
| N5 · el número en `label_token` | `tokens=3 · con numero=3 · numero=1` |
| N5 · resolutor por NÚMERO («1») | `via=numero · candidatos=1` → el pedido correcto |
| N5 · resolutor por CÓDIGO («Z001») | `via=codigo · candidatos=1` → el mismo pedido |
| N5 · resolutor con texto inexistente | `candidatos=0`, sin inventarse nada |
| N6 · tarjeta contra papel | `tarjeta=1 · papel=1 · igual=true` |

**Nada quedó.** Comprobado después: `sale.pase_numero` no existe, `pase_day_counter`
no existe, el disparador no existe, `pase_resolver_texto` no existe. (Las dos ventas
`ENSAYO-…` que hay en la base son del **13/09**, de la prueba de facturas, no mías.)

Para no disparar nada de verdad, los pedidos del ensayo iban con
`service_type = 'pickup'`: `tg_auto_dispatch` sólo llama a `catcher-dispatch` con
`own_delivery`, y ésa es la única salida por pg_net que no se deshace con la
transacción.

---

## 5 · G3 y G4 · Los alérgenos: el 61 no es una cosa, son tres

Tu regla era: *si el plato no tiene alérgenos en ficha, la caja dice «sin datos»*. La
medí antes de construirla y **hay que afinarla, porque aplicada tal cual miente en el
otro sentido.**

Foodint, marcas propias activas, platos activos con ficha — **204 platos**, de los que
**143** tienen `contains` y **61 no**. Ese 61 es tu 61 exacto. Pero no es homogéneo:

| | platos | qué dice la ficha de verdad |
|---|---|---|
| **Ficha completa que dice que NO** | **47** | las 14 casillas puestas en `free`, **cero** sin decidir |
| **Ficha en blanco** | **11** | cero filas, nadie la ha tocado |
| **Sólo una traza** | **3** | 1 `may_contain` y 13 sin decidir |

Imprimir «sin datos» en los 47 sería **una afirmación falsa en el sentido contrario**
— y además tirar a la basura trabajo ya hecho, que es literalmente la regla 30. Así
que la caja tiene tres respuestas y ninguna es un hueco:

- hay alérgenos → **se listan**;
- ficha entera y sin ninguno → **«Ninguno de los 14»**;
- ficha en blanco o con casillas sin decidir → **«Sin datos»**.

La base manda el estado (`order_for_print.lineas[].allergens_state`); el papel sólo
pinta lo que diga.

### Los 14 que de verdad van a salir con «Sin datos» — deuda de catálogo

**Ficha en blanco (11):**

| marca | plato |
|---|---|
| Bendito Burrito | Burrito Colosal de Cochinita |
| Bendito Burrito | Burrito Tremendo de Birria de Ternera |
| Bendito Burrito | Quesadilla de Pollo |
| Bendito Burrito | Quesatacos Carnitas |
| Milanesa House | The Guilty Pleasure |
| Milanesa House | The Parmigiana Vibe |
| Smash Brothers Burgers | Double Smash Cheeseburger |
| Smash Brothers Burgers | Fried Chicken Burger |
| Smash Brothers Burgers | Smash Bacon Cheeseburger |
| Smash Brothers Burgers | Smash Cheeseburger |
| The Urban Kebab | Falafel con salsa de yogur (3 unidades) |

**Sólo una traza declarada, 13 sin decidir (3):**

| marca | plato |
|---|---|
| Lovers Burgers | Bastones de boniato frito (MH) |
| Mila's Sandwiches | Fried Sweet Potatoes |
| Scandal Burgers | Fried Sweet Potatoes |

> Cuatro marcas enteras de hamburguesa y burrito sin un solo alérgeno declarado.
> **No lo he tocado** —es catálogo, no es este encargo— pero ahí queda.

**Y un hallazgo de paso:** la base guarda el código estable en inglés (`gluten`,
`milk`), y **hasta hoy se imprimía ese código**, tanto en la pegatina como en la
comanda de cocina: el cocinero de Alcalá leía «eggs · milk · sulphites». Ahora sale
en castellano, con la etiqueta de `allergens.ts`, que es la fuente única.

---

## 6 · La pegatina: qué sale y qué ha cambiado respecto a la maqueta

**Escala.** La maqueta dibuja 640 × 360 px para 80 × 45 mm = 8 px/mm. La térmica
imprime 576 puntos sobre los 72 mm imprimibles del rollo de 80 = **8 puntos/mm**. O
sea que **1 px de la maqueta = 1 punto de impresora** y los tamaños de letra se
copian sin convertir. Lo único que cambia es el ancho útil: 548 en vez de 588, un
7 % menos de sitio horizontal y cero diferencia de tamaño de letra.

**🔴 El alto sale a 47,8 mm, no a 45, y la causa es el QR.** La maqueta lo dibuja a
84 px (10,5 mm). El QR de verdad mide **29 módulos × 6 puntos = 174 puntos =
21,75 mm**, y así quedó el 04/09 tras la prueba física. Son 11,25 mm que el dibujo no
tenía. No he recortado nada para fingir los 45: el rollo es continuo y el alto lo
elegimos. La cuenta entera: `14 + 106 de número + 10 + 38 de «1 de N» + 14 + 186 de
QR + 14 = 382 puntos`.

**🔴 Todas del mismo alto, y esto se vio dibujándolas.** Con el alto libre salían a
**47,8 · 43,1 · 36,5 y 33,5 mm** según el pedido (el número de tres cifras encoge un
escalón; una marca sin tienda no lleva QR). Quince pegatinas de cuatro altos
distintos en la mesa es justo lo que hay que evitar. Ahora hay un mínimo y lo que
necesite más, crece; nada se recorta nunca.

**El código del repartidor** se pinta al mayor escalón que entra en una línea, con la
escala `44 → 17 px`, y si ninguno entrara se calcula el exacto por proporción: se
lee más pequeño, pero **entero**. Medido en Alcalá, 30 días:

| canal | pedidos | largo del código |
|---|---|---|
| Glovo | 1.367 | 4, siempre |
| Uber | 680 | **5, los 680** |
| Just Eat | 47 | hasta **10** (`J191457290`) |

> **Corrección al encargo:** el caso peor **no es Uber**, es Just Eat. Uber es
> invariablemente de 5 caracteres en Alcalá; los 12 caracteres de la maqueta no
> aparecen en 90 días de datos (el máximo de toda la cuenta es 10). Aun así la regla
> está escrita para cualquier largo, no para 10.

---

## 7 · La foto: veinte pegatinas en la mesa (D2)

No lo he razonado, lo he **dibujado**: monté un banco de pruebas, rendericé con el
motor de verdad y el Chromium de este contenedor, y miré el resultado. La población
es **real** —marcas, platos, alérgenos y códigos de pase de pedidos de Alcalá del
18–19/09—; lo único puesto a mano son los números del día, repartidos de 7 a 139 para
cubrir los extremos medidos.

Se emparejan de un vistazo. El `139` se lee igual de bien que el `7`. El banco de
pruebas **no se ha commiteado**.

**Un hallazgo de la foto:** las dos pegatinas de **Lovers Burgers** salen **sin QR**.
No es un fallo del código —degrada como debe— es que esa marca tiene `shop_url` a
NULL en la base, y sin tienda no hay URL que codificar. Es la misma marca que ya era
la única sin `logo_url` de 17 activas. **Sin QR esa unidad pierde su identidad para
la cámara.** Queda anotado, sin tocar.

---

## 8 · N5 · El resolutor de texto: lo que hay que decir

El encargo dice *«el verificador resuelve hoy por `pos_short_code` leyendo el texto
impreso»*. **Busqué ese resolutor y no existe.** `pos_short_code` sólo aparece en los
webhooks, en migraciones y en el front; en `supabase/functions` no hay nada que
resuelva texto. Es coherente con el parte del 04/09: de C9 L2 está el sitio donde
guardar la foto, y **la cámara del §4 no está construida**.

Así que esto **no actualiza** un resolutor existente: lo **crea**.
`pase_resolver_texto(token, texto)` acepta las dos vías —1 a 3 cifras → número del
día del día de servicio en curso; cualquier otra cosa → código de pase— y **si hay
más de un candidato lo dice en vez de elegir**. Un verificador que desempata solo es
un verificador que un día pega la etiqueta en la bolsa de otro.

Y `label_token` guarda el número **que se imprimió** en esa etiqueta.

---

## 9 · Lo que he medido y lo que NO

**Medido:**
- Build exacto y en limpio (`npm run build` = `tsc -b && vite build`, borrando
  `*.tsbuildinfo`): **verde**. Y cazó algo real de paso — un ayudante que quedó sin
  usar al alinear la cabecera del ticket.
- Lint a los dos lados con la misma vara: **`origin/main` 1377 problemas / 1077
  errores** y **con el cambio 1377 / 1077**. Cero nuevos. (En el camino hubo 7 y
  están arreglados con tipos de verdad, no silenciados.)
- La migración, ensayada entera y deshecha (§4).
- Las fuentes cargan de verdad en el render: `Folvy:loaded`, `FolvyBold:loaded`.

**NO medido, y no lo doy por bueno:**
1. **Que el papel sale.** Una impresora no se prueba desde un contenedor. El ráster
   es el mismo `canvasToEscpos` que ya imprime la bolsa y la cocina todos los días,
   pero **la pegatina impresa no la ha visto nadie**.
2. **La monoespaciada del código.** Pido `"DejaVu Sans Mono", "Roboto Mono",
   monospace` y **en el repositorio sólo están DejaVuSans y DejaVuSans-Bold**: en la
   tablet resolverá a la monoespaciada del sistema Android. La garantía de «no se
   parte» **no depende de eso** —se mide con la fuente que resuelva en el momento—,
   pero el aspecto monoespaciado sí, y no lo puedo comprobar sin la tablet.
3. **`ctx.letterSpacing`** del rótulo «ALÉRGENOS»: va con `try/catch`, así que un
   WebView viejo lo ignora sin romper nada. No verificado en la tablet.
4. **Vercel.** Comprobado que construye; el estado READY hay que mirarlo en Vercel,
   no en el commit.

---

## 10 · Cómo se aplica, y en qué orden

1. **La migración, TÚ, y fuera de la banda.** `20260920073000_el_numero_del_dia.sql`
   **no se puede aplicar entre las 12:15 y las 23:45**: falla la condición 1 porque
   pone un disparador `BEFORE INSERT OR UPDATE` sobre `sale`, que es el camino del
   pedido. Las otras dos sí se cumplen: ningún `ACCESS EXCLUSIVE` sobre tabla del
   camino (las columnas nacen NULL y no reescriben la tabla; el resto son
   `create or replace` de función).
2. **Después, el front.** Fusionar a `main` publica Vercel (la tarjeta) **y** dispara
   el OTA (pegatina y ticket). Las tablets lo aplican solas en su ventana.
3. **El orden importa poco pero no da igual:** si entra el papel antes que la base,
   `pase_numero` llega vacío y la pegatina enseña el código de pase en el hueco del
   número — feo, no roto. Si entra la base antes, los pedidos ya en curso se quedan
   sin número (no hay relleno hacia atrás: sería poner en pantalla un número que el
   papel ya impreso no lleva).

**Dos comprobaciones para después de aplicar**, ya que no hay índice único que lo
garantice a la fuerza (y no lo hay a propósito: un único sobre `sale` convierte un
choque imposible en un pedido rechazado, que es el incidente del 10/09):

```sql
-- ¿algún número repetido en un local y día?
select location_id, pase_dia, pase_numero, count(*)
from sale where pase_numero is not null
group by 1,2,3 having count(*) > 1;

-- ¿algún pedido vivo sin número? (el disparador avisa por warning y sigue)
select count(*) from sale
where sold_at >= now() - interval '1 day'
  and coalesce(status,'') <> 'cancelled' and pase_numero is null;
```

---

## 11 · Lo que NO he tocado

- La pantalla de entrega (lote 3): tiene pregunta abierta.
- Carabanchel: sale igual por OTA porque es el mismo paquete, pero el número sólo
  aparece donde se aplique la migración; el contador ya es por local.
- El momento de impresión: aplicado y verificado el 19/09, no lo he mirado.
- El QR: ni tamaño, ni corrección, ni DataMatrix.
- Los 5 formatos huérfanos, los 33 pares, `learn_from_receipt`, el Sweet Potato
  Fries, C3 y F3: **encolados, sin abrir**.

### Encolado nuevo, de lo que ha salido por el camino

1. Cuatro marcas sin un solo alérgeno declarado (§5) — catálogo.
2. **Lovers Burgers sin `shop_url`**: sus pegatinas salen sin QR (§7).
3. Los `may_contain` (trazas) **no se imprimen** en ninguna parte. Hoy tampoco se
   imprimían. Meterlos cambia una afirmación sobre comida y quiero tu sí antes.
4. La previsualización web del ticket (`src/modules/orders/lib/ticketRenderer.ts`)
   sigue con el diseño viejo. Es una pantalla de comprobación, no el papel.
