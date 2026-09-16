# Parte — el paquete de Pedidos, 16/09/2026 20:10

Rama `feat/pedidos-cierre-al-entregar`. **Nada fusionado a `main`**: el front
espera tu visto bueno. Las dos edge y las tres migraciones ya están vivas.

| # | pieza | estado |
|---|---|---|
| 1 | desplegar `catcher-webhook` + `hubrise-webhook`, cerrar G231 y G764 | ✅ hecho |
| 2 | el cierre de Last no borra `ready_at` ni `handed_to_courier_at` | ✅ hecho y desplegado |
| 3 | el front de A y B | 🟡 **vista previa lista, esperando tu sí** |
| 4 | los `ready_at` perdidos | 🟡 **lista abajo, esperando tu sí** |
| 5 | verificación de punta a punta con pedidos reales | 🟡 en marcha, faltan pedidos |
| 6 | la guarda en forma FV001, deuda retirada | ✅ hecho y aplicado |

---

## 1 · Los dos pedidos cerrados de verdad

Despliegue `35129682296`, verde, sha `2520eb0d`, las dos funciones.

| | antes | después |
|---|---|---|
| **G231** `5gg5qqk` | open / awaiting_collection · `closed_at` null · 8 movs · 1388,904 | **closed / completed** · `closed_at` 13:29:57.588 = `delivered_at` · **8 movs · 1388,904** |
| **G764** `3qq4pe5` | open / awaiting_collection · `closed_at` null · 19 movs · 1095,179 | **closed / completed** · `closed_at` 14:16:04.183 = `delivered_at` · **19 movs · 1095,179** |

Mismos movimientos y misma cantidad al milésimo: la guarda no reescribió nada.
0 notas de salto nuevas. **0 empujes, y es estructural, no suerte:** los dos son
`source = 'hubrise'` y `trg_sale_push_status` solo empuja `lastapp`. `ready_at`
y `handed_to_courier_at` intactos tras el cierre.

## 2 · Por qué el cierre de Last borraba la hora del «Listo»

`upsertSale` mandaba `order_status: 'accepted'` en CADA aviso, también en el
`tab:closed`. Sobre una venta todavía abierta, eso es letra por letra lo que
`tg_sale_seal_kpi_hitos` entiende por REABRIR desde el 15/09: al volver a un
estado de cocina, **borra `ready_at`**. Un instante después `ingestBill` ponía
`completed` y la venta se cerraba ya sin la hora.

**Ensayo en transacción revertida sobre G858:**

| paso | `order_status` | `ready_at` | `handed_to_courier_at` |
|---|---|---|---|
| 1 · con el «Listo» dado | awaiting_collection | 17:49:26 | 17:44:26 |
| 2 · tras el update del cierre | accepted | **— BORRADO —** | 17:44:26 |

G858 quedó intacta después del ensayo.

**El arreglo:** `order_status` sale de `common` y pasa a escribirse SOLO en el
insert. Last no tiene ciclo de pedido —abre y cierra comandas—, así que su
«accepted» es un valor de nacimiento, no una verdad que refrescar. Desplegado:
`lastapp-webhook` versión **76**, byte a byte igual a la rama.

**`handed_to_courier_at` no lo borra nadie**, y va medido en vez de supuesto: el
único sitio de toda la base que escribe un `ready_at := null` es ese disparador,
y de `handed` no hay ninguno. Además las ventas de Last no llevan
`delivery_state`, así que ese sello no llega a existir en ellas. Esa mitad del
encargo era preventiva y queda dicho.

## 4 · Los sellos perdidos: son OCHO, y todos son de HOY

Lo primero, una corrección al encargo: **el 15/09 no se perdió ninguno.**
40 de 40 en Alcalá y 32 de 32 en Carabanchel, con el disparador ya vivo. Los
ocho son del 16/09.

| pedido | local | aceptado | cerrado por `tab:closed` |
|---|---|---|---|
| G496 | Carabanchel | 11:22:20 | 13:30:09 |
| G430 | Carabanchel | 11:30:12 | 13:40:06 |
| U996 | Carabanchel | 12:07:20 | 14:10:06 |
| G042 | Carabanchel | 12:31:05 | 14:40:07 |
| U997 | Carabanchel | 13:03:07 | 15:10:03 |
| U998 | Carabanchel | 13:04:04 | 15:10:05 |
| G448 | Carabanchel | 13:13:17 | 15:20:05 |
| G858 | Alcalá | 13:23:36 | 15:30:08 |

**El discriminador no es el local.** Carabanchel sella normalmente: 20/20, 7/7,
32/32, 44/44, 32/32 los días anteriores. Es **quién cerró primero**: las cinco
de hoy que conservan el sello se cerraron a las 13:23 por otro camino, y cuando
llegó su `tab:closed` la guarda `status !== 'open'` ya no dejó tocarlas. Las
ocho seguían abiertas cuando llegó el suyo.

