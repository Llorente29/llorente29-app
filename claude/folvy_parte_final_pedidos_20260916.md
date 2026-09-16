# Parte final — el paquete de Pedidos · 16/09/2026, 22:25

Fusionado a `main` en **`8b4c3a4c`**. Todo lo de abajo está **en producción**, no
commiteado: de cada pieza se dice cómo se comprobó.

---

## Las seis piezas del encargo

| # | pieza | estado |
|---|---|---|
| 1 | desplegar `catcher-webhook` + `hubrise-webhook`, cerrar G231 y G764 | ✅ |
| 2 | el cierre de Last no borra `ready_at` ni `handed_to_courier_at` | ✅ |
| 3 | el front de A y B | ✅ aprobado y fusionado |
| 4 | los `ready_at` perdidos | ✅ los ocho, devueltos |
| 5 | verificación de punta a punta con pedidos reales | ✅ |
| 6 | la guarda en forma FV001, deuda retirada | ✅ |

Y tres cosas que no estaban en el encargo y salieron por el camino: la pestaña
**«En ruta»** con la opción A, los cuatro arreglos del **Pase**, y la **puerta**
de la prohibida.

---

## Lo que está aplicado, y con qué se comprobó

**En la base** — seis migraciones:

| versión | qué hace |
|---|---|
| `20260916171431` | la guarda de idempotencia del consumo |
| `20260916172201` | `closed_at` es la hora de entrega |
| `20260916180501` | la guarda en forma **FV001**, y se retira la deuda del escandallo duplicado (21.573 → 17.833 caracteres) |
| `20260916184131` | recuperar el «Listo» desde Last por `tabId` |
| `20260916192816` | `pase_board` manda `source` |
| `20260916194500` | «Se lo ha llevado»: el Pase puede sellar la recogida |

**En las edge** — las tres comprobadas **byte a byte contra `main`**, no por el
color del run:

| función | versión | md5 desplegado = repositorio |
|---|---|---|
| `catcher-webhook` | 40 | sí |
| `lastapp-webhook` | 76 | sí |
| `hubrise-webhook` | **57** (por la puerta manual) | sí, `5988db5d…` |

---

## Verificado en vivo, con pedidos de verdad

**El cierre a la hora de entrega**, cuatro veces: G231 15:29:57, G764 16:16:04,
G292 20:43:38, G941 21:47:00, G064 21:56:03 — `closed_at` = `delivered_at`.

**El consumo se escribe UNA vez.** De los pedidos de HubRise posteriores al
despliegue de las 21:12, **todos con un solo instante de escritura** y **0
fallos de consumo**. G292: 9 movimientos, último escrito a las 20:13:38, o sea
que la pasada del cierre no reescribió nada.

**El sello de recogida de Uber por HubRise, cuatro de cuatro y solos:**

| pedido | «Listo» | recogido |
|---|---|---|
| U987F2 | 21:50:35 | 21:52:30 |
| UE17A4 | 21:50:29 | 22:00:26 |
| U88129 | 21:50:32 | 22:00:44 |
| UD12A3 | 22:00:53 | 22:00:53 |

La atribución está cerrada: esos pedidos tienen `delivery_state` en **null**, así
que el disparador `tg_sale_seal_handed_to_courier` no pudo escribirlo —exige un
cambio de `delivery_state`— y no queda otro escritor que la edge nueva.

**La entrega**, dos veces: U88129 a las 22:16:28 y U987F2 a las 22:19:15, las dos
cerrando la venta.

**Los ocho «Listo» devueltos**, leídos de la analítica de Last por `tabId`, con
los ocho `tabId` casando por prefijo con el `external_tab_ref` que ya teníamos:
G496 11:45:34 · G430 11:45:36 · U996 12:17:25 · G042 12:50:09 · U997 13:15:32 ·
U998 13:15:36 · G448 13:15:36 · G858 13:35:33 (UTC). Nada más cambió, y el
consumo no se tocó: en las ocho el último movimiento sigue siendo el de su hora
de cierre.

