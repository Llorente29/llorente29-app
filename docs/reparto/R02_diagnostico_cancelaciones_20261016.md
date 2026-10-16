# R02 · Diagnóstico: cancelaciones en reparto propio y pedidos sin dirección (16/10)

> Solo diagnóstico. No se ha tocado código, base ni despliegue.
> Todas las cifras son de la cuenta Foodint (`account_id = 51ad1792-6629-4ef7-833a-b57b09a86710`),
> `sale.source = 'hubrise'`, `service_type = 'own_delivery'`. Horas en Europe/Madrid.
> Tramos por `sold_at`: a = 25/09–03/10 · b = 04/10–13/10 · c = 14/10–16/10.

## PRIORIDAD (Julio, 16/10): por qué no tenemos la dirección

> Lo de las cancelaciones de abajo queda como contexto. Esto va primero.

**Dónde se pierde la calle: entre Glovo y HubRise, no en Folvy.**

- **El pedido que nos llega no la trae.** En el aviso de `vx238b7`, que es el `new_state` entero que mandó HubRise, no hay calle en ningún campo. `customer` trae nombre, teléfono, latitud y longitud, y nada más. `delivery`, `service_type_ref`, `delivery_quotes` y `driver_pickup_url` vienen vacíos. `created_by = "Glovo Bridge"`. Folvy guarda ese `new_state` tal cual en `raw_tab`: no recorta nada.
- **Hay dos grupos, y no tienen nada que ver** (Glovo de reparto propio por HubRise, desde el primer pedido, 77 sin calle de 636):
  - **27 sin cliente ninguno** (ni teléfono, ni coordenadas, ni calle): Smash Brothers `1b6p8-0` (21, del 28 al 31/08), Lovers `1b6p8-0` (2) y Scandal Burgers `1b6p8-2` (4, del 11/09 al 08/10: G431, G766…). Es la forma de los pedidos que **reparte Glovo**: de los 198 de plataforma, 176 llegan igual. No les falta la dirección; están mal clasificados como de reparto propio. Scandal en `1b6p8-2` sigue así: su celda de Glovo es `own`.
  - **50 con cliente, coordenadas y teléfono, pero sin calle**: G034 es uno de estos. Le pasa a todas las marcas de reparto propio (Meraki Pita 18, Milanesa House 14, Mila's 9, Bendito 4…).
- **El grupo de 50 empieza un día concreto.** Por semana, pedidos de Glovo de reparto propio con cliente:

  | semana | con cliente | sin calle |
  |---|---:|---:|
  | 24/08 | 60 | **0** |
  | 31/08 | 105 | 11 |
  | 07/09 | 125 | 12 |
  | 14/09 | 69 | 5 |
  | 21/09 | 66 | 6 |
  | 28/09 | 82 | 6 |
  | 05/10 | 72 | 7 |
  | 12/10 (hasta el 16) | 30 | 3 |

  El primero es **G322, el 02/09 a las 22:06**. Desde entonces es un 8–10 % cada semana. En la parte de Folvy no cambió nada ese día que lo explique: `raw_tab` es el `new_state` de HubRise tal cual, y el pedido de antes y el de después traen exactamente las mismas claves en `customer`. **El cambio está entre Glovo y HubRise (Glovo Bridge)**.
- **Hipótesis, sin verificar:** Glovo Bridge rellena el piso y la puerta (`address_2 = "Floor: 4, Door: A"`) a partir de los campos estructurados de Glovo, así que esos le llegan. La calle (`address_1`) la toma de otro campo, que en esos pedidos viene vacío.
- **No hay un rasgo del pedido que lo distinga.** Comparando los 22 sin calle con los 201 con calle (25/09–16/10), todos son `Paid online`, `Glovo Bridge`, `asap = false`, `nb_orders = 1`, sin `service_type_ref` y con la misma hora prometida (~15 min). Lo único: a los sin calle les falta también, a menudo, la ciudad (6), el código postal (4) o las coordenadas (2). PRIME no aparece en el pedido. Que G034 fuera PRIME es un dato del panel de Glovo, no de lo que nos llega.
- **Nadie la manda después.** Ninguno de los 22 tuvo un `order.update`: Glovo Bridge solo manda el `new`.

**Qué tiene cada uno de los 22 para poder repartirse:**
- **18**: coordenadas + piso o código postal en `address_2` / `postal_code` + teléfono real del cliente (`+346…`, no centralita). Catcher recibe el pedido por las coordenadas y lo entrega: 16 de 17.
- **2** (G359 y G034): coordenadas y teléfono, pero ningún texto. Folvy no los manda a Catcher, porque `deliveryFromHubrise` exige texto (`if (!address) return null`).
- **2** (G431 y G766, Scandal Burgers): sin cliente ninguno, ni teléfono ni coordenadas.

**Qué falta para cerrar la causa, y no necesita token:** que Julio abra `vx238b7` en el back office de HubRise (manager.hubrise.com, local `1b6p8-0`).
- Si ahí **sí** está la calle, HubRise la tiene y no la manda en el callback. Se le reclama a HubRise, y un `GET` del pedido la traería (eso es el «reintentar» del punto 7).
- Si **no** está, el fallo es de Glovo Bridge. Se le reclama a HubRise/Glovo con las 22 referencias (`platform_order_ref`), y reintentar no serviría de nada.

**Propuestas de arreglo (no hechas, por orden de impacto), para que Julio elija:**
1. **Reclamar a HubRise (Glovo Bridge)** con los 50 pedidos (`platform_order_ref`) y la fecha del primero (G322, 02/09 22:06). Es lo único que arregla la causa.
2. **Mientras tanto, mandar a Catcher con coordenadas aunque no haya texto** (G359 y G034). Con el texto «Sin calle — ir por el pin · llamar al cliente» y el teléfono, que en Glovo es el real. Es lo que ya funciona en los otros 16.
3. **Geocodificación inversa de las coordenadas** (Mapbox, que ya se usa en `place_shop_order`) para pintar en la tarjeta y en el ticket una calle **marcada como aproximada**. Nunca como si la hubiera mandado el cliente.
4. **Tarjeta**: «La dirección no ha llegado», y el ámbar solo cuando de verdad no se puede mandar (sin coordenadas).

## CAUSA DEMOSTRADA (16/10): Glovo manda la dirección en `label` y Glovo Bridge no la usa

Esta es la petición de Glovo a Glovo Bridge para el pedido 101804690542 (G034). La sacó Julio del registro del conector, y aquí se cita recortada para no meter la dirección del cliente en el repositorio:

```json
"delivery_address": {
  "label": "<calle>, <nº>, <piso y puerta>, <portal>",
  "latitude": <lat>, "longitude": <lng>,
  "street_name": null, "street_number": null, "postal_code": null,
  "floor_number": null, "door_number": null, "building_name": null,
  "additional_information": null, "province": null
}
```

- **Glovo sí manda la dirección completa** (calle, número, piso y portal), pero solo en `label`, que es el texto que escribió el cliente. Los campos sueltos vienen a `null`.
- **Glovo Bridge monta `customer` solo con los campos sueltos y no usa `label`**, así que la dirección se pierde entera. La respuesta de HubRise lo confirma: `address_1`, `address_2`, `postal_code`, `city` y `delivery_notes` vienen a `null`.
- Con esto se explica todo lo de Glovo:
  - Los 50 sin calle desde el 02/09 son pedidos con `street_name` vacío. Si traen `floor_number` y `door_number`, el piso llega igual («Floor: 4, Door: A»).
  - El cambio del 31/08 es el conector cambiando cómo coloca esos campos sueltos.
- **El arreglo es de HubRise:** usar `label` cuando los campos sueltos estén vacíos, o pasarlo siempre como texto. Folvy no lo puede recuperar, porque HubRise no lo guarda.
- **En Folvy, mientras tanto:** las coordenadas llegan siempre, y el teléfono es el real del cliente, así que se puede mandar a Catcher por coordenadas. Sin hacer.

## PRUEBA (16/10, back office de HubRise, mirado por Julio): Glovo Bridge creó G034 sin dirección

- En el pedido `vx238b7` del back office de HubRise, «Customer» enseña **solo el nombre y el teléfono**: HubRise tampoco tiene la dirección.
- En el registro del pedido hay tres entradas. La primera es la que lo crea: `POST /v1/locations/1b6p8-0/orders`, a las 16:26:53, desde «Glovo Bridge - Meraki Pita». El bloque `customer` de esa petición es, entero:
  ```json
  "customer": { "first_name": "<nombre>", "last_name": "<apellidos>",
                "phone": "<móvil>", "latitude": "<lat>", "longitude": "<lng>" }
  ```
  **Glovo Bridge ni siquiera manda los campos de dirección vacíos: no los incluye.** `customer_notes` va como `""`. `private_ref` es `655851---101804690542`; el 655851 parece el id de la tienda en Glovo. La cabecera `Sentry-Trace` del conector dice `sentry-release=2026100901`, o sea, una versión del conector del 09/10.
- Las otras dos entradas son de Folvy: los `PATCH` de recibido y aceptado, a las 16:26:56 y 16:26:57. En HubRise el pedido sigue en **«Accepted»**: la cancelación de Glovo no llegó ni a HubRise.
- **Conclusión: HubRise y Folvy guardaron bien lo que recibieron. La dirección falta ya en la petición de Glovo Bridge.** Queda una cosa por saber: si Glovo le dio la dirección a Glovo Bridge y el conector la perdió, o si Glovo no se la dio. Eso solo se ve en el registro del propio conector, o preguntando al soporte de HubRise.

## POR QUÉ: la forma de la dirección según de dónde viene (solo reparto propio)

> Fuera, a petición de Julio, todo lo que reparte la plataforma: los 27 de Glovo sin cliente y los 27 de Uber sin calle con `in_delivery` de Uber.
> Folvy guarda `customer` tal cual llega. Lo de abajo es lo que mandan Glovo Bridge y el puente de Uber, no lo que Folvy lee.

### Glovo: el conector ha cambiado de forma dos veces, y se le ve en los datos

| forma | pedidos | desde–hasta | calle | número | piso/puerta (`address_2`) | CP | notas |
|---|---:|---|---|---|---|---|---|
| G2 | 62 | 27/08–**31/08 14:12** | `address_1` sin número | **en `city`** | **nunca** (0/62) | **nunca** | **nunca** |
| G1 | 497 | **31/08 18:44**–hoy | `address_1` con número | en `address_1` | 437/495 | siempre | 171/495 |
| G3 | 38 | **02/09**–hoy | **falta** | — | 30/38 | siempre | 18/38 |
| G4 | 12 | **03/09**–hoy | **falta** | — | **nunca** | 7/12 | **nunca** |

- **Del 27 al 31/08, Glovo Bridge no mandaba ni piso, ni puerta, ni código postal, ni notas, en ningún pedido.** No era cosa del cliente: era el formato. El 31/08, entre las 14:12 y las 18:44, cambió el formato y desde entonces el piso llega en `address_2` («Floor: 4, Door: A», «Bldg.: …»).
- **Dos días después aparecen los pedidos sin calle (G3 y G4), en todas las marcas, y no se han ido.** Ese 31/08 no cambió nada en Folvy que toque la entrada: `raw_tab` es el `new_state` tal cual. **Lo más probable es que sea un efecto del cambio de Glovo Bridge del 31/08.** El formato nuevo saca la calle de un campo de Glovo que en ≈8 % de los pedidos viene vacío. En G4 (12) vienen vacíos también la ciudad, el piso y las notas: solo quedan coordenadas y teléfono.
- **Hoy, en G1, el piso falta en 58 de 495 (12 %).** Ahí no hay ningún campo nuestro sin leer. Lo más probable es que el cliente no lo haya rellenado, pero eso no se puede confirmar sin ver el pedido en Glovo.

### Uber: dos formatos de calle a la vez, y uno sale mucho peor

| forma | pedidos | ejemplo de `address_1` | `city` | sin piso ni notas | entregas fallidas |
|---|---:|---|---|---:|---:|
| UB | 88 | «<nº> <calle>» | «Madrid» | 2 (2 %) | 1 |
| UA | 24 | «<calle> <nº>, <CP> Madrid, Spain» | **«madrid»** (en minúscula) | **5 (21 %)** | **4 (17 %)** |

- Los dos conviven desde el 02/10, en las mismas marcas y los mismos días. UA trae la dirección como una línea de texto con código postal y país, y la ciudad en minúscula. Parece una dirección escrita por el cliente y no elegida del buscador, y es la que llega sin piso. **Las 3 entregas fallidas que acabaron canceladas (U678B6, U9AD50 y U6368C) son las tres UA.**
- **Hay dos campos de Uber que Folvy no lee:**
  - **`phone_access_code`** (139 de 139). Sin él, el teléfono `+34910…` es una centralita que no conecta con el cliente.
  - **`company_name`** (11 de 139). El cliente lo usa para el portal o el edificio: el número del portal, la calle con número o el nombre del edificio o la residencia. Folvy lo tira y Catcher no lo ve.
- El piso de Uber llega en `address_2` como «Unit: …», y a veces el cliente escribe ahí otra cosa («Unit: 28028», el código postal). Eso viene así del cliente.

### Qué falta para cerrarlo
1. **Para HubRise (Glovo Bridge):** el cambio de formato del 31/08, entre las 14:12 y las 18:44, y los 50 pedidos sin calle desde el 02/09, con su `platform_order_ref`. La pregunta concreta: de qué campo de Glovo sale `address_1` desde el 31/08, y por qué viene vacío cuando el panel de Glovo enseña la calle (G034).
2. **Para Uber:** confirmar en el panel, en 2 o 3 pedidos UA, si el cliente rellenó piso o instrucciones. Si los rellenó, el puente los pierde. Si no, es del cliente.
3. **En Folvy (sin hacer):** leer `company_name` y `phone_access_code` de Uber y pasarlos a Catcher.

## 0. Cómo cuento, y por qué no sale lo mismo que en el encargo

Hay **dos clases de «cancelado»** en `sale.status = 'cancelled'`, y no son lo mismo:

- **De la plataforma** (`cancel_reason = 'cancelled'`): llegó un `order.update` de HubRise con `status: cancelled`.
- **Del cierre del día de Folvy** (`cancel_reason = 'No confirmado por la plataforma al cierre del día (…)'`): ninguna plataforma canceló nada. A las 2:00 (antes, a las 6:00) el cierre pasa a cancelado todo lo que sigue `open` (`20261019T0170_cierre_a_las_dos.sql`, `s.status = 'open'`, sin mirar `delivery_state`).

| tramo | pedidos | cancelados por la plataforma | cancelados por el cierre de Folvy | total |
|---|---:|---:|---:|---:|
| a 25/09–03/10 | 124 | 2 (1,6 %) | 3 | 5 |
| b 04/10–13/10 | 213 | 4 | 2 | 6 |
| c 14/10–16/10 | 35 | 4 (11 %) | 2 | 6 (17 %) |
| **desde 04/10** | **248** | **8 (3,2 %)** | **4** | **12 (4,8 %)** |

La suma de 248 pedidos coincide con la del encargo. El número de cancelados no: el encargo dice 10 desde el 04/10 y 5 de 35 en el tramo c; yo cuento 12 y 6. No sé con qué criterio salieron los 10. Las cifras del tramo a (2 de 124) sí coinciden con las de la plataforma.

## 1. Los 12 cancelados desde el 04/10, pedido a pedido

`quién`: **Plat.** es la plataforma por HubRise (`user_id = null` en el aviso: lo hizo el conector, no una persona en HubRise). **Cierre** es el cierre del día de Folvy.
**Motivo: ninguno.** HubRise no manda motivo. En el aviso, lo único que cambia entre `previous_state` y `new_state` es `status`, en los 8 casos.
Todos se mandaron a Catcher en `auto`, salvo G766.

| pedido | canal · marca | quién | entró | listo | recogido | entregado | cancelado | Catcher |
|---|---|---|---|---|---|---|---|---|
| U678B6 | Uber · Milanesa House | Plat. | 04/10 20:10 | 20:26 (+16) | 20:30 | — | 22:15 (+125) | rider asignado · **failed** |
| UAF154 | Uber · Milanesa House | Plat. | 04/10 21:00 | 21:35 (+35) | 21:49 | 22:09 | 21:57 (+57) | rider · delivered **después** de cancelar |
| UBB885 | Uber · Milanesa House | Plat. | 04/10 21:04 | 21:35 (+31) | 21:37 | 22:43 | 22:49 (+105) | rider · delivered (54 min tarde) |
| G656 | Glovo · Milanesa House | Cierre | 07/10 14:33 | 14:47 (+14) | — | — | 10/10 00:07 | rider · canceled en Catcher |
| G766 | Glovo · Scandal Burgers | Cierre | 08/10 22:00 | 22:07 (+7) | — | — | 10/10 00:07 | **no se mandó**: sin dirección |
| U9AD50 | Uber · Meraki Pita | Plat. | 12/10 20:13 | 20:28 (+15) | 20:30 | — | 21:39 (+86) | rider · **failed** |
| G835 | Glovo · Milanesa House | Plat. | 14/10 15:32 | 15:44 (+11) | **16:37** | 16:52 | 16:38 (+66) | rider · recogió 53 min después del listo |
| G017 | Glovo · Milanesa House | Plat. | 14/10 20:09 | 20:22 (+13) | — | — | 22:06 (+117) | rider asignado · canceled, nunca recogió |
| U6368C | Uber · Meraki Pita | Cierre | 14/10 21:44 | 22:08 (+24) | 22:08 | — | 15/10 02:07 | rider · **failed** |
| G847 | Glovo · Bendito Burrito | Cierre | 15/10 15:07 | — | — | **15:28** | 16/10 02:07 | rider · **delivered** |
| U816EB | Uber · Meraki Pita | Plat. | 15/10 20:22 | 20:34 (+12) | 21:19 | 21:33 | 22:02 (+100) | rider · recogió 45 min después del listo |
| U70EC4 | Uber · Meraki Pita | Plat. | 16/10 15:29 | 15:45 (+16) | 15:51 | 15:56 | 16:46 (+77) | rider · delivered **a tiempo** |

(+N = minutos desde que entró.)

Se agrupan en cuatro familias:

- **Entrega fallida en Uber: U678B6, U9AD50 y U6368C (3).** Los tres tienen la calle **sin piso ni puerta**, sin nota y un teléfono `+34910…`, que es la centralita de Uber. Ese número solo funciona con el `customer.phone_access_code`, y **Folvy no lo lee en ninguna parte**: no está en `hubrise-webhook` ni en `catcher-dispatch`. El rider llega, no sabe el piso y no puede hablar con el cliente. De las 110 Uber de reparto propio con calle, solo 7 vienen sin piso, y **4 de esas 7 fallaron** (UF2729 es la cuarta, que no se canceló). Las otras 103 fallaron 0 veces.
- **Tarde: UAF154, UBB885, U816EB, G835 y G017 (5).** O la recogida llegó 45–53 min después del «listo», o la entrega salió 29–54 min tarde, o el rider no llegó a recoger. El cliente o la plataforma cancelaron.
- **Cancelado por Folvy, no por la plataforma: G656, G766 y G847 (3; con U6368C, el cierre canceló 4).** **G847 está entregado** (Catcher `delivered` a las 15:28) y Folvy lo canceló en su cierre porque seguía `open`. El cierre no mira `delivery_state`. Ese pedido está mal en los libros.
- **Sin explicar: U70EC4 (1).** Entregado a las 15:56, 8 min antes de lo prometido, y Uber lo cancela a las 16:46. Puede ser una reclamación del cliente; desde Folvy no se ve.

## 2. Causa más probable de la subida, y qué cambió el 04/10

**La subida es sobre todo de mezcla, y viene de Uber.** Uber cancela entre un 4 y un 9 % de lo que entra, lo reparta quien lo reparta. Glovo cancela casi nada. En los tramos a y b (25/09–13/10), los 322 pedidos de Glovo de cualquier tipo, propio o de plataforma, tuvieron **0** cancelaciones de la plataforma. Y el R02 (04/10) más la decisión de que Uber vaya por reparto propio (desde el 02/10) metieron Uber en Catcher:

| | a | b | c |
|---|---:|---:|---:|
| Uber de reparto propio mandados a Catcher | 10 | 80 | 21 |
| Uber de reparto propio, % cancelado por la plataforma | 8,3 % | 4,3 % | 9,1 % |
| Uber **de plataforma**, mismo % (comparación) | 3,2 % | **8,3 %** (10 de 121) | 0 % |
| Glovo de reparto propio, % cancelado por la plataforma | 0 % | 0 % | 15 % (2 de 13) |

**Catcher no ha empeorado.** Mediana de listo a recogida: 5,8, 3,9 y 3,3 min. p90: 35, 31 y 29 min. Mediana de retraso sobre lo prometido: 21, 19 y 4 min.

**Sobre esa base, Folvy añade dos fallos suyos que sí se pueden arreglar:**
1. No pasa a Catcher el código de acceso del teléfono de Uber, que mata la entrega cuando falta el piso (3 de los 12).
2. El cierre del día cancela lo que sigue `open` aunque esté entregado (G847), y cuenta como «cancelados» pedidos que ninguna plataforma canceló (4 de los 12).

**Qué cambió el 04/10 en cómo se decide y se manda** (de `brand_delivery_policy`):
- 10:19: la **Migración R02** escribe 54 celdas marca × plataforma, `source = migrated`, a partir del interruptor antiguo y de la herencia de `channel_delivery_policy`.
- 10:28–10:30: **Julio** corrige a mano unas 40 (`source = manual`). 22:56: Meraki Pita en Uber. 05/10: Smash Brothers y The Urban Kebab en Uber.
- Desde entonces, `hubrise-webhook` decide `own_delivery` o `platform_delivery` con `resolveDeliveryServiceType` (canal × marca), y `catcher-dispatch` manda en `auto` todo `own_delivery` que tenga texto de dirección y coordenadas.
- **Efecto secundario: hay Uber marcados como propio que en realidad reparte Uber.** 27 pedidos desde el 25/09, 12 de ellos Meraki Pita en `1b6p8-0` en el tramo b. Llegan sin `address_1`, Uber manda `in_delivery` y `completed` (su rider los recoge), Catcher no los recibe y no se cancela ninguno. Pero la tarjeta los pinta en ámbar, «falta la dirección». **Esos 27 son la mitad del «uno de cada diez sin dirección»**, y no les falta nada: los reparte Uber.

## 3. Por qué la cancelación de G034 no llegó a Folvy

- Folvy apunta **todo** lo que entra de HubRise en `external_webhook_log`, antes de decidir nada. Para `vx238b7` hay **un solo aviso**: `order.create` a las 16:26:57 con `status: new`. Ningún `update`. La cancelación no se perdió en Folvy: **no llegó a Folvy**.
- **Glovo no avisa por HubRise de casi nada.** Los 223 Glovo de reparto propio tienen solo el aviso `new`; nunca llegan `accepted`, `in_delivery` ni `completed`. Las únicas cancelaciones de Glovo que han llegado son dos, G835 y G017, las dos del 14/10. Antes del 14/10, 0 de 322.
- Si Glovo solo manda la cancelación a veces, «la cancelación no llegó» es lo normal en Glovo, no un fallo puntual. Sin el aviso, la venta queda `open` hasta que el cierre del día la cancela, y por eso hay Glovo entre los cancelados del cierre (G656, G766).
- **Falta una prueba, y no la he podido hacer: preguntar a HubRise por el pedido** (punto 4). Si HubRise lo tiene `cancelled`, el aviso a Folvy se perdió entre HubRise y nosotros. Si lo tiene `new`, Glovo no se lo dijo a HubRise.
- (Lateral: `upsertSale` no toca una venta que ya no está `open`. La cancelación sí entra igual, porque `cancelByOrderId` va antes y cancela aunque esté cerrada.)

## 4. G034, G588 y G974: ¿llegó la dirección más tarde?

**La consulta a HubRise no se ha podido hacer desde esta sesión**: el proxy del contenedor rechaza `api.hubrise.com:443` (`connect_rejected`). Para Julio (solo lectura, con el token de la conexión de `1b6p8-0`):

```
curl -s -H "X-Access-Token: <token de 1b6p8-0>" https://api.hubrise.com/v1/locations/1b6p8-0/orders/vx238b7
curl -s -H "X-Access-Token: <token de 1b6p8-0>" https://api.hubrise.com/v1/locations/1b6p8-0/orders/n9kb22b   # G588
curl -s -H "X-Access-Token: <token de 1b6p8-0>" https://api.hubrise.com/v1/locations/1b6p8-0/orders/8q2e3vk   # G974
```

Mirar `status`, `customer.address_1` y `customer.address_2`.

Lo que sí dice la base:
- **Ninguno de los tres tuvo un `update` en HubRise.** Un solo aviso `create` cada uno. Si la dirección llegó después a HubRise, nadie avisó a Folvy.
- **No es un caso de tres: es un patrón de Glovo.** Desde el 25/09, **22 de 223** Glovo de reparto propio (10 %) llegan con `address_1 = null`. Casi siempre traen el piso en `address_2` («Floor: 3, Door: A»), el código postal y las coordenadas, pero no la calle.
- **De esos 22, 17 se mandaron a Catcher y 16 se entregaron** (G854 falló). `catcher-dispatch` manda las coordenadas, y un texto como «Floor: 4, Door: A, 28017» le basta como dirección: G588 y G974 se entregaron en 13 y 6 min. Los que no traen ni piso ni código postal se quedan con `delivery_address` vacío y no se mandan: **G431, G766, G359 y G034**. G172 tampoco se mandó, con texto; no lo he mirado.
- **PRIME no se ve en el pedido.** `raw_tab` no contiene «prime» en ninguno de los tres. `service_type_ref`, `delivery`, `delivery_quotes` y `driver_pickup_url` vienen vacíos, igual que en los Glovo con calle. Desde Folvy no se puede saber si G588 y G974 eran PRIME. Eso hay que mirarlo en el panel de Glovo, igual que se hizo con G034.

## 5. El piso: ¿viene en un campo que no leemos?

Reparto propio con calle, desde el 03/10:

| canal | con calle | piso en `address_2` | piso solo en `delivery_notes` | piso dentro de la calle | **sin piso en ningún sitio** |
|---|---:|---:|---:|---:|---:|
| Glovo | 127 | 109 | 12 | 0 | **6** |
| Uber | 110 | 96 | 7 | 0 | **7** |
| Just Eat | 6 | 0 | 0 | 5 | 1 |

- Ya leemos `address_2` y `delivery_notes`: el piso no se pierde en ninguno de los 228 que lo traen.
- En los 14 sin piso, no hay piso en ningún otro campo del pedido (`company_name`, `customer_notes`, `seller_notes`, `custom_fields`). Lo único que traen y no leemos es **`customer.phone_access_code`**, en los 7 de Uber y en el de Just Eat. No es el piso, pero es lo que permite al rider llamar y preguntarlo. Lo traen **132 de 132** Uber de reparto propio, todos con teléfono `+34910…`.

## 6. La tarjeta (sin tocar todavía)

- `src/modules/reparto/lib/etiqueta.ts:60`: `detalle: \`${plataforma} no la ha mandado\``. Pasaría a `'La dirección no ha llegado'`, que es lo que de verdad sabemos. La prueba que hay que cambiar: `tests/unit/modules/reparto/etiqueta.test.ts`.
- **Más importante que el texto:** con los datos de arriba, en Uber «sin `address_1`» significa casi siempre «lo reparte Uber» (27 de 27 con aviso `in_delivery` de Uber). La tarjeta debería reconocerlo, en vez de pedir una dirección que no hace falta.
- Y en Glovo, «sin calle pero con coordenadas y piso» se entrega (16 de los 17 que se mandaron). El ámbar debería ser solo para lo que de verdad no se puede mandar.

## 7. «Pedirla al cliente»: reintentar HubRise antes

Hoy (`EtiquetaReparto.tsx:91`) es un `tel:` al teléfono del cliente o el enlace al portal. Para que pruebe primero a traer la dirección otra vez de HubRise:

- Haría falta un `GET /locations/{loc}/orders/{id}` desde una edge function. Hoy **no hay ninguna que lea un pedido de HubRise**: `hubrisePush.ts` solo empuja estados.
- Con los datos de hoy, **el reintento no la habría encontrado** en ninguno de los tres, salvo que la consulta del punto 4 diga otra cosa: HubRise no mandó ningún `update`. Antes de construirlo, la respuesta de esa consulta decide si vale la pena.
- Lo que sí habría servido en G034 es mandarlo a Catcher **con las coordenadas** (las traía) y el teléfono, como se hizo con G588. Hoy no sale porque `deliveryFromHubrise` exige texto de dirección.

## 8. Pendiente, por orden

1. Que Julio lance las tres consultas del punto 4 (y diga qué `status` tiene `vx238b7` en HubRise).
2. Que alguien mire en el panel de Glovo si G588 y G974 eran PRIME.
3. Decidir el orden de los arreglos. Ninguno está hecho:
   - pasar `phone_access_code` a Catcher;
   - que el cierre no cancele lo que Catcher dio por `delivered`, y corregir G847;
   - el Uber de reparto propio sin `address_1` y con `in_delivery` de Uber (las celdas de Meraki Pita en `1b6p8-0`);
   - el texto y el ámbar de la tarjeta;
   - mandar a Catcher con coordenadas cuando no hay texto.
