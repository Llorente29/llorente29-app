# Parte — la base aplicada y los seis retoques · 17/09/2026, 08:25

Rama `claude/cool-mccarthy-5we9rc`. **La base está aplicada y comprobada a las
08:03**, tres horas y media antes del límite. Los seis retoques, hechos, con sus
capturas. Nada en `main` todavía: eso espera tu visto.

---

## 1 · La base · antes y después

Reloj de la base **08:02:21** al medir el antes, **08:03:19** al medir el
después. Última venta 16/09 23:30, dos pedidos abiertos de anoche, los dos en
Carabanchel.

| | antes | después |
|---|---|---|
| columnas `manual_*` en `sale` | **ninguna** | `manual_close_reason` · `manual_close_note` · `manual_closed_at` · `manual_closed_device_id` |
| `cerrar_a_mano_by_token` | **no existe** | existe · `SECURITY DEFINER` · guarda de cuenta **sí** · guarda de local **sí** · apunta el aparato **sí** |
| permisos | — | `anon=X, authenticated=X, service_role=X, public=—` |
| `pase_ficha` · md5 | `e2ae858dbaee3336746d1385882fd878` | `cafe73cd760571096df178813acf22d0` |
| `pase_ficha` · ¿manda bolsa y cómo avanzó? | **no** | **sí** |

Los tres cambios que pediste antes de aplicarla están dentro: la cuarta columna
(`manual_closed_device_id`), la cabecera corregida a **cuatro** columnas con la
vuelta atrás completa, y `set lock_timeout = '3s'` delante de los `alter`.

### `pase_ficha` v2, con tres pedidos reales

| pedido | bolsa | cómo avanzó |
|---|---|---|
| J191403139 · JustEat con flota | hecha · 22:49 · 0 intentos | flota |
| U130B6 · Uber por HubRise | hecha · 22:37 · 0 intentos | persona |
| G858 · Glovo por Glovo | hecha · 21:53 · 0 intentos | persona |

### `cerrar_a_mano_by_token`, ensayado sobre un pedido real

G959, Carabanchel, abierto desde las 22:04 de anoche.

| paso | resultado |
|---|---|
| **antes** | `status=open · order_status=awaiting_collection · closed_at=— · motivo=— · aparato=— · movimientos=5` |
| **token de otro local** | **rechazado** · «cerrar_a_mano_by_token: ese pedido no es de este local» (token de Alcalá sobre pedido de Carabanchel) |
| **después de cerrar** | `status=closed · order_status=completed · closed_at=08:16:01 · motivo=rider_no_puede · aparato=Tablet camichi4 · movimientos=13` |
| devuelve | `{"motivo":"rider_no_puede","aparato":"Tablet camichi4","closed_at":"…06:16:01Z","ya_estaba":false}` |
| **tras deshacer** | `status=open · awaiting_collection · closed_at=— · motivo=— · aparato=— · movimientos=5 · updated_at 16/09 22:25:57` |

El pedido quedó **exactamente igual que antes**, hasta el `updated_at`.

### 🔴 Una corrección a tu criterio, con el número delante

Pediste comprobar que «**el consumo no cambia**». **Sí cambia: de 5 movimientos
a 13.** Y es lo correcto, pero hay que decirlo con las palabras exactas, porque
no es lo mismo:

- **No se REVIERTE** nada — eso es lo que hace `cancel_sale` y por eso no sirve.
- **Sí se GENERA** el consumo, porque `close_sale` llama a
  `generate_sale_consumption` en todo cierre. Cerrar a mano es el cierre normal,
  así que consume como el cierre normal: la comida se hizo y sale del almacén.

O sea que el texto que aprobaste para la pantalla es exactamente el correcto
—«No se devuelve nada al almacén: la comida se hizo»— y el criterio del encargo
era el que estaba mal formulado. Lo digo porque la diferencia importa: si
alguien cierra a mano un pedido que nunca se preparó, el stock sale igual.

### Qué pasa fuera de Folvy al cerrar a mano

Mirado en `order-advance/index.ts`, y confirma lo tuyo:

| canal | qué sale |
|---|---|
| **HubRise** (cualquier servicio) | **nada**: la función se planta en `if (sale.source !== "lastapp") → "canal sin empuje saliente"` |
| **Last · plataforma** | **nada**: `if (newStatus === "completed" && service_type === "platform_delivery") → "plataforma cierra en su sistema"` |
| **Last · recogida y reparto propio** | **sí se empuja `DELIVERED`** a Last (`completed: "DELIVERED"`) |

**Catcher:** `order-advance` sólo habla con Last, así que **el servicio en
Catcher se queda abierto**. Y sobre si su `delivered` posterior reescribe algo,
leído en las tres funciones:

- `tg_sale_seal_delivered` sólo escribe `delivered_at` **si está en NULL** →
  rellena un hueco, no pisa nada.
- `close_sale` hace `closed_at = coalesce(closed_at, delivered_at, now())` → el
  `closed_at` del cierre a mano **se queda**.
- `manual_close_reason`, `manual_closed_at` y `manual_closed_device_id` no los
  toca nadie más.

O sea: llega la entrega de verdad, se apunta su hora, y el cierre a mano
conserva la suya y su motivo. **La guarda no reescribe nada.**

---

## 2 · El 305 en las tablets: cómo funciona la descarga

**1 · Cada ciclo** `checkForBundleUpdate()` lee `apps/bundle.json` y compara
`bundleId` con el que corre.
**2 · Si hay uno nuevo**, `prefetchOtaBundle()` lo **descarga al disco de la
tablet** —Capgo lo deja ahí sin activar— y guarda su `id` en memoria.
**3 · A partir de ahí la tablet ya no necesita el manifiesto**: sólo espera a
que se abran las dos llaves (fuera del horario del local y cocina en calma) y
llama a `applyOtaBundle(id)`. **Ese paso no volvía a mirar el manifiesto.**

Con las horas: el zip se subió a las **22:26:48** y el manifiesto se retiró a las
**23:04:43**. **Treinta y ocho minutos** de ventana, que es lo que las dos
tablets de Alcalá aprovecharon. Se quedaron encendidas toda la noche con el id
en memoria y lo aplicaron por la mañana con la cocina parada. Carabanchel, que
no llegó a bajárselo, sigue en el 303 — **la retención sí funcionó para lo que no
estaba descargado**.

**Mi «las tres en 303, comprobado al terminar» era verdad a las 23:04 y dejó de
serlo a las 07:51.** Lo que faltó no fue la comprobación: fue entender que lo que
estaba comprobando no era estable.

### La forma de retener que sí funciona

Escrita en `CLAUDE.md`, sección **«Retener un paquete OTA no es quitar el
manifiesto»**, y son las dos cosas:

1. **El manifiesto apunta a la versión que ya corren**, no se borra.
2. **La tablet vuelve a mirar el manifiesto antes de instalar lo descargado** —
   `sigueEstandoPublicado()`, implementado hoy. Si contesta y ya no es ese
   paquete, se descarta. **Si no contesta, se aplica igual**: la lección del
   13/09 es que una tablet que no puede actualizarse porque la red va mal se
   queda clavada para siempre y en silencio.

Y lo que hay que asumir: **un paquete retenido después de publicarse ya no se
puede retirar de las tablets que lo cogieron. Sólo se puede tapar publicando uno
posterior.** Por eso el paquete de hoy llevará número **mayor que 305** —sale del
`run_number` del workflow, que ya va por ahí— y **el zip retenido se queda donde
está**, en `retenido-20260916/`, sin volver a publicarse nunca.

---

## 3 · Los seis retoques

**1 · El código de la esquina, entero.** `J191403139` sale entero, y la función
de acortar ya no existe. **Y tienes razón en lo de fondo:** te pedí que
decidieras tú y lo cambié igual. Lo que hice mal no fue el criterio, fue el
sitio: eso iba al parte como propuesta, no al código.

**2 · «Cerrar a mano», sin palabras técnicas.** Fuera `--order_status =
completed--`. Ahora: «Se cierra como un pedido entregado y queda apuntado por
qué. No se devuelve nada al almacén: la comida se hizo.» Capturas 08 a 11, con
los cuatro pasos: la hoja abierta, con pedido y motivo elegidos, con «Otro» y su
cuadro de texto y el botón apagado diciendo «Escribe el motivo», y la
confirmación con contenido.