---

## 🔴 Lo que se torció por el camino, y lo pagué yo

**Di por desplegada una función mirando el color del run.** El despliegue de las
19:41 salió VERDE y yo dije «las dos funciones». `hubrise-webhook` estaba
**prohibida por nombre** en el propio workflow —lo dice su cabecera, y no la
leí— así que solo salió `catcher-webhook`. La mitad de Uber de la pieza 2 estuvo
**dos horas commiteada y sin efecto**, y lo descubrí porque U8C4DE pasó a
`in_delivery` sin escribir su recogida. Es la regla 5 y la del repositorio a la
vez. Queda escrito en `CLAUDE.md`, dentro de la regla 1, junto con la puerta.

**La primera prueba de la guarda medía mal.** La llamada y las comprobaciones
iban en la misma sentencia `SELECT`, así que las subconsultas leían el snapshot
del principio. Dio un rojo falso y un verde falso. Lo cazó Julio.

**El vuelta-atrás de la migración de las 19:14 no funcionaba**: su expresión
regular esperaba dos saltos de línea donde había tres. Se vio al ir a usarlo.
Por eso el de FV001 no es textual: guarda el cuerpo en una tabla.

**Dos cifras mías, mal.** «31 minutos» de U511 eran 30,47. Y de los ocho sellos
perdidos dije primero que solo uno era recuperable; Julio encontró los ocho en
la analítica de Last.

---

## Deudas que quedan abiertas, con su caso real

**1 · El sello de cocina no siempre mide cocina.** `UD12A3` tiene el «Listo» y la
recogida **en el mismo segundo, 22:00:53**. Nadie pulsó «Listo» en cocina: lo
selló el propio aviso de Uber al pasar a `in_delivery`, porque
`tg_sale_seal_kpi_hitos` sella `ready_at` en esa transición. Cualquier media de
tiempo de preparación que incluya esos pedidos está contando ceros que no son
ceros. No es raro: de 106 avisos de `in_delivery` en 7 días, 9 llegaban en el
mismo segundo que el «Listo».

**2 · En Uber por HubRise, `closed_at` va 0,4–1,1 s ANTES de `delivered_at`.**
Medido: U88129 0,507 s, U987F2 1,105 s, U8C4DE 0,431 s. La causa es mía y es una
lectura incompleta: escribí el sello de entrega «antes del `close_sale`», y lo es
—antes del explícito— pero el que manda es el del DISPARADOR, que corre dentro
del `upsertSale` cuando `order_status` pasa a `completed`, o sea **antes** de que
mi bloque escriba `delivered_at`. El comentario del código afirma algo que no se
cumple, y eso es peor que el segundo. No lo arreglo esta noche por mi cuenta:
toca la prohibida y eso tiene su ceremonia.

**3 · Al regenerar, el consumo de un pedido pasado toma el coste medio de HOY**,
no el del día de la venta. Apuntada por Julio el 16/09.

**4 · FV001 cuesta 46,6 ms por llamada** frente a los 17,7 de la guarda que
sustituyó. No es una regresión: FV001 cuesta lo que costaba el original, y lo
que se pierde es un atajo. Un cierre son dos llamadas: 93 ms frente a 35.

**5 · El grupo 1 y el grupo 2 están escritos a mano**, con sus números al lado,
en `sabemosSuCiclo`. Si mañana un conector empieza o deja de mandar el ciclo,
esto se queda mintiendo en silencio. La señal es un «Esperando repartidor» que no
se vacía nunca, o un Terminados con pedidos que luego resultan tener recogida.

**6 · El token de la tablet «Pase» de Alcalá quedó escrito en el chat.** Rotarlo.
La solución de verdad es D14, «ver la pantalla de un local» sin token.

---

## Lo que queda mirando

Las tres tablets siguen en **bundle 303** con **17 pedidos abiertos** y latiendo
al minuto, que es exactamente lo correcto: recogen cuando pueden y esperan
cuando no. El **304** entra cuando su cocina esté en calma.