### Qué se puede devolver, y qué no

**Una sola, y con dos rastros que coinciden: G858** → `ready_at` =
**2026-09-16 13:35:32 UTC** (15:35:32 de Madrid). Lo dicen dos cosas
independientes: la bolsa se imprimió a las 13:35:32 —y `tg_auto_print_bag_on_ready`
solo imprime al pasar a `awaiting_collection`— y hay un empuje a `order-advance`
a las 13:35:32.496.

**Las otras siete, no, y digo por qué en vez de inventar una hora.** Carabanchel
tiene `bag_on_ready` apagado, así que su bolsa sale al aceptar y no deja rastro
del «Listo». Queda el empuje: en `net._http_response` hay **cinco** respuestas
de «Listo» sin dueño hoy (12:17:24, 12:50:09, 13:15:31, 13:15:35 y 13:15:35),
que prueban que **el «Listo» sí se pulsó** —o sea, la pérdida es real y no es
que nadie lo marcara—, pero esas filas no llevan el id de la venta y pg_net ya
purgó todo lo anterior a las 11:55. Cinco empujes para siete candidatos: ninguna
asignación es forzosa. Poner hora a cualquiera de ellas sería elegirla, no
medirla.

**Lo que pido:** ¿escribo `ready_at` de G858 y dejo las otras siete apuntadas
como perdidas? Es una sentencia, con su vuelta atrás.

## 6 · La guarda, en forma FV001

Migración **`20260916180501`**, aplicada y verificada. El cuerpo queda literal y
una sola vez dentro del bloque con `EXCEPTION`. **La deuda del escandallo
duplicado queda retirada**: 21.573 → 17.833 caracteres.

| prueba | resultado |
|---|---|
| 1 sin cambios (G190) | devuelve 27 · 27/27 · huella igual · **mismos identificadores** |
| 2 coste cambiado | huella distinta · ids nuevos · `unit_cost` 0,004821 → 0,007232 |
| 3 ficha cambiada | cantidad −300 → −600 · 27 |
| 4 anulada con corte (G979) | 1/1 · mismos ids · devuelve 1, igual que hoy |
| 5 bajo el corte (G645) | misma huella `7b670658…` y 10 movimientos con la guarda de hoy Y con FV001 |
| 6 anulada libre (fabricado) | 27 → 0 → 0 |

El parte del 15/09, antes y después: **992 bien · 0 averías · 0 faltan · 5
retenidos · 0 cantidad distinta · 259 uds · 258 descuentan**. Idéntico.

**Tres cosas que tienes que saber, y no las he decidido yo solo:**

1. **El número que devuelve.** Puse tu `RETURN count(*)` literal. Cambia en un
   caso real: G979 —anulada, su único movimiento protegido por un corte— da
   **1 con `count`** y **0 con `v_written`**. El 1 es exactamente lo que
   devuelve producción hoy. Lo usan cuatro llamadores y los cuatro lo suman a un
   contador de informe; ninguno decide una escritura con él.
2. **`NOT v_legacy` en la condición, y es mío.** La huella solo mira lo que
   cuelga de la VENTA, y en una venta por debajo del corte del motor viejo la
   función también borra lo que cuelga de la LÍNEA, que la huella no ve. Sin esa
   exclusión se desharía justo el borrado que arregla el duplicado. Es la misma
   exclusión que tenía la guarda de las 19:14.
3. **El coste que pediste medir**, G190, 5 llamadas cada uno, revertidas:
   **17,7 ms** la guarda de las 19:14 contra **46,6 ms** FV001. La vieja
   comparaba ANTES y se iba sin trabajar; FV001 trabaja y lo deshace. O sea,
   FV001 cuesta lo que costaba el original y lo que se pierde es un atajo. Un
   cierre son dos llamadas: 93 ms frente a 35.

**Y un hallazgo de paso, que también es una regla:** el vuelta-atrás textual de
la migración de las 19:14 **no funcionaba**. Su expresión regular esperaba dos
saltos de línea donde había tres y no quitaba nada. Se vio al ir a usarlo. Por
eso el de hoy no es textual: la migración guarda el cuerpo de antes en
`_backup_gsc_20260916_fv001` y volver atrás es leerlo de ahí.

## 5 · Lo que falta: pedidos reales

Desde que se desplegó todo (17:41 y 17:51 UTC) ha entrado **un** pedido, G469
de Last, todavía abierto y sin «Listo». Para cerrar la pieza 5 hacen falta, y
diré cuál sirve para cada caso:

- un pedido de Last con «Listo» y cierre → que `ready_at` sobreviva;
- un Uber por HubRise que pase a `in_delivery` → `handed_to_courier_at`;
- ese mismo al entregarse → `delivered_at` y `closed_at` = hora de entrega;
- cualquiera de los dos → que el consumo se escriba UNA vez.

Los miro según entren.