**3 · 🔴 «Lo dice la flota» en Uber, y aquí te corrijo con la consulta delante.**

El caso que citas, **U130B6, no es el de la deuda**: en ese pedido **sí lo pulsó
una persona**. La prueba es la bolsa, que se imprime al pulsar «Listo»:

| pedido | Listo | recogida | hueco | bolsa pedida |
|---|---|---|---|---|
| **UD12A3** | 22:00:53 | 22:00:53 | **0,3 s** | **21:47:48** → trece minutos ANTES del «Listo» |
| **U130B6** | 22:37:09 | 22:37:54 | 45,3 s | **22:37:09** → al segundo del «Listo» |
| U2E2EC | 22:37:14 | 22:38:07 | 53,1 s | 22:37:14 |
| J191403139 | 22:49:11 | 22:49:49 | 38,2 s | 22:49:11 |

**Lo que sí fallaba era mi maqueta**, no el producto: en `datos.ts` derivaba
«avanzó por flota» de que hubiera recogida, así que la captura de U130B6 decía
«lo dice la flota» cuando la RPC de verdad devolvía «persona». Arreglado el
dato, y arreglada la lógica para que no pueda volver a pasar:

- **«lo dice la flota»** sólo con `carrier_code`/`has_courier`, que es lo único
  que significa Catcher. Un pedido de plataforma **no puede decirlo nunca** — hay
  una prueba que recorre seis huecos distintos para comprobarlo.
- **«nadie lo pulsó: lo puso la recogida de Uber»** cuando el «Listo» y la
  recogida caen a **2 segundos o menos**, que es lo que separa hoy a UD12A3 de
  los otros tres. ⚠️ Con nueve pedidos que tengan los dos sellos, eso es lo que
  hay hoy, no una ley: el arreglo de verdad es guardar QUIÉN escribió el sello.
- **«lo marcó una persona»** en todo lo demás.

**4 · Un solo pie.** Apagar a la izquierda, pequeño; el aviso y «Cerrar a mano» a
la derecha. **En 1024 × 600 se ven dos tarjetas enteras y la tercera casi
completa** —nombre, código, pastilla, plato y botón; se corta el borde de
abajo—. Antes eran dos y media. Captura 01.

**5 · Nombres cortos en los botones.** «Llamar al repartidor · Lelis D.». El
nombre entero se queda en la línea de la tarjeta y en «Quién lo lleva».

**6 · Capturas marcadas.** El nombre del fichero dice `REAL` o `MONTADA`. Las
montadas son **dos**: la bolsa sin salir (esta noche no falló ninguna impresora)
y el «Sin coger» (tampoco hubo ninguno). La pareja de G918 va marcada: la 13 es
el pedido **real, con teléfono**; la 14 es **el mismo, montado sin teléfono**,
que es el caso de los siete. Y va la 04, el «ver» desplegado con las siete que se
fueron solas.

---

## 4 · Medido a los dos lados

| | antes | después |
|---|---|---|
| lint | 1025 problemas · 757 errores · 268 avisos | **1025 · 757 · 268** |
| pruebas | 1596 en 105 ficheros | **1604 en 105** |
| `tsc -b` | limpio | limpio |
| `npm run build` exacto y en limpio | exit 0 | **exit 0** |

## 5 · Lo que falta, y en qué orden

1. Tu visto a las capturas.
2. `npm run build` exacto, fusión a `main`, **READY en Vercel**.
3. Paquete nuevo con número mayor que 305; el zip retenido se queda donde está.
4. Comprobar que las dos tablets de Alcalá lo aplican: `bundle_applied` y hora.
5. Captura desde la tablet del Pase, con la barra de arriba.
6. Y después, mirar si la ficha de la tablet «Pase» vuelve a decir `web`: al
   aplicar el paquete se reinicia y escribe su versión real, pero si la pestaña
   sigue abierta en un ordenador la volverá a pisar. **No la toco a mano.**
